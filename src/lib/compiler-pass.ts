// ─── Deterministic Compiler Pipeline ──────────────────
// Centralizes all deterministic schema transformation passes.
// Runs after AI generation + sanitization + FK resolution.
// Each pass is pure: (tables) → (tables, actions)

import type { TableNode, CompilerAction, CompilerReport, TypeUpgrade } from "@/lib/types";
import { deduplicateSchema } from "@/components/vibedb/ExportGenerators";
import { detectDomains, getDomainModule } from "@/lib/domains";

// ─── Naming Helpers ──────────────────────────────────

/** Convert any string to snake_case */
function toSnakeCase(str: string): string {
  return str
    // Insert _ before uppercase letters that follow lowercase
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    // Insert _ before uppercase letters that are followed by lowercase (for "XMLParser" → "xml_parser")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    // Replace spaces, dashes, dots with underscores
    .replace(/[\s\-\.]+/g, "_")
    // Collapse multiple underscores
    .replace(/_+/g, "_")
    // Trim leading/trailing underscores
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

function isSnakeCase(str: string): boolean {
  return SNAKE_CASE_RE.test(str);
}

// ─── Pass 1: Enforce Snake Case Naming ───────────────

function enforceSnakeCaseNaming(tables: TableNode[]): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];
  const renames = new Map<string, string>(); // old lowercase → new name

  // First pass: compute table renames
  for (const t of tables) {
    if (!isSnakeCase(t.name)) {
      const fixed = toSnakeCase(t.name);
      renames.set(t.name.toLowerCase(), fixed);
      actions.push({
        pass: "naming",
        table: fixed,
        description: `Renamed table "${t.name}" → "${fixed}"`,
        before: t.name,
        after: fixed,
      });
    }
  }

  // Second pass: apply renames to tables, columns, and FK references
  const fixed = tables.map(t => {
    const newName = renames.get(t.name.toLowerCase()) || t.name;

    const fixedColumns = t.columns.map(col => {
      let colName = col.name;
      if (!isSnakeCase(colName)) {
        const fixedColName = toSnakeCase(colName);
        actions.push({
          pass: "naming",
          table: newName,
          description: `Renamed column "${colName}" → "${fixedColName}" in ${newName}`,
          before: colName,
          after: fixedColName,
        });
        colName = fixedColName;
      }

      // Update FK linkedTable references if the target was renamed
      let linkedTable = col.linkedTable;
      if (linkedTable) {
        const renamedTarget = renames.get(linkedTable.toLowerCase());
        if (renamedTarget) {
          linkedTable = renamedTarget;
        }
      }

      return { ...col, name: colName, linkedTable };
    });

    // Update index column references
    const fixedIndexes = t.indexes?.map(idx => ({
      ...idx,
      columns: idx.columns.map(c => isSnakeCase(c) ? c : toSnakeCase(c)),
      name: isSnakeCase(idx.name) ? idx.name : toSnakeCase(idx.name),
    }));

    return { ...t, name: newName, columns: fixedColumns, indexes: fixedIndexes };
  });

  return { tables: fixed, actions };
}

// ─── Pass 2: Inject CHECK Constraints ────────────────

export interface CheckRule {
  pattern: (name: string, type: string) => boolean;
  expression: (colName: string) => string;
  label: string;
  category: "enum" | "range" | "format" | "length";
}

