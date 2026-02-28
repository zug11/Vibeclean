// ─── Deterministic Compiler Pipeline ──────────────────
// Centralizes all deterministic schema transformation passes.
// Runs after AI generation + sanitization + FK resolution.
// Each pass is pure: (tables) → (tables, actions)

import type { TableNode, CompilerAction, CompilerReport } from "@/lib/types";
import { deduplicateSchema } from "@/components/vibedb/ExportGenerators";

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

interface CheckRule {
  pattern: (name: string, type: string) => boolean;
  expression: (colName: string) => string;
  label: string;
}

const CHECK_RULES: CheckRule[] = [
  {
    pattern: (n) => n === "status",
    expression: (c) => `${c} IN ('active', 'inactive', 'pending', 'archived')`,
    label: "status enum",
  },
  {
    pattern: (n) => n === "priority",
    expression: (c) => `${c} IN ('low', 'medium', 'high', 'critical')`,
    label: "priority enum",
  },
  {
    pattern: (n) => n === "role",
    expression: (c) => `${c} IN ('admin', 'user', 'moderator', 'viewer')`,
    label: "role enum",
  },
  {
    pattern: (n) => n === "visibility" || n === "access_level",
    expression: (c) => `${c} IN ('public', 'private', 'restricted')`,
    label: "visibility enum",
  },
  {
    pattern: (n) => n === "difficulty" || n === "level",
    expression: (c) => `${c} IN ('beginner', 'intermediate', 'advanced', 'expert')`,
    label: "difficulty/level enum",
  },
  {
    pattern: (n) => n === "tier" || n === "plan",
    expression: (c) => `${c} IN ('free', 'basic', 'pro', 'enterprise')`,
    label: "tier enum",
  },
  {
    pattern: (n) => n === "payment_status",
    expression: (c) => `${c} IN ('pending', 'completed', 'failed', 'refunded')`,
    label: "payment status enum",
  },
  {
    pattern: (n) => n === "order_status",
    expression: (c) => `${c} IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')`,
    label: "order status enum",
  },
  {
    pattern: (n, t) => (n === "rating" || n === "stars") && (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0 AND ${c} <= 5`,
    label: "rating range 0-5",
  },
  {
    pattern: (n, t) => (n === "score" || n.endsWith("_score")) && (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0 AND ${c} <= 100`,
    label: "score range 0-100",
  },
  {
    pattern: (n, t) => (n === "percent" || n === "percentage" || n.endsWith("_percent") || n.endsWith("_percentage")) && (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0 AND ${c} <= 100`,
    label: "percentage range 0-100",
  },
  {
    pattern: (n, t) => (n === "quantity" || n === "count" || n === "stock" || n.endsWith("_count") || n.endsWith("_quantity")) && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative quantity",
  },
  {
    pattern: (n, t) => (n === "price" || n === "amount" || n === "cost" || n === "fee" || n === "total" || n === "subtotal" ||
      n === "balance" || n === "salary" || n === "budget" || n === "discount" ||
      n.endsWith("_price") || n.endsWith("_amount") || n.endsWith("_cost") || n.endsWith("_fee")) &&
      (t === "numeric" || t === "decimal" || t === "float" || t === "int"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative monetary value",
  },
  {
    pattern: (n) => n === "email",
    expression: (c) => `${c} ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'`,
    label: "email format",
  },
  {
    pattern: (n, t) => (n === "age") && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 0 AND ${c} <= 150`,
    label: "age range",
  },
  {
    pattern: (n, t) => (n === "sort_order" || n === "position" || n === "order" || n === "rank" || n === "sequence") && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative ordering",
  },

  // ── Tier 2b: More numeric ranges (NEW) ──

  {
    pattern: (n, t) => (n === "latitude" || n === "lat") && (t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= -90 AND ${c} <= 90`,
    label: "latitude range -90..90",
  },
  {
    pattern: (n, t) => (n === "longitude" || n === "lng" || n === "lon") && (t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= -180 AND ${c} <= 180`,
    label: "longitude range -180..180",
  },
  {
    pattern: (n, t) => (n === "port" || n === "port_number" || n.endsWith("_port")) && (t === "int" || t === "numeric"),
    expression: (c) => `${c} >= 1 AND ${c} <= 65535`,
    label: "port range 1-65535",
  },
  {
    pattern: (n, t) => (n === "duration" || n === "interval" || n === "timeout" || n === "ttl" || n === "retry_delay" ||
      n.endsWith("_duration") || n.endsWith("_interval") || n.endsWith("_timeout") ||
      n.endsWith("_seconds") || n.endsWith("_minutes") || n.endsWith("_hours") || n.endsWith("_days")) &&
      (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative duration",
  },
  {
    pattern: (n, t) => (n === "weight" || n === "height" || n === "width" || n === "length" || n === "depth" ||
      n === "distance" || n === "area" || n === "volume" ||
      n.endsWith("_weight") || n.endsWith("_height") || n.endsWith("_width") ||
      n.endsWith("_length") || n.endsWith("_depth") || n.endsWith("_distance")) &&
      (t === "int" || t === "numeric" || t === "decimal" || t === "float"),
    expression: (c) => `${c} >= 0`,
    label: "non-negative measurement",
  },

  // ── Tier 3: String format validation (NEW) ──

  {
    pattern: (n, t) => (n === "slug" || n.endsWith("_slug")) && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${c}) <= 100`,
    label: "slug format (lowercase + dashes, max 100)",
  },
  {
    pattern: (n, t) => (n === "username" || n === "handle" || n === "screen_name") && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^[a-zA-Z0-9_]{3,50}$'`,
    label: "username format (3-50, alphanumeric + underscores)",
  },
  {
    pattern: (n, t) => (n === "color" || n === "colour" || n === "hex_color" || n === "hex_colour" ||
      n.endsWith("_color") || n.endsWith("_colour")) && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'`,
    label: "hex color format (#RGB or #RRGGBB)",
  },
  {
    pattern: (n, t) => (n === "url" || n === "website" || n === "homepage" || n === "link" || n === "href" ||
      n.endsWith("_url") || n.endsWith("_link") || n.endsWith("_href")) && (t === "varchar" || t === "text"),
    expression: (c) => `${c} ~* '^https?://'`,
    label: "URL format (http/https)",
  },
  {
    pattern: (n, t) => (n === "phone" || n === "phone_number" || n === "mobile" || n === "fax" ||
      n.endsWith("_phone") || n.endsWith("_mobile")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 7 AND char_length(${c}) <= 20`,
    label: "phone length 7-20",
  },
  {
    pattern: (n, t) => (n === "zip" || n === "zip_code" || n === "postal_code" || n === "postcode") && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 3 AND char_length(${c}) <= 10`,
    label: "postal code length 3-10",
  },
  {
    pattern: (n, t) => (n === "ip" || n === "ip_address" || n === "ip_addr" ||
      n.endsWith("_ip") || n.endsWith("_ip_address")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 7 AND char_length(${c}) <= 45`,
    label: "IP address length 7-45 (IPv4/IPv6)",
  },

  // ── Tier 3b: Domain-specific enums (NEW) ──

  {
    pattern: (n, t) => n === "gender" && (t === "varchar" || t === "text"),
    expression: (c) => `${c} IN ('male', 'female', 'non_binary', 'other', 'prefer_not_to_say')`,
    label: "gender enum",
  },

  // ── Tier 4: String length constraints (NEW, generic — after specific patterns) ──

  {
    pattern: (n, t) => (n === "name" || n === "title" || n === "label" ||
      n.endsWith("_name") || n.endsWith("_title")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 1 AND char_length(${c}) <= 255`,
    label: "name/title length 1-255",
  },
  {
    pattern: (n, t) => (n === "description" || n === "bio" || n === "summary" || n === "about" ||
      n.endsWith("_description") || n.endsWith("_bio")) && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) <= 10000`,
    label: "description max length 10000",
  },

  // ── Tier 5: Suffix catch-alls (NEW, LAST — lowest priority) ──

  {
    pattern: (n, t) => n.endsWith("_status") && (t === "varchar" || t === "text") &&
      n !== "payment_status" && n !== "order_status",
    expression: (c) => `char_length(${c}) >= 1 AND char_length(${c}) <= 50`,
    label: "generic status string length",
  },
  {
    pattern: (n, t) => n.endsWith("_type") && (t === "varchar" || t === "text"),
    expression: (c) => `char_length(${c}) >= 1 AND char_length(${c}) <= 50`,
    label: "generic type string length",
  },
];

// ─── Cross-Column CHECK Constraints ──────────────────

interface CrossColumnCheckRule {
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

function injectCheckConstraints(tables: TableNode[]): { tables: TableNode[]; actions: CompilerAction[] } {
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

      for (const rule of CHECK_RULES) {
        if (rule.pattern(colName, (col.type || "").toLowerCase())) {
          const expression = rule.expression(col.name);
          const constraintName = `chk_${t.name}_${col.name}`;
          newChecks.push({ name: constraintName, expression });
          actions.push({
            pass: "check-constraint",
            table: t.name,
            description: `Added CHECK (${rule.label}) on ${t.name}.${col.name}`,
            after: expression,
          });
          break; // Only one CHECK per column
        }
      }
    }

    // ── Cross-column CHECK rules ──
    const colSpecs = t.columns.map(c => ({ name: c.name, type: (c.type || "").toLowerCase() }));
    for (const rule of CROSS_COLUMN_CHECK_RULES) {
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

// ─── Main Compiler Pipeline ──────────────────────────

export function runCompilerPass(tables: TableNode[]): { tables: TableNode[]; report: CompilerReport } {
  const startTime = performance.now();
  const allActions: CompilerAction[] = [];

  let current = tables;

  // Pass 1: Naming
  const naming = enforceSnakeCaseNaming(current);
  current = naming.tables;
  allActions.push(...naming.actions);

  // Pass 2: CHECK constraints
  const checks = injectCheckConstraints(current);
  current = checks.tables;
  allActions.push(...checks.actions);

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

  const durationMs = Math.round(performance.now() - startTime);

  const report: CompilerReport = {
    actions: allActions,
    tablesProcessed: tables.length,
    constraintsAdded: checks.actions.length,
    indexesAdded: fkIndexes.actions.length,
    namingFixes: naming.actions.length,
    durationMs,
  };

  return { tables: current, report };
}
