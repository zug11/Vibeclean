// ─── Schema Diff Engine for VibeDB ──────────────────────────

import type { TableNode, Column } from "@/lib/types";

// ─── Types ──────────────────────────────────────────────────

export interface SchemaDiff {
  addedTables: TableNode[];
  removedTables: TableNode[];
  modifiedTables: {
    name: string;
    addedColumns: Column[];
    removedColumns: Column[];
    modifiedColumns: { before: Column; after: Column }[];
    addedIndexes: any[];
    removedIndexes: any[];
  }[];
}

// ─── Helpers ────────────────────────────────────────────────

/** Normalize a constraint list to a comparable string */
function constraintKey(constraints?: { type: string; value?: string }[]): string {
  if (!constraints || constraints.length === 0) return "";
  return constraints
    .map(c => (c.value ? `${c.type}:${c.value}` : c.type))
    .sort()
    .join("|");
}

/** Check whether two columns differ in type or constraints */
function columnsAreDifferent(a: Column, b: Column): boolean {
  if (a.type.toLowerCase() !== b.type.toLowerCase()) return true;
  if (constraintKey(a.constraints) !== constraintKey(b.constraints)) return true;
  if (Boolean(a.isForeignKey) !== Boolean(b.isForeignKey)) return true;
  if (a.linkedTable?.toLowerCase() !== b.linkedTable?.toLowerCase()) return true;
  return false;
}

/** Normalize an index to a comparable key */
function indexKey(idx: { name: string; columns: string[]; type: string; unique: boolean }): string {
  return `${idx.name.toLowerCase()}|${idx.columns.map(c => c.toLowerCase()).sort().join(",")}|${idx.type}|${idx.unique}`;
}

// ─── Core Diff Logic ────────────────────────────────────────

export function computeSchemaDiff(before: TableNode[], after: TableNode[]): SchemaDiff {
  const beforeMap = new Map<string, TableNode>();
  for (const t of before) {
    beforeMap.set(t.name.toLowerCase(), t);
  }

  const afterMap = new Map<string, TableNode>();
  for (const t of after) {
    afterMap.set(t.name.toLowerCase(), t);
  }

  // Tables in `after` not in `before` → added
  const addedTables: TableNode[] = [];
  for (const t of after) {
    if (!beforeMap.has(t.name.toLowerCase())) {
      addedTables.push(t);
    }
  }

  // Tables in `before` not in `after` → removed
  const removedTables: TableNode[] = [];
  for (const t of before) {
    if (!afterMap.has(t.name.toLowerCase())) {
      removedTables.push(t);
    }
  }

  // Tables in both → compare columns and indexes
  const modifiedTables: SchemaDiff["modifiedTables"] = [];

  for (const afterTable of after) {
    const beforeTable = beforeMap.get(afterTable.name.toLowerCase());
    if (!beforeTable) continue;

    // Build column maps keyed by lowercase name
    const beforeCols = new Map<string, Column>();
    for (const c of beforeTable.columns) {
      beforeCols.set(c.name.toLowerCase(), c);
    }

    const afterCols = new Map<string, Column>();
    for (const c of afterTable.columns) {
      afterCols.set(c.name.toLowerCase(), c);
    }

    const addedColumns: Column[] = [];
    const removedColumns: Column[] = [];
    const modifiedColumns: { before: Column; after: Column }[] = [];

    // Detect added and modified columns
    for (const [key, afterCol] of afterCols) {
      const beforeCol = beforeCols.get(key);
      if (!beforeCol) {
        addedColumns.push(afterCol);
      } else if (columnsAreDifferent(beforeCol, afterCol)) {
        modifiedColumns.push({ before: beforeCol, after: afterCol });
      }
    }

    // Detect removed columns
    for (const [key, beforeCol] of beforeCols) {
      if (!afterCols.has(key)) {
        removedColumns.push(beforeCol);
      }
    }

    // Compare indexes
    const beforeIndexes = beforeTable.indexes || [];
    const afterIndexes = afterTable.indexes || [];

    const beforeIdxKeys = new Set(beforeIndexes.map(indexKey));
    const afterIdxKeys = new Set(afterIndexes.map(indexKey));

    const addedIndexes = afterIndexes.filter(idx => !beforeIdxKeys.has(indexKey(idx)));
    const removedIndexes = beforeIndexes.filter(idx => !afterIdxKeys.has(indexKey(idx)));

    // Only include table if something actually changed
    if (
      addedColumns.length > 0 ||
      removedColumns.length > 0 ||
      modifiedColumns.length > 0 ||
      addedIndexes.length > 0 ||
      removedIndexes.length > 0
    ) {
      modifiedTables.push({
        name: afterTable.name,
        addedColumns,
        removedColumns,
        modifiedColumns,
        addedIndexes,
        removedIndexes,
      });
    }
  }

  return { addedTables, removedTables, modifiedTables };
}