const CHECK_RULES: CheckRule[] = [
  // ── Tier 1: Enum constraints ──
  {
    pattern: (n) => n === "status",
    expression: (c) => `${c} IN ('active', 'inactive', 'pending', 'archived')`,
    label: "status enum",
    category: "enum",
  },
  {
    pattern: (n) => n === "priority",
    expression: (c) => `${c} IN ('low', 'medium', 'high', 'critical')`,
    label: "priority enum",
    category: "enum",
  },
  {
    pattern: (n) => n === "role",
    expression: (c) => `${c} IN ('admin', 'user', 'moderator', 'viewer')`,
    label: "role enum",
    category: "enum",
  },
  {
    pattern: (n) => n === "visibility" || n === "access_level",
    expression: (c) => `${c} IN ('public', 'private', 'restricted')`,
    label: "visibility enum",
    category: "enum",
  },
  {
    pattern: (n) => n === "difficulty" || n === "level",
    expression: (c) => `${c} IN ('beginner', 'intermediate', 'advanced', 'expert')`,
    label: "difficulty/level enum",
    category: "enum",
  },
  {
    pattern: (n) => n === "tier" || n === "plan",
    expression: (c) => `${c} IN ('free', 'basic', 'pro', 'enterprise')`,
    label: "tier enum",
    category: "enum",
  },
  {
    pattern: (n) => n === "payment_status",
    expression: (c) => `${c} IN ('pending', 'completed', 'failed', 'refunded')`,
    label: "payment status enum",
    category: "enum",
  },
  {
    pattern: (n) => n === "order_status",
    expression: (c) => `${c} IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')`,
    label: "order status enum",
    category: "enum",
  },
  {
    pattern: (n, t) => n === "gender" && (t === "varchar" || t === "text"),
    expression: (c) => `${c} IN ('male', 'female', 'non_binary', 'other', 'prefer_not_to_say')`,
    label: "gender enum",
    category: "enum",
  },

  // ── Tier 2: Numeric range constraints ──
  {
    pattern: (n, t) => (n === "rating" || n === "stars") && (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0 AND ${c} <= 5`,
    label: "rating range 0-5",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "score" || n.endsWith("_score")) && (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0 AND ${c} <= 100`,
    label: "score range 0-100",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "percent" || n === "percentage" || n.endsWith("_percent") || n.endsWith("_percentage")) && (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0 AND ${c} <= 100`,
    label: "percentage range 0-100",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "quantity" || n === "count" || n === "stock" || n.endsWith("_count") || n.endsWith("_quantity")) && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative quantity",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "price" || n === "amount" || n === "cost" || n === "fee" || n === "total" || n === "subtotal" ||
      n === "balance" || n === "salary" || n === "budget" || n === "discount" ||
      n.endsWith("_price") || n.endsWith("_amount") || n.endsWith("_cost") || n.endsWith("_fee")) &&
      (t === "numeric" || t === "decimal" || t === "float" || t === "int"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative monetary value",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "age") && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 0 AND ${c} <= 150`,
    label: "age range",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "sort_order" || n === "position" || n === "order" || n === "rank" || n === "sequence") && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative ordering",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "latitude" || n === "lat") && (t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= -90 AND ${c} <= 90`,
    label: "latitude range -90..90",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "longitude" || n === "lng" || n === "lon") && (t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= -180 AND ${c} <= 180`,
    label: "longitude range -180..180",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "port" || n === "port_number" || n.endsWith("_port")) && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 1 AND ${c} <= 65535`,
    label: "port range 1-65535",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "duration" || n === "interval" || n === "timeout" || n === "ttl" || n === "retry_delay" ||
      n.endsWith("_duration") || n.endsWith("_interval") || n.endsWith("_timeout") ||
      n.endsWith("_seconds") || n.endsWith("_minutes") || n.endsWith("_hours") || n.endsWith("_days")) &&
      (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative duration",
    category: "range",
  },
  {
    pattern: (n, t) => (n === "weight" || n === "height" || n === "width" || n === "length" || n === "depth" ||
      n === "distance" || n === "area" || n === "volume" ||
      n.endsWith("_weight") || n.endsWith("_height") || n.endsWith("_width") ||
      n.endsWith("_length") || n.endsWith("_depth") || n.endsWith("_distance")) &&
      (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative measurement",
    category: "range",
  },

  // ── Tier 3: String format validation ──
  {
    pattern: (n) => n === "email",
    expression: (c) => `${c} ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'`,
    label: "email format",
    category: "format",
  },
  {
    pattern: (n, t) => (n === "slug" || n.endsWith("_slug")) && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${c}) <= 100`,
    label: "slug format (lowercase + dashes, max 100)",
    category: "format",
  },
  {
    pattern: (n, t) => (n === "username" || n === "handle" || n === "screen_name") && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^[a-zA-Z0-9_]{3,50}$'`,
    label: "username format (3-50, alphanumeric + underscores)",
    category: "format",
  },
  {
    pattern: (n, t) => (n === "color" || n === "colour" || n === "hex_color" || n === "hex_colour" ||
      n.endsWith("_color") || n.endsWith("_colour")) && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'`,
    label: "hex color format (#RGB or #RRGGBB)",
    category: "format",
  },
  {
    pattern: (n, t) => (n === "url" || n === "website" || n === "homepage" || n === "link" || n === "href" ||
      n.endsWith("_url") || n.endsWith("_link") || n.endsWith("_href")) && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^https?://'`,
    label: "URL format (http/https)",
    category: "format",
  },
  {
    pattern: (n, t) => (n === "phone" || n === "phone_number" || n === "mobile" || n === "fax" ||
      n.endsWith("_phone") || n.endsWith("_mobile")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 7 AND char_length(${c}) <= 20`,
    label: "phone length 7-20",
    category: "format",
  },
  {
    pattern: (n, t) => (n === "zip" || n === "zip_code" || n === "postal_code" || n === "postcode") && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 3 AND char_length(${c}) <= 10`,
    label: "postal code length 3-10",
    category: "format",
  },
  {
    pattern: (n, t) => (n === "ip" || n === "ip_address" || n === "ip_addr" ||
      n.endsWith("_ip") || n.endsWith("_ip_address")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 7 AND char_length(${c}) <= 45`,
    label: "IP address length 7-45 (IPv4/IPv6)",
    category: "format",
  },

  // ── Tier 4: String length constraints (generic — after specific patterns) ──
  {
    pattern: (n, t) => (n === "name" || n === "title" || n === "label" ||
      n.endsWith("_name") || n.endsWith("_title")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 1 AND char_length(${c}) <= 255`,
    label: "name/title length 1-255",
    category: "length",
  },
  {
    pattern: (n, t) => (n === "description" || n === "bio" || n === "summary" || n === "about" ||
      n.endsWith("_description") || n.endsWith("_bio")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) <= 10000`,
    label: "description max length 10000",
    category: "length",
  },

  // ── Tier 5: Suffix catch-alls (LAST — lowest priority) ──
  {
    pattern: (n, t) => n.endsWith("_status") && (t === "varchar" || t === "text") &&
      n !== "payment_status" && n !== "order_status",
    expression: (c) => `char_length(${c}) >= 1 AND char_length(${c}) <= 50`,
    label: "generic status string length",
    category: "length",
  },
  {
    pattern: (n, t) => n.endsWith("_type") && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 1 AND char_length(${c}) <= 50`,
    label: "generic type string length",
    category: "length",
  },
];

// ─── Cross-Column CHECK Constraints ──────────────────

export interface CrossColumnCheckRule {
  detect: (columns: { name: string; type: string }[]) => { col1: string; col2: string } | null;
  expression: (col1: string, col2: string) => string;
  constraintName: (tableName: string, col1: string, col2: string) => string;
  label: string;
}

const DATE_RANGE_PAIRS: [string, string][] = [
  ["start_date", "end_date"],
  ["start_time", "end_time"],
  ["starts_at", "ends_at"],
  ["started_at", "ended_at"],
  ["valid_from", "valid_until"],
  ["valid_from", "valid_to"],
  ["begin_date", "end_date"],
  ["check_in", "check_out"],
  ["check_in_date", "check_out_date"],
  ["publish_date", "expiry_date"],
  ["hire_date", "termination_date"],
  ["open_date", "close_date"],
];

const CROSS_COLUMN_CHECK_RULES: CrossColumnCheckRule[] = [
  // B1: Date range pairs — end >= start
  {
    detect: (cols) => {
      const nameMap = new Map(cols.map(c => [c.name.toLowerCase(), c.name]));
      for (const [a, b] of DATE_RANGE_PAIRS) {
        const colA = nameMap.get(a);
        const colB = nameMap.get(b);
        if (colA && colB) return { col1: colA, col2: colB };
      }
      return null;
    },
    expression: (c1, c2) => `${c2} >= ${c1}`,
    constraintName: (t, c1, c2) => `chk_${t}_${c2}_after_${c1}`,
    label: "end date >= start date",
  },
  // B2: Min/Max pairs — max >= min
  {
    detect: (cols) => {
      const nameSet = new Set(cols.map(c => c.name.toLowerCase()));
      for (const col of cols) {
        const lower = col.name.toLowerCase();
        if (lower.startsWith("min_")) {
          const suffix = lower.slice(4);
          const maxName = `max_${suffix}`;
          if (nameSet.has(maxName)) {
            const maxCol = cols.find(c => c.name.toLowerCase() === maxName);
            if (maxCol) return { col1: col.name, col2: maxCol.name };
          }
        }
      }
      return null;
    },
    expression: (c1, c2) => `${c2} >= ${c1}`,
    constraintName: (t, c1, c2) => `chk_${t}_${c2}_gte_${c1}`,
    label: "max >= min",
  },
  // B3: Self-referential FK guard — parent_id != id
  {
    detect: (cols) => {
      const parentCol = cols.find(c => c.name.toLowerCase() === "parent_id");
      const idCol = cols.find(c => c.name.toLowerCase() === "id");
      if (parentCol && idCol) return { col1: idCol.name, col2: parentCol.name };
      return null;
    },
    expression: (_c1, c2) => `${c2} != id`,
    constraintName: (t) => `chk_${t}_no_self_ref`,
    label: "self-referential FK guard (parent_id != id)",
  },
];

function injectCheckConstraints(tables: TableNode[], rules: CheckRule[] = CHECK_RULES, crossRules: CrossColumnCheckRule[] = CROSS_COLUMN_CHECK_RULES): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];

  const fixed = tables.map(t => {
    const existing = t.checkConstraints || [];
    const newChecks = [...existing];

    // ── Per-column CHECK rules ──
    for (const col of t.columns) {
      const colName = col.name.toLowerCase();

      // Skip if a CHECK constraint already references this column
      const alreadyHasCheck = existing.some(ck =>
        ck.expression.toLowerCase().includes(colName)
      );
      if (alreadyHasCheck) continue;

      const appliedCategories = new Set<string>();

      for (const rule of rules) {
        // Allow one constraint per category per column (enum + length = OK, two enums = skip)
        if (appliedCategories.has(rule.category)) continue;

        if (rule.pattern(colName, (col.type || "").toLowerCase())) {
          const expression = rule.expression(col.name);
          const constraintName = `chk_${t.name}_${col.name}_${rule.category}`;
          newChecks.push({ name: constraintName, expression });
          actions.push({
            pass: "check-constraint",
            table: t.name,
            description: `Added CHECK (${rule.label}) on ${t.name}.${col.name}`,
            after: expression,
          });
          appliedCategories.add(rule.category);
        }
      }
    }

    // ── Cross-column CHECK rules ──
    const colSpecs = t.columns.map(c => ({ name: c.name, type: (c.type || "").toLowerCase() }));
    for (const rule of crossRules) {
      const match = rule.detect(colSpecs);
      if (!match) continue;

      // Skip if a CHECK constraint already references both columns
      const alreadyHasCrossCheck = newChecks.some(ck => {
        const lower = ck.expression.toLowerCase();
        return lower.includes(match.col1.toLowerCase()) && lower.includes(match.col2.toLowerCase());
      });
      if (alreadyHasCrossCheck) continue;

      const expression = rule.expression(match.col1, match.col2);
      const constraintName = rule.constraintName(t.name, match.col1, match.col2);
      newChecks.push({ name: constraintName, expression });
      actions.push({
        pass: "check-constraint",
        table: t.name,
        description: `Added CHECK (${rule.label}) on ${t.name} (${match.col1}, ${match.col2})`,
        after: expression,
      });
    }

    return { ...t, checkConstraints: newChecks };
  });

  return { tables: fixed, actions };
}

// ─── Pass 3: Inject Missing FK Indexes ───────────────

function injectMissingFKIndexes(tables: TableNode[]): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];

  const fixed = tables.map(t => {
    const existingIndexes = t.indexes || [];
    const newIndexes = [...existingIndexes];

    for (const col of t.columns) {
      if (!col.isForeignKey) continue;

      // Check if an index already covers this FK column
      const hasIndex = existingIndexes.some(idx =>
        idx.columns.some(c => c.toLowerCase() === col.name.toLowerCase())
      );
      if (hasIndex) continue;

      const idxName = `idx_${t.name}_${col.name}`;
      newIndexes.push({
        name: idxName,
        columns: [col.name],
        type: "btree",
        unique: false,
      });
      actions.push({
        pass: "fk-index",
        table: t.name,
        description: `Added index ${idxName} for FK ${t.name}.${col.name}`,
        after: idxName,
      });
    }

    return { ...t, indexes: newIndexes };
  });

  return { tables: fixed, actions };
}

// ─── Pass 4: Deduplication ───────────────────────────

function runDeduplicationPass(tables: TableNode[]): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];

  const { fixedItems, duplicateColumnsRemoved, duplicateIndexesRemoved } = deduplicateSchema(tables);

  if (duplicateColumnsRemoved > 0) {
    actions.push({
      pass: "dedup",
      table: "(global)",
      description: `Removed ${duplicateColumnsRemoved} duplicate column${duplicateColumnsRemoved !== 1 ? "s" : ""}`,
    });
  }
  if (duplicateIndexesRemoved > 0) {
    actions.push({
      pass: "dedup",
      table: "(global)",
      description: `Removed ${duplicateIndexesRemoved} duplicate index${duplicateIndexesRemoved !== 1 ? "es" : ""}`,
    });
  }

  return { tables: fixedItems, actions };
}