// ─── Migration SQL Generation ───────────────────────────────

/** Map a VibeDB column type to its SQL representation */
function sqlType(type: string): string {
  return type.toUpperCase();
}

/** Generate the inline constraint SQL for a column */
function columnConstraintsSQL(col: Column): string {
  let sql = "";
  if (!col.constraints) return sql;
  for (const c of col.constraints) {
    if (c.type === "primary") sql += " PRIMARY KEY";
    if (c.type === "notNull") sql += " NOT NULL";
    if (c.type === "unique") sql += " UNIQUE";
    if (c.type === "default" && c.value) {
      const val = c.value;
      const sqlKeywords = [
        "now()", "gen_random_uuid()", "true", "false",
        "CURRENT_TIMESTAMP", "current_timestamp",
        "CURRENT_DATE", "current_date",
        "CURRENT_TIME", "current_time",
        "NULL", "null",
      ];
      if (sqlKeywords.includes(val) || !isNaN(Number(val))) {
        sql += ` DEFAULT ${val}`;
      } else if (val.startsWith("'") || val.startsWith("(") || val.endsWith("()")) {
        sql += ` DEFAULT ${val}`;
      } else {
        sql += ` DEFAULT '${val}'`;
      }
    }
  }
  return sql;
}

/** Generate a full CREATE TABLE DDL for a table */
function createTableDDL(table: TableNode): string {
  const lines: string[] = [];
  const pkCols = table.columns.filter(c => c.constraints?.some(con => con.type === "primary"));

  for (const col of table.columns) {
    let line = `  ${col.name} ${sqlType(col.type)}`;
    for (const c of col.constraints || []) {
      if (c.type === "primary" && pkCols.length === 1) line += " PRIMARY KEY";
      if (c.type === "notNull") line += " NOT NULL";
      if (c.type === "unique") line += " UNIQUE";
      if (c.type === "default" && c.value) {
        const val = c.value;
        const sqlKeywords = [
          "now()", "gen_random_uuid()", "true", "false",
          "CURRENT_TIMESTAMP", "current_timestamp",
          "CURRENT_DATE", "current_date",
          "CURRENT_TIME", "current_time",
          "NULL", "null",
        ];
        if (sqlKeywords.includes(val) || !isNaN(Number(val))) {
          line += ` DEFAULT ${val}`;
        } else if (val.startsWith("'") || val.startsWith("(") || val.endsWith("()")) {
          line += ` DEFAULT ${val}`;
        } else {
          line += ` DEFAULT '${val}'`;
        }
      }
    }
    if (col.isForeignKey && col.linkedTable) {
      line += ` REFERENCES ${col.linkedTable}(${col.linkedColumn || "id"})`;
      if (col.onDelete) line += ` ON DELETE ${col.onDelete}`;
    }
    lines.push(line);
  }

  // Composite primary key
  if (pkCols.length > 1) {
    lines.push(`  PRIMARY KEY (${pkCols.map(c => c.name).join(", ")})`);
  }

  return `CREATE TABLE ${table.name} (\n${lines.join(",\n")}\n);`;
}