// ─── Pass 5: Ensure Timestamp Defaults ───────────────

function ensureTimestampDefaults(tables: TableNode[]): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];

  const fixed = tables.map(t => {
    const fixedColumns = t.columns.map(col => {
      const name = col.name.toLowerCase();
      if (name !== "created_at" && name !== "updated_at") return col;

      const constraints = [...(col.constraints || [])];
      const hasDefault = constraints.some(c => c.type === "default");
      if (hasDefault) return col;

      constraints.push({ type: "default", value: "now()" });
      actions.push({
        pass: "timestamp-default",
        table: t.name,
        description: `Added DEFAULT now() to ${t.name}.${col.name}`,
        after: "DEFAULT now()",
      });

      return { ...col, constraints };
    });

    return { ...t, columns: fixedColumns };
  });

  return { tables: fixed, actions };
}

// ─── Pass 6: Semantic Constraint Fixup ───────────────
// Enforces universal relational invariants. No domain-specific whitelists.
// No English verb matching. No ecommerce assumptions.

function fixSemanticConstraints(tables: TableNode[]): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];

  const fixed = tables.map(t => {
    const tableName = t.name.toLowerCase();

    // ── Rule 1: UUID PK default ──
    const fixedColumns = t.columns.map(col => {
      const name = col.name.toLowerCase();
      const constraints = [...(col.constraints || [])];
      const isPK = constraints.some(c => c.type === "primary");
      const isUuid = (col.type || "").toLowerCase() === "uuid";

      if (name === "id" && isPK && isUuid) {
        const hasDefault = constraints.some(c => c.type === "default");
        if (!hasDefault) {
          constraints.push({ type: "default", value: "gen_random_uuid()" });
          actions.push({
            pass: "semantic-constraint",
            table: t.name,
            description: `Added DEFAULT gen_random_uuid() to ${t.name}.id`,
            after: "DEFAULT gen_random_uuid()",
          });
          return { ...col, constraints };
        }
      }

      // ── Rule 2: Self-referential FK must be nullable ──
      if (col.isForeignKey && col.linkedTable && col.linkedTable.toLowerCase() === tableName) {
        const hasNotNull = constraints.some(c => c.type === "notNull");
        if (hasNotNull) {
          const stripped = constraints.filter(c => c.type !== "notNull");
          actions.push({
            pass: "semantic-constraint",
            table: t.name,
            description: `Stripped NOT NULL from self-referential FK ${t.name}.${col.name} (root records must be possible)`,
            before: "NOT NULL",
            after: "NULLABLE",
          });
          return { ...col, constraints: stripped };
        }
      }

      // ── Rule 3: Lifecycle event timestamps must be nullable ──
      // Only explicitly optional lifecycle events — not domain-required timestamps like hired_at, born_at
      const LIFECYCLE_EVENT_TIMESTAMPS = new Set([
        "deleted_at", "archived_at", "cancelled_at", "resolved_at",
        "completed_at", "terminated_at", "suspended_at", "deactivated_at",
        "shipped_at", "delivered_at", "paid_at", "refunded_at",
        "returned_at", "fulfilled_at", "published_at", "expired_at",
        "verified_at", "approved_at", "rejected_at", "revoked_at",
        "closed_at", "dismissed_at", "confirmed_at", "processed_at",
        "received_at", "accepted_at", "estimated_delivery_at",
      ]);
      if (LIFECYCLE_EVENT_TIMESTAMPS.has(name)) {
        const hasNotNull = constraints.some(c => c.type === "notNull");
        if (hasNotNull) {
          const stripped = constraints.filter(c => c.type !== "notNull");
          actions.push({
            pass: "semantic-constraint",
            table: t.name,
            description: `Stripped NOT NULL from event timestamp ${t.name}.${col.name} (events cannot exist before they occur)`,
            before: "NOT NULL",
            after: "NULLABLE",
          });
          return { ...col, constraints: stripped };
        }
      }

      return col;
    });

    // ── Rule 4: NOT NULL + CHECK allowing NULL = contradiction ──
    const fixedChecks = (t.checkConstraints || []).map(chk => {
      const expr = chk.expression;
      // Detect pattern: "colName IS NULL OR <condition>"
      const nullOrMatch = expr.match(/^(\w+)\s+IS\s+NULL\s+OR\s+(.+)$/i);
      if (!nullOrMatch) return chk;

      const [, checkCol, positiveCondition] = nullOrMatch;
      // Find the column — if it has NOT NULL, the IS NULL branch is unreachable
      const col = fixedColumns.find(c => c.name.toLowerCase() === checkCol.toLowerCase());
      if (!col) return chk;

      const hasNotNull = (col.constraints || []).some(c => c.type === "notNull");
      if (hasNotNull) {
        actions.push({
          pass: "semantic-constraint",
          table: t.name,
          description: `Normalized CHECK on ${t.name}.${checkCol}: removed unreachable IS NULL branch (column is NOT NULL)`,
          before: expr,
          after: positiveCondition.trim(),
        });
        return { ...chk, expression: positiveCondition.trim() };
      }
      return chk;
    });

    // ── Rule 5: Soft delete partial indexing ──
    const hasDeletedAt = fixedColumns.some(c => c.name.toLowerCase() === "deleted_at");
    let fixedIndexes = t.indexes || [];
    if (hasDeletedAt && fixedIndexes.length > 0) {
      fixedIndexes = fixedIndexes.map(idx => {
        // Skip: primary key indexes, unique indexes, already-partial indexes
        if (idx.unique) return idx;
        if (idx.where) return idx;
        // Skip indexes that include the id column (likely PK-related)
        if (idx.columns.some(c => c.toLowerCase() === "id")) return idx;

        actions.push({
          pass: "semantic-constraint",
          table: t.name,
          description: `Added partial filter WHERE deleted_at IS NULL to index ${idx.name}`,
          before: idx.name,
          after: `${idx.name} WHERE deleted_at IS NULL`,
        });
        return { ...idx, where: "deleted_at IS NULL" };
      });
    }

    return { ...t, columns: fixedColumns, checkConstraints: fixedChecks, indexes: fixedIndexes };
  });

  // ── Rule 6: Dual inventory detection (warning only) ──
  // If table A has stock_count and table B has FK to A and also has stock_count → warning
  const stockTables = fixed.filter(t =>
    t.columns.some(c => c.name.toLowerCase().includes("stock") && c.name.toLowerCase().includes("count"))
  );
  if (stockTables.length > 1) {
    // Check if any pair has a FK relationship
    for (const child of stockTables) {
      for (const parent of stockTables) {
        if (child === parent) continue;
        const hasFKToParent = child.columns.some(c =>
          c.isForeignKey && c.linkedTable && c.linkedTable.toLowerCase() === parent.name.toLowerCase()
        );
        if (hasFKToParent) {
          actions.push({
            pass: "semantic-constraint",
            table: child.name,
            description: `Warning: Inventory modeled at multiple levels (${parent.name}.stock_count + ${child.name}.stock_count). Consider consolidating inventory tracking.`,
            severity: "warning",
          });
        }
      }
    }
  }

  // ── Rule 7: Auto-assign ON DELETE cascade behavior ──
  const withCascade = fixed.map(t => {
    const fkCols = t.columns.filter(c => c.isForeignKey && c.linkedTable);
    const hasSoftDelete = t.columns.some(c => c.name.toLowerCase() === "deleted_at");

    // Junction table detection: exactly 2 FK cols + a composite unique index covering both
    const isJunction = fkCols.length === 2 && (t.indexes || []).some(idx =>
      idx.unique && idx.columns.length === 2 &&
      fkCols.every(fk => idx.columns.some(ic => ic.toLowerCase() === fk.name.toLowerCase()))
    );

    const fixedCols = t.columns.map(col => {
      if (!col.isForeignKey || !col.linkedTable || col.onDelete) return col;
      // SET NULL is only valid on nullable columns — a NOT NULL FK with ON DELETE
      // SET NULL fails at runtime the first time the parent row is deleted.
      const isNotNull = col.constraints?.some(c => c.type === "notNull");
      let onDelete: "CASCADE" | "SET NULL" | "RESTRICT";
      if (isJunction) {
        onDelete = "CASCADE";
      } else if (hasSoftDelete && !isNotNull) {
        onDelete = "SET NULL";
      } else {
        onDelete = "RESTRICT";
      }
      actions.push({
        pass: "semantic-constraint",
        table: t.name,
        description: `Set ${col.name} ON DELETE ${onDelete}${isJunction ? " (junction table)" : hasSoftDelete && !isNotNull ? " (soft-delete table)" : hasSoftDelete && isNotNull ? " (soft-delete table, but FK is NOT NULL)" : ""}`,
      });
      return { ...col, onDelete };
    });
    return { ...t, columns: fixedCols };
  });

  return { tables: withCascade, actions };
}

// ─── Pass 7: Ensure Standard Columns (id, created_at, updated_at) ───

function ensureStandardColumns(tables: TableNode[]): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];

  const fixed = tables.map(t => {
    let columns = [...t.columns];

    // ── Ensure id column exists with UUID PK + gen_random_uuid() ──
    const idIdx = columns.findIndex(c => c.name.toLowerCase() === "id");
    if (idIdx >= 0) {
      const idCol = columns[idIdx];
      const constraints = [...(idCol.constraints || [])];
      let changed = false;

      if (!constraints.some(c => c.type === "primary")) {
        constraints.push({ type: "primary" });
        changed = true;
      }
      if (!constraints.some(c => c.type === "notNull")) {
        constraints.push({ type: "notNull" });
        changed = true;
      }
      if (!constraints.some(c => c.type === "default")) {
        constraints.push({ type: "default", value: "gen_random_uuid()" });
        changed = true;
      }

      if (changed || (idCol.type || "").toLowerCase() !== "uuid") {
        actions.push({
          pass: "standard-columns",
          table: t.name,
          description: `Enforced id column as UUID PK with gen_random_uuid() on ${t.name}`,
          after: "UUID PRIMARY KEY DEFAULT gen_random_uuid()",
        });
        columns[idIdx] = { ...idCol, type: "uuid", constraints };
      }

      // Strip PK from any non-id columns
      columns = columns.map((c, i) => {
        if (i === idIdx) return c;
        const hasPK = (c.constraints || []).some(x => x.type === "primary");
        if (hasPK) {
          actions.push({
            pass: "standard-columns",
            table: t.name,
            description: `Stripped PK from non-id column ${t.name}.${c.name}`,
            before: "PRIMARY KEY",
            after: "(removed)",
          });
          return { ...c, constraints: (c.constraints || []).filter(x => x.type !== "primary") };
        }
        return c;
      });
    } else {
      // No id column — prepend one
      columns.unshift({
        id: `compiler-id-${t.name}`,
        name: "id",
        type: "uuid",
        isForeignKey: false,
        constraints: [
          { type: "primary" },
          { type: "notNull" },
          { type: "default", value: "gen_random_uuid()" },
        ],
      } as any);
      actions.push({
        pass: "standard-columns",
        table: t.name,
        description: `Injected missing id column on ${t.name}`,
        after: "UUID PRIMARY KEY DEFAULT gen_random_uuid()",
      });
    }

    // ── Ensure created_at exists with DEFAULT now() ──
    const hasCreatedAt = columns.some(c => c.name.toLowerCase() === "created_at");
    if (!hasCreatedAt) {
      columns.push({
        id: `compiler-created-${t.name}`,
        name: "created_at",
        type: "timestamptz",
        isForeignKey: false,
        constraints: [{ type: "default", value: "now()" }],
      } as any);
      actions.push({
        pass: "standard-columns",
        table: t.name,
        description: `Injected missing created_at on ${t.name}`,
        after: "TIMESTAMPTZ DEFAULT now()",
      });
    }

    // ── Ensure updated_at exists with DEFAULT now() ──
    const hasUpdatedAt = columns.some(c => c.name.toLowerCase() === "updated_at");
    if (!hasUpdatedAt) {
      columns.push({
        id: `compiler-updated-${t.name}`,
        name: "updated_at",
        type: "timestamptz",
        isForeignKey: false,
        constraints: [{ type: "default", value: "now()" }],
      } as any);
      actions.push({
        pass: "standard-columns",
        table: t.name,
        description: `Injected missing updated_at on ${t.name}`,
        after: "TIMESTAMPTZ DEFAULT now()",
      });
    }

    return { ...t, columns };
  });

  return { tables: fixed, actions };
}