export function generateMigrationSQL(diff: SchemaDiff): string {
  const statements: string[] = [];

  statements.push("-- Migration generated by VibeDB Schema Compare");
  statements.push("");

  // 1. DROP removed tables
  if (diff.removedTables.length > 0) {
    statements.push("-- Removed Tables");
    for (const table of diff.removedTables) {
      statements.push(`DROP TABLE IF EXISTS ${table.name} CASCADE;`);
    }
    statements.push("");
  }

  // 2. CREATE added tables (full DDL)
  if (diff.addedTables.length > 0) {
    statements.push("-- Added Tables");
    for (const table of diff.addedTables) {
      statements.push(createTableDDL(table));
      statements.push("");

      // Add indexes for the new table if present
      if (table.indexes && table.indexes.length > 0) {
        for (const idx of table.indexes) {
          const unique = idx.unique ? "UNIQUE " : "";
          const where = idx.where ? ` WHERE ${idx.where}` : "";
          statements.push(
            `CREATE ${unique}INDEX ${idx.name} ON ${table.name}(${idx.columns.join(", ")})${where};`
          );
        }
        statements.push("");
      }
    }
  }

  // 3. ALTER modified tables
  if (diff.modifiedTables.length > 0) {
    statements.push("-- Modified Tables");
    for (const mod of diff.modifiedTables) {
      // Added columns
      for (const col of mod.addedColumns) {
        let line = `ALTER TABLE ${mod.name} ADD COLUMN ${col.name} ${sqlType(col.type)}`;
        line += columnConstraintsSQL(col);
        if (col.isForeignKey && col.linkedTable) {
          line += ` REFERENCES ${col.linkedTable}(${col.linkedColumn || "id"})`;
          if (col.onDelete) line += ` ON DELETE ${col.onDelete}`;
        }
        line += ";";
        statements.push(line);
      }

      // Removed columns
      for (const col of mod.removedColumns) {
        statements.push(`ALTER TABLE ${mod.name} DROP COLUMN IF EXISTS ${col.name};`);
      }

      // Modified columns (type changes)
      for (const { before, after } of mod.modifiedColumns) {
        if (before.type.toLowerCase() !== after.type.toLowerCase()) {
          statements.push(
            `ALTER TABLE ${mod.name} ALTER COLUMN ${after.name} TYPE ${sqlType(after.type)} USING ${after.name}::${sqlType(after.type)};`
          );
        }

        // Check for NOT NULL changes
        const beforeNotNull = before.constraints?.some(c => c.type === "notNull") || false;
        const afterNotNull = after.constraints?.some(c => c.type === "notNull") || false;
        if (!beforeNotNull && afterNotNull) {
          statements.push(`ALTER TABLE ${mod.name} ALTER COLUMN ${after.name} SET NOT NULL;`);
        } else if (beforeNotNull && !afterNotNull) {
          statements.push(`ALTER TABLE ${mod.name} ALTER COLUMN ${after.name} DROP NOT NULL;`);
        }

        // Check for DEFAULT changes
        const beforeDefault = before.constraints?.find(c => c.type === "default");
        const afterDefault = after.constraints?.find(c => c.type === "default");
        if (afterDefault?.value && afterDefault.value !== beforeDefault?.value) {
          const val = afterDefault.value;
          const sqlKeywords = [
            "now()", "gen_random_uuid()", "true", "false",
            "CURRENT_TIMESTAMP", "current_timestamp",
            "NULL", "null",
          ];
          if (sqlKeywords.includes(val) || !isNaN(Number(val)) || val.startsWith("'") || val.endsWith("()")) {
            statements.push(`ALTER TABLE ${mod.name} ALTER COLUMN ${after.name} SET DEFAULT ${val};`);
          } else {
            statements.push(`ALTER TABLE ${mod.name} ALTER COLUMN ${after.name} SET DEFAULT '${val}';`);
          }
        } else if (beforeDefault?.value && !afterDefault?.value) {
          statements.push(`ALTER TABLE ${mod.name} ALTER COLUMN ${after.name} DROP DEFAULT;`);
        }
      }

      // Added indexes
      for (const idx of mod.addedIndexes) {
        const unique = idx.unique ? "UNIQUE " : "";
        const where = idx.where ? ` WHERE ${idx.where}` : "";
        statements.push(
          `CREATE ${unique}INDEX ${idx.name} ON ${mod.name}(${idx.columns.join(", ")})${where};`
        );
      }

      // Removed indexes
      for (const idx of mod.removedIndexes) {
        statements.push(`DROP INDEX IF EXISTS ${idx.name};`);
      }

      statements.push("");
    }
  }

  // If nothing changed, say so
  if (
    diff.addedTables.length === 0 &&
    diff.removedTables.length === 0 &&
    diff.modifiedTables.length === 0
  ) {
    statements.push("-- No changes detected between schemas.");
  }

  return statements.join("\n");
}