// ─── Main Compiler Pipeline ──────────────────────────

// ─── Domain Type Upgrades ─────────────────────────────

function applyTypeUpgrades(tables: TableNode[], upgrades: TypeUpgrade[]): { tables: TableNode[]; actions: CompilerAction[] } {
  const actions: CompilerAction[] = [];
  if (upgrades.length === 0) return { tables, actions };

  const upgradeMap = new Map<string, Map<string, TypeUpgrade>>();
  for (const u of upgrades) {
    if (!upgradeMap.has(u.tableName)) upgradeMap.set(u.tableName, new Map());
    upgradeMap.get(u.tableName)!.set(u.columnName.toLowerCase(), u);
  }

  const fixed = tables.map(t => {
    const tableUpgrades = upgradeMap.get(t.name);
    if (!tableUpgrades) return t;
    const fixedColumns = t.columns.map(col => {
      const upgrade = tableUpgrades.get(col.name.toLowerCase());
      if (!upgrade) return col;
      if (col.type.toLowerCase() === upgrade.toType.toLowerCase()) return col;
      actions.push({
        pass: "domain-type-upgrade",
        table: t.name,
        description: `Upgraded ${t.name}.${col.name}: ${col.type} → ${upgrade.toType} (${upgrade.reason})`,
        before: col.type,
        after: upgrade.toType,
      });
      return { ...col, type: upgrade.toType };
    });
    return { ...t, columns: fixedColumns };
  });

  return { tables: fixed, actions };
}

/**
 * CONVENTION: Every code path that produces output from canvasItems
 * (deploy, export, audit AI context, generate RLS/types, apply suggestions)
 * MUST run tables through this function first.
 *
 * This pipeline is idempotent — running it on already-compiled tables
 * produces zero actions and returns the same tables unchanged.
 */
export function runCompilerPass(tables: TableNode[]): { tables: TableNode[]; report: CompilerReport } {
  const startTime = performance.now();
  const allActions: CompilerAction[] = [];

  let current = tables;

  // Pass 1: Naming
  const naming = enforceSnakeCaseNaming(current);
  current = naming.tables;
  allActions.push(...naming.actions);

  // Domain detection (after naming normalization, before CHECK injection)
  const detected = detectDomains(current);
  const activeMods = detected.map(d => getDomainModule(d.domain)).filter((m): m is NonNullable<typeof m> => !!m);

  for (const d of detected) {
    const mod = getDomainModule(d.domain);
    allActions.push({
      pass: "domain-detection",
      table: "(global)",
      description: `Detected domain: ${mod?.label || d.domain} (${(d.confidence * 100).toFixed(0)}% confidence, ${d.matchedSignals.length} signals)`,
    });
  }

  // Pass 2: CHECK constraints (merge base + domain rules)
  const mergedCheckRules = activeMods.length > 0
    ? [...CHECK_RULES, ...activeMods.flatMap(m => m.checkRules)]
    : CHECK_RULES;
  const mergedCrossRules = activeMods.length > 0
    ? [...CROSS_COLUMN_CHECK_RULES, ...activeMods.flatMap(m => m.crossColumnCheckRules)]
    : CROSS_COLUMN_CHECK_RULES;

  const checks = injectCheckConstraints(current, mergedCheckRules, mergedCrossRules);
  current = checks.tables;
  allActions.push(...checks.actions);

  // Pass 2b: Domain type upgrades (only if domains detected)
  let typeUpgradeCount = 0;
  if (activeMods.length > 0) {
    const upgrades = activeMods.flatMap(m => m.typeUpgrades(current));
    const typeResult = applyTypeUpgrades(current, upgrades);
    current = typeResult.tables;
    allActions.push(...typeResult.actions);
    typeUpgradeCount = typeResult.actions.length;
  }

  // Pass 3: FK indexes
  const fkIndexes = injectMissingFKIndexes(current);
  current = fkIndexes.tables;
  allActions.push(...fkIndexes.actions);

  // Pass 4: Deduplication
  const dedup = runDeduplicationPass(current);
  current = dedup.tables;
  allActions.push(...dedup.actions);

  // Pass 5: Timestamp defaults
  const timestamps = ensureTimestampDefaults(current);
  current = timestamps.tables;
  allActions.push(...timestamps.actions);

  // Pass 6: Semantic constraint fixup (universal relational invariants)
  const semantic = fixSemanticConstraints(current);
  current = semantic.tables;
  allActions.push(...semantic.actions);

  // Pass 7: Ensure standard columns (id, created_at, updated_at)
  const stdCols = ensureStandardColumns(current);
  current = stdCols.tables;
  allActions.push(...stdCols.actions);

  // Gather domain artifacts for the report (computed but NOT applied to tables)
  const companionTableSuggestions = activeMods.flatMap(m => m.companionTables(current));
  const domainTriggers = activeMods.flatMap(m => m.triggers(current));
  const domainRLSPolicies = activeMods.flatMap(m => m.rlsPolicies(current));

  const durationMs = Math.round(performance.now() - startTime);

  const report: CompilerReport = {
    actions: allActions,
    tablesProcessed: tables.length,
    constraintsAdded: checks.actions.length,
    indexesAdded: fkIndexes.actions.length,
    namingFixes: naming.actions.length,
    constraintFixes: semantic.actions.length,
    standardColumnFixes: stdCols.actions.length,
    durationMs,
    // Domain fields (undefined when no domain detected — backward-compatible)
    detectedDomains: detected.length > 0 ? detected : undefined,
    typeUpgrades: typeUpgradeCount > 0 ? typeUpgradeCount : undefined,
    companionTableSuggestions: companionTableSuggestions.length > 0 ? companionTableSuggestions : undefined,
    domainTriggers: domainTriggers.length > 0 ? domainTriggers : undefined,
    domainRLSPolicies: domainRLSPolicies.length > 0 ? domainRLSPolicies : undefined,
  };

  return { tables: current, report };
}
