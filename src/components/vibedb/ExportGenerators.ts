// ─── Export Generators for VibeDB ────────────────────────

interface Column {
  id: string;
  name: string;
  type: string;
  isForeignKey?: boolean;
  linkedTable?: string;
  linkedTableId?: string;
  linkedColumn?: string;
  fkStatus?: string;
  constraints?: { type: string; value?: string }[];
}

interface TableNode {
  id: string;
  name: string;
  columns: Column[];
  x: number;
  y: number;
  indexes?: { name: string; columns: string[]; type: string; unique: boolean; where?: string }[];
  checkConstraints?: { name: string; expression: string }[];
}

export interface SchemaEnum {
  name: string;
  values: string[];
}

export interface SchemaFunction {
  name: string;
  body: string;
}

// ─── Sanitize a single table's columns before SQL generation ─────────
// Deduplicates columns, ensures exactly one PK on 'id', removes extra PKs,
// and ensures an 'id' column exists (required for FK references).
export function sanitizeColumnsForSQL(columns: Column[]): Column[] {
  const seen = new Set<string>();
  const deduped: Column[] = [];

  for (const col of columns) {
    const key = col.name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(col);
  }

  // Ensure 'id' column exists — if missing, prepend one (FKs default to referencing id)
  const hasId = deduped.some(c => c.name.toLowerCase() === "id");
  if (!hasId) {
    deduped.unshift({
      id: "sanitize-" + Math.random().toString(36).slice(2, 9),
      name: "id",
      type: "uuid",
      constraints: [{ type: "primary" }, { type: "notNull" }],
    });
  }

  // Ensure exactly one PK: should be on 'id' column
  const fixed = deduped.map(col => {
    const isPK = col.constraints?.some(c => c.type === "primary");
    if (col.name.toLowerCase() === "id") {
      if (!isPK) {
        return { ...col, constraints: [{ type: "primary" }, ...(col.constraints || []).filter(c => c.type !== "primary")] };
      }
      return col;
    }
    // Remove PK from non-id columns to avoid "multiple primary keys" error
    if (isPK) {
      return { ...col, constraints: (col.constraints || []).filter(c => c.type !== "primary") };
    }
    return col;
  });

  return fixed;
}

// ─── Detect FK references to tables that don't exist in the schema ───
export function detectMissingFKTargets(tables: TableNode[]): { table: string; column: string; missingRef: string }[] {
  const tableNames = new Set(tables.map(t => t.name.toLowerCase()));
  const missing: { table: string; column: string; missingRef: string }[] = [];

  for (const t of tables) {
    for (const c of t.columns) {
      if (c.isForeignKey && c.linkedTable) {
        if (!tableNames.has(c.linkedTable.toLowerCase())) {
          missing.push({ table: t.name, column: c.name, missingRef: c.linkedTable });
        }
      }
    }
  }
  return missing;
}

// ─── Deploy Error Classification & Auto-Fix Engine ──────────────────

type DeployErrorCode =
  | "MISSING_RELATION"    // 42P01 - relation "X" does not exist
  | "DUPLICATE_COLUMN"    // 42701 - column "X" specified more than once
  | "MISSING_FK_COLUMN"   // 42703 - column "X" referenced in foreign key constraint does not exist
  | "MULTIPLE_PKS"        // 42P16 - multiple primary keys for table
  | "RELATION_EXISTS"     // 42P07 - relation "X" already exists
  | "UNKNOWN";

interface ClassifiedError {
  code: DeployErrorCode;
  tableName: string | null;
  columnName: string | null;
  referencedTable: string | null;
  rawError: string;
  rawStatement: string;
}

export interface FixAction {
  type: "create_table" | "dedup_columns" | "fix_pks" | "fix_missing_pk_col" | "skip_existing" | "unfixable" | "reorder_fks";
  tableName: string;
  description: string;
}

export interface FixResult {
  fixedItems: TableNode[];
  actions: FixAction[];
  hasUnfixable: boolean;
  deferForeignKeys?: boolean; // Signal to regenerate SQL with deferred FK constraints
}

// Extract table name from a CREATE TABLE statement (may be truncated to 80 chars)
function extractTableNameFromStatement(stmt: string): string | null {
  const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/i);
  return m ? m[1] : null;
}

// Extract the human-readable error message from Supabase error responses.
// Supabase returns errors as JSON: {"code":"42P01","message":"relation \"users\" does not exist"}
// or sometimes as plain text. This extracts the clean message either way.
function extractErrorMessage(err: string): string {
  if (!err) return "";

  // Strategy 1: direct JSON.parse
  try {
    const parsed = JSON.parse(err);
    if (typeof parsed === "object" && parsed !== null) {
      if (parsed.message) return String(parsed.message);
      if (parsed.error) return String(parsed.error);
      if (parsed.msg) return String(parsed.msg);
    }
    if (typeof parsed === "string") return parsed;
  } catch {
    // Not valid JSON, continue to fallback strategies
  }

  // Strategy 2: regex to find "message":"..." in the raw string (handles escaped quotes)
  const msgMatch = err.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (msgMatch) {
    return msgMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Strategy 3: look for common PG error patterns directly in raw string
  // (e.g. the raw string itself might contain `relation \"users\" does not exist`)
  const directPatterns = [
    /relation\s+\\?"(\w+)\\?"\s+does not exist/i,
    /column\s+\\?"(\w+)\\?"\s+specified more than once/i,
    /multiple primary keys/i,
    /relation\s+\\?"(\w+)\\?"\s+already exists/i,
  ];
  for (const p of directPatterns) {
    if (p.test(err)) return err; // return raw — the classify function will match it
  }

  return err; // fallback: use raw error string
}

// Try to match a "relation does not exist" pattern in text that may have escaped or unescaped quotes
function matchMissingRelation(text: string): string | null {
  // Unescaped: relation "users" does not exist
  const m1 = text.match(/relation\s+"(\w+)"\s+does not exist/i);
  if (m1) return m1[1];
  // Escaped (JSON string): relation \"users\" does not exist  OR  relation \\"users\\" does not exist
  const m2 = text.match(/relation\s+\\+"(\w+)\\+"\s+does not exist/i);
  if (m2) return m2[1];
  // Loose: just find the pattern with any quoting
  const m3 = text.match(/relation\s+[\\"]?(\w+)[\\"]?\s+does not exist/i);
  if (m3) return m3[1];
  return null;
}

function matchDuplicateColumn(text: string): string | null {
  const m1 = text.match(/column\s+"(\w+)"\s+specified more than once/i);
  if (m1) return m1[1];
  const m2 = text.match(/column\s+\\+"(\w+)\\+"\s+specified more than once/i);
  if (m2) return m2[1];
  const m3 = text.match(/column\s+[\\"]?(\w+)[\\"]?\s+specified more than once/i);
  if (m3) return m3[1];
  return null;
}

function matchMissingFKColumn(text: string): string | null {
  // column "id" referenced in foreign key constraint does not exist
  const m1 = text.match(/column\s+"(\w+)"\s+referenced in foreign key/i);
  if (m1) return m1[1];
  const m2 = text.match(/column\s+\\+"(\w+)\\+"\s+referenced in foreign key/i);
  if (m2) return m2[1];
  const m3 = text.match(/column\s+[\\"]?(\w+)[\\"]?\s+referenced in foreign key/i);
  if (m3) return m3[1];
  return null;
}

function matchExistingRelation(text: string): string | null {
  const m1 = text.match(/relation\s+"(\w+)"\s+already exists/i);
  if (m1) return m1[1];
  const m2 = text.match(/relation\s+\\+"(\w+)\\+"\s+already exists/i);
  if (m2) return m2[1];
  const m3 = text.match(/relation\s+[\\"]?(\w+)[\\"]?\s+already exists/i);
  if (m3) return m3[1];
  return null;
}

// Classify a single deploy error — uses multiple matching strategies
function classifyDeployError(result: { statement: string; success: boolean; error?: string }): ClassifiedError | null {
  if (result.success || !result.error) return null;

  const rawErr = result.error;
  const msg = extractErrorMessage(rawErr);
  const stmt = result.statement;
  const tableName = extractTableNameFromStatement(stmt);

  // Try matching against both the extracted message AND the raw error string
  // This handles cases where JSON parsing fails but the raw string still has the pattern
  const textsToCheck = [msg, rawErr];

  // 42P01: relation "X" does not exist
  for (const text of textsToCheck) {
    const missingTable = matchMissingRelation(text);
    if (missingTable) {
      return { code: "MISSING_RELATION", tableName, columnName: null, referencedTable: missingTable, rawError: rawErr, rawStatement: stmt };
    }
  }

  // 42701: column "X" specified more than once
  for (const text of textsToCheck) {
    const dupCol = matchDuplicateColumn(text);
    if (dupCol) {
      return { code: "DUPLICATE_COLUMN", tableName, columnName: dupCol, referencedTable: null, rawError: rawErr, rawStatement: stmt };
    }
  }

  // 42703: column "X" referenced in foreign key constraint does not exist
  for (const text of textsToCheck) {
    const missingFKCol = matchMissingFKColumn(text);
    if (missingFKCol) {
      return { code: "MISSING_FK_COLUMN", tableName, columnName: missingFKCol, referencedTable: null, rawError: rawErr, rawStatement: stmt };
    }
  }

  // 42P16: multiple primary keys
  for (const text of textsToCheck) {
    if (/multiple primary keys/i.test(text)) {
      return { code: "MULTIPLE_PKS", tableName, columnName: null, referencedTable: null, rawError: rawErr, rawStatement: stmt };
    }
  }

  // 42P07: relation already exists
  for (const text of textsToCheck) {
    const existsTable = matchExistingRelation(text);
    if (existsTable) {
      return { code: "RELATION_EXISTS", tableName, columnName: null, referencedTable: existsTable, rawError: rawErr, rawStatement: stmt };
    }
  }

  // Also check for PG error codes directly in the raw string (fallback)
  if (/42P01/i.test(rawErr)) {
    // We know it's a missing relation error even if we can't extract the table name
    // Try to find any quoted word near "does not exist"
    const fallback = rawErr.match(/[\\"](\w+)[\\"].*does not exist/i);
    if (fallback) {
      return { code: "MISSING_RELATION", tableName, columnName: null, referencedTable: fallback[1], rawError: rawErr, rawStatement: stmt };
    }
  }
  if (/42701/i.test(rawErr)) {
    return { code: "DUPLICATE_COLUMN", tableName, columnName: null, referencedTable: null, rawError: rawErr, rawStatement: stmt };
  }
  if (/42703/i.test(rawErr)) {
    return { code: "MISSING_FK_COLUMN", tableName, columnName: "id", referencedTable: null, rawError: rawErr, rawStatement: stmt };
  }
  if (/42P16/i.test(rawErr)) {
    return { code: "MULTIPLE_PKS", tableName, columnName: null, referencedTable: null, rawError: rawErr, rawStatement: stmt };
  }
  if (/42P07/i.test(rawErr)) {
    const fallback = rawErr.match(/[\\"](\w+)[\\"].*already exists/i);
    return { code: "RELATION_EXISTS", tableName, columnName: null, referencedTable: fallback ? fallback[1] : null, rawError: rawErr, rawStatement: stmt };
  }

  return { code: "UNKNOWN", tableName, columnName: null, referencedTable: null, rawError: rawErr, rawStatement: stmt };
}

// Simple UUID generator (avoids importing uuid in this utility file)
function simpleId(): string {
  return "fix-" + Math.random().toString(36).slice(2, 11) + "-" + Date.now().toString(36);
}

// Pre-deploy validation: scan canvas items for issues that would cause deploy errors.
// This runs BEFORE deploying and returns synthetic "deploy results" for any issues found.
export function preDeployValidateSchema(
  canvasItems: TableNode[]
): { statement: string; success: boolean; error?: string }[] {
  const syntheticErrors: { statement: string; success: boolean; error?: string }[] = [];
  const tableNames = new Set(canvasItems.map(t => t.name.toLowerCase()));

  for (const t of canvasItems) {
    const stmt = `CREATE TABLE IF NOT EXISTS ${t.name} (...)`;

    // Check for FK references to missing tables (report each unique missing reference)
    const reportedMissing = new Set<string>();
    for (const c of t.columns) {
      if (c.isForeignKey && c.linkedTable && !tableNames.has(c.linkedTable.toLowerCase())) {
        const key = c.linkedTable.toLowerCase();
        if (!reportedMissing.has(key)) {
          reportedMissing.add(key);
          syntheticErrors.push({
            statement: stmt,
            success: false,
            error: JSON.stringify({ code: "42P01", message: `relation "${c.linkedTable}" does not exist` }),
          });
        }
      }
    }

    // Check for duplicate columns
    const colNames = new Set<string>();
    for (const c of t.columns) {
      const key = c.name.toLowerCase();
      if (colNames.has(key)) {
        syntheticErrors.push({
          statement: stmt,
          success: false,
          error: JSON.stringify({ code: "42701", message: `column "${c.name}" specified more than once` }),
        });
        break;
      }
      colNames.add(key);
    }

    // Check for multiple primary keys
    const pkCols = t.columns.filter(c => c.constraints?.some(x => x.type === "primary"));
    if (pkCols.length > 1) {
      syntheticErrors.push({
        statement: stmt,
        success: false,
        error: JSON.stringify({ code: "42P16", message: `multiple primary keys for table "${t.name}" are not allowed` }),
      });
    }
  }

  return syntheticErrors;
}

// Main fix function: diagnose deploy errors and return a fixed schema
export function diagnoseAndFixSchema(
  canvasItems: TableNode[],
  deployResults: { statement: string; success: boolean; error?: string }[],
  viewState: { x: number; y: number; zoom: number }
): FixResult {
  // DEBUG: Log inputs to help trace "Fixed 0 issues" bug
  console.log("[VibeDB Fix] diagnoseAndFixSchema called with:", {
    canvasItemCount: canvasItems.length,
    deployResultCount: deployResults.length,
    failedResults: deployResults.filter(r => !r.success).length,
  });
  // Log each failed result's error for debugging
  deployResults.filter(r => !r.success).forEach((r, i) => {
    console.log(`[VibeDB Fix] Error ${i}:`, { statement: r.statement, error: r.error, errorType: typeof r.error });
  });

  // 1. Classify all errors
  const classified: ClassifiedError[] = [];
  for (const r of deployResults) {
    const c = classifyDeployError(r);
    if (c) {
      console.log(`[VibeDB Fix] Classified:`, c.code, c.referencedTable || c.tableName);
    } else if (!r.success) {
      console.log(`[VibeDB Fix] UNCLASSIFIED (null returned):`, { error: r.error });
    }
    if (c) classified.push(c);
  }

  console.log(`[VibeDB Fix] Total classified: ${classified.length}`, classified.map(c => c.code));

  if (classified.length === 0) {
    console.warn("[VibeDB Fix] No errors classified — returning 0 fixes. This is likely a parsing bug.");
    return { fixedItems: canvasItems, actions: [], hasUnfixable: false };
  }

  // 2. Deep clone canvas items
  const fixedItems: TableNode[] = JSON.parse(JSON.stringify(canvasItems));
  const actions: FixAction[] = [];
  const existingTableNames = new Set(fixedItems.map(t => t.name.toLowerCase()));
  const createdTableNames = new Set<string>();

  // 3. Process MISSING_RELATION errors — create missing tables or flag ordering issues
  const missingRelations = classified.filter(e => e.code === "MISSING_RELATION");
  const uniqueMissingTables = [...new Set(missingRelations.map(e => e.referencedTable!).filter(Boolean))];
  let needsDeferredFKs = false;

  let createIndex = 0;
  for (const missingName of uniqueMissingTables) {
    if (existingTableNames.has(missingName.toLowerCase()) || createdTableNames.has(missingName.toLowerCase())) {
      // Table EXISTS on canvas but Supabase says it doesn't exist — this is an ordering issue.
      // The FK references a table that hasn't been created YET in the deploy sequence.
      // Fix: mark for deferred FK generation (ALTER TABLE ADD CONSTRAINT after all tables created)
      needsDeferredFKs = true;
      actions.push({
        type: "reorder_fks",
        tableName: missingName,
        description: `Table exists but was deployed out of order — FKs will be deferred`,
      });
      continue;
    }

    // Determine the FK column type from the referencing columns to match the id type
    let idType = "uuid";
    for (const t of fixedItems) {
      for (const c of t.columns) {
        if (c.isForeignKey && c.linkedTable?.toLowerCase() === missingName.toLowerCase()) {
          // The FK column type hints at what the referenced id type should be
          const colType = c.type.toLowerCase();
          if (colType.includes("int") || colType === "serial" || colType === "bigint" || colType === "smallint") {
            idType = colType.includes("big") ? "bigint" : colType.includes("small") ? "smallint" : "int";
          }
          break;
        }
      }
    }

    // Position new tables in a grid layout
    const offsetX = (-viewState.x / viewState.zoom) + 100 + (createIndex % 4) * 280;
    const offsetY = (-viewState.y / viewState.zoom) - 200 - Math.floor(createIndex / 4) * 200;

    const newTableId = simpleId();
    const newTable: TableNode = {
      id: newTableId,
      name: missingName,
      x: offsetX,
      y: offsetY,
      columns: [
        { id: simpleId(), name: "id", type: idType, constraints: [{ type: "primary" }, { type: "notNull" }], fkStatus: "resolved" },
        { id: simpleId(), name: "created_at", type: "timestamp", constraints: [{ type: "default", value: "now()" }], fkStatus: "resolved" },
        { id: simpleId(), name: "updated_at", type: "timestamp", constraints: [{ type: "default", value: "now()" }], fkStatus: "resolved" },
      ],
    };

    fixedItems.push(newTable);
    existingTableNames.add(missingName.toLowerCase());
    createdTableNames.add(missingName.toLowerCase());
    createIndex++;

    // Resolve FK references across all existing tables that point to this new table
    for (const t of fixedItems) {
      for (const c of t.columns) {
        if (c.isForeignKey && c.linkedTable?.toLowerCase() === missingName.toLowerCase()) {
          c.linkedTableId = newTableId;
          c.fkStatus = "resolved";
        }
      }
    }

    actions.push({
      type: "create_table",
      tableName: missingName,
      description: `Created missing table with id (${idType}), created_at, updated_at`,
    });
  }

  // 4. Process DUPLICATE_COLUMN errors — deduplicate columns
  const dupColumnErrors = classified.filter(e => e.code === "DUPLICATE_COLUMN");
  const dupTableNames = new Set(dupColumnErrors.map(e => e.tableName).filter(Boolean) as string[]);

  for (const tableName of dupTableNames) {
    const tableIdx = fixedItems.findIndex(t => t.name.toLowerCase() === tableName.toLowerCase());
    if (tableIdx === -1) continue;

    const table = fixedItems[tableIdx];
    const seen = new Set<string>();
    const beforeCount = table.columns.length;
    table.columns = table.columns.filter(col => {
      const key = col.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const removedCount = beforeCount - table.columns.length;

    if (removedCount > 0) {
      actions.push({
        type: "dedup_columns",
        tableName,
        description: `Removed ${removedCount} duplicate column${removedCount !== 1 ? "s" : ""}`,
      });
    }
  }

  // 5. Process MULTIPLE_PKS errors — fix primary key constraints
  const multiPkErrors = classified.filter(e => e.code === "MULTIPLE_PKS");
  const multiPkTableNames = new Set(multiPkErrors.map(e => e.tableName).filter(Boolean) as string[]);

  for (const tableName of multiPkTableNames) {
    const tableIdx = fixedItems.findIndex(t => t.name.toLowerCase() === tableName.toLowerCase());
    if (tableIdx === -1) continue;

    const table = fixedItems[tableIdx];
    let hasId = false;

    table.columns = table.columns.map(col => {
      const isPK = col.constraints?.some(c => c.type === "primary");
      if (col.name.toLowerCase() === "id") {
        hasId = true;
        if (!isPK) {
          return { ...col, constraints: [{ type: "primary" }, { type: "notNull" }, ...(col.constraints || []).filter(c => c.type !== "primary" && c.type !== "notNull")] };
        }
        return col;
      }
      if (isPK) {
        return { ...col, constraints: (col.constraints || []).filter(c => c.type !== "primary") };
      }
      return col;
    });

    // If no id column, prepend one
    if (!hasId) {
      table.columns.unshift({
        id: simpleId(), name: "id", type: "uuid",
        constraints: [{ type: "primary" }, { type: "notNull" }],
        fkStatus: "resolved",
      });
    }

    actions.push({
      type: "fix_pks",
      tableName,
      description: "Fixed to single primary key on id column",
    });
  }

  // 5b. Process MISSING_FK_COLUMN errors — the FK target table doesn't have the referenced column (usually "id")
  // Fix: ensure every table has an "id" PK column
  const missingFKColErrors = classified.filter(e => e.code === "MISSING_FK_COLUMN");
  const missingFKColTableNames = new Set<string>();

  for (const e of missingFKColErrors) {
    // Strategy 1: parse REFERENCES target_table(id) from the statement
    const refMatch = e.rawStatement.match(/REFERENCES\s+(\w+)\s*\(/i);
    if (refMatch) {
      missingFKColTableNames.add(refMatch[1].toLowerCase());
      continue;
    }

    // Strategy 2: parse constraint name fk_sourcetable_columnname, then look up the
    // FK column on canvas to find which table it references
    const constraintMatch = e.rawStatement.match(/CONSTRAINT\s+(\w+)/i);
    const fkColMatch = e.rawStatement.match(/FOREIGN\s+KEY\s*\((\w+)\)/i);
    // Also extract the source table from ALTER TABLE source_table
    const alterMatch = e.rawStatement.match(/ALTER\s+TABLE\s+(\w+)/i);

    if (alterMatch && fkColMatch) {
      const sourceTableName = alterMatch[1].toLowerCase();
      const fkColName = fkColMatch[1].toLowerCase();
      // Find this column on the canvas and see what table it links to
      const sourceTable = fixedItems.find(t => t.name.toLowerCase() === sourceTableName);
      if (sourceTable) {
        const fkCol = sourceTable.columns.find(c => c.name.toLowerCase() === fkColName && c.isForeignKey && c.linkedTable);
        if (fkCol && fkCol.linkedTable) {
          missingFKColTableNames.add(fkCol.linkedTable.toLowerCase());
          continue;
        }
      }
    }

    // Strategy 3: from constraint name pattern fk_source_column
    if (constraintMatch) {
      const parts = constraintMatch[1].split("_");
      // fk_tablename_colname → parts = ["fk", "tablename", "colname"]
      if (parts.length >= 3 && parts[0] === "fk") {
        const sourceTableName = parts[1].toLowerCase();
        const fkColName = parts.slice(2).join("_").toLowerCase();
        const sourceTable = fixedItems.find(t => t.name.toLowerCase() === sourceTableName);
        if (sourceTable) {
          const fkCol = sourceTable.columns.find(c => c.name.toLowerCase() === fkColName && c.isForeignKey && c.linkedTable);
          if (fkCol && fkCol.linkedTable) {
            missingFKColTableNames.add(fkCol.linkedTable.toLowerCase());
            continue;
          }
        }
      }
    }

    // Strategy 4: fallback — if nothing works, scan ALL tables and ensure they all have id
    // (This is a broad fix but prevents the error from being unfixable)
    if (e.tableName) {
      missingFKColTableNames.add(e.tableName.toLowerCase());
    }
  }

  // If we have MISSING_FK_COLUMN errors but couldn't identify specific targets,
  // ensure ALL tables in the schema have an id column (safe broad fix)
  if (missingFKColErrors.length > 0 && missingFKColTableNames.size === 0) {
    for (const t of fixedItems) {
      missingFKColTableNames.add(t.name.toLowerCase());
    }
  }

  for (const tblNameLower of missingFKColTableNames) {
    const tableIdx = fixedItems.findIndex(t => t.name.toLowerCase() === tblNameLower);
    if (tableIdx === -1) continue;

    const table = fixedItems[tableIdx];
    const hasId = table.columns.some(c => c.name.toLowerCase() === "id");
    if (!hasId) {
      // Find what type the FK columns expect — look at FK columns referencing this table
      let idType = "uuid";
      for (const t of fixedItems) {
        for (const c of t.columns) {
          if (c.isForeignKey && c.linkedTable?.toLowerCase() === tblNameLower) {
            const colType = c.type.toLowerCase();
            if (colType.includes("int") || colType === "serial" || colType === "bigint") {
              idType = colType.includes("big") ? "bigint" : "int";
            }
            break;
          }
        }
      }
      table.columns.unshift({
        id: simpleId(), name: "id", type: idType,
        constraints: [{ type: "primary" }, { type: "notNull" }],
        fkStatus: "resolved",
      });
      actions.push({
        type: "fix_missing_pk_col",
        tableName: table.name,
        description: `Added missing "id" column (${idType}) — required by FK references`,
      });
    }
  }

  // 6. Process RELATION_EXISTS — informational only
  const existsErrors = classified.filter(e => e.code === "RELATION_EXISTS");
  for (const e of existsErrors) {
    actions.push({
      type: "skip_existing",
      tableName: e.tableName || e.referencedTable || "unknown",
      description: "Table already exists in target database (safe to skip)",
    });
  }

  // 7. Process UNKNOWN — unfixable
  const unknownErrors = classified.filter(e => e.code === "UNKNOWN");
  for (const e of unknownErrors) {
    actions.push({
      type: "unfixable",
      tableName: e.tableName || "unknown",
      description: e.rawError.substring(0, 120),
    });
  }

  // 8. Final safety pass: sanitize all tables' columns
  for (const t of fixedItems) {
    t.columns = sanitizeColumnsForSQL(t.columns);
  }

  return {
    fixedItems,
    actions,
    hasUnfixable: unknownErrors.length > 0,
    deferForeignKeys: needsDeferredFKs,
  };
}

// ─── SQL Generation ─────────────────────────────────────────────────

// Generate SQL with all FK constraints inline (original mode)
export function generateSQL(tables: TableNode[], enums?: SchemaEnum[], functions?: SchemaFunction[]): string {
  return generateSQLInternal(tables, false, enums, functions);
}

// Generate SQL with deferred FK constraints (ALTER TABLE at the end)
export function generateSQLDeferred(tables: TableNode[], enums?: SchemaEnum[], functions?: SchemaFunction[]): string {
  return generateSQLInternal(tables, true, enums, functions);
}

// Find the PK column name for a given table — returns "id" as fallback
function findPKColumn(tables: TableNode[], tableName: string): string {
  const table = tables.find(t => t.name.toLowerCase() === tableName.toLowerCase());
  if (!table) return "id";
  const pkCol = table.columns.find(c => c.constraints?.some(con => con.type === "primary"));
  return pkCol ? pkCol.name : "id";
}

function generateSQLInternal(tables: TableNode[], deferFKs: boolean, enums?: SchemaEnum[], functions?: SchemaFunction[]): string {
  // Topological sort: create parent tables before child tables
  const sorted = topologicalSort(tables);
  const tableNames = new Set(tables.map(t => t.name.toLowerCase()));

  // Collect any missing FK targets for a warning comment
  const missingTargets = detectMissingFKTargets(tables);
  const missingTableNames = [...new Set(missingTargets.map(m => m.missingRef))];

  // Track deferred FK constraints to add at the end
  const deferredFKs: string[] = [];

  let sql = "-- Generated by VibeDB\n";

  // Enum types — must be created BEFORE tables that reference them
  // Edge function treats "already exists" / 42710 as idempotent success
  if (enums && enums.length > 0) {
    sql += "\n-- Enum Types\n";
    for (const e of enums) {
      const vals = e.values.map(v => `'${v}'`).join(", ");
      sql += `CREATE TYPE ${e.name} AS ENUM (${vals});\n`;
    }
    sql += "\n";
  }

  if (deferFKs) {
    sql += "-- Mode: Deferred FK constraints (tables created first, then FK references added via ALTER TABLE)\n";
  }

  if (missingTableNames.length > 0) {
    sql += `-- WARNING: The following referenced tables are NOT in this schema:\n`;
    sql += `--    ${missingTableNames.join(", ")}\n`;
    sql += `--    FK constraints referencing these tables have been commented out.\n`;
    sql += `--    Create these tables first, or add them to your schema.\n`;
  }

  sql += "\n";

  // In deferred FK mode (used for deploy), drop existing tables first so re-deploys
  // always apply the latest schema. CASCADE removes dependent FK constraints.
  if (deferFKs) {
    sql += "-- Drop existing tables (reverse order to respect dependencies)\n";
    const reversed = [...sorted].reverse();
    for (const t of reversed) {
      sql += `DROP TABLE IF EXISTS ${t.name} CASCADE;\n`;
    }
    sql += "\n";
  }

  sorted.forEach(t => {
    // Sanitize columns: deduplicate, fix PKs
    const cleanColumns = sanitizeColumnsForSQL(t.columns);

    sql += `CREATE TABLE ${t.name} (\n`;
    const lines: string[] = [];
    cleanColumns.forEach(col => {
      let line = `  ${col.name} ${col.type.toUpperCase()}`;
      col.constraints?.forEach(c => {
        if (c.type === "primary") line += " PRIMARY KEY";
        if (c.type === "notNull") line += " NOT NULL";
        if (c.type === "unique") line += " UNIQUE";
        if (c.type === "default" && c.value) {
          const val = c.value;
          if (val === "now()" || val === "gen_random_uuid()" || val === "true" || val === "false" || !isNaN(Number(val))) {
            line += ` DEFAULT ${val}`;
          } else if (val.startsWith("'") || val.startsWith("(")) {
            line += ` DEFAULT ${val}`;
          } else {
            line += ` DEFAULT '${val}'`;
          }
        }
      });
      if (col.isForeignKey && col.linkedTable) {
        // Resolve the target column: use linkedColumn if set, otherwise find the PK of the target table
        const targetCol = col.linkedColumn || findPKColumn(tables, col.linkedTable);
        if (tableNames.has(col.linkedTable.toLowerCase())) {
          if (deferFKs) {
            // In deferred mode, skip inline FK and collect for ALTER TABLE at the end
            // The edge function treats "already exists" errors as success for idempotent re-deploys
            const constraintName = `fk_${t.name}_${col.name}`.toLowerCase();
            deferredFKs.push(
              `ALTER TABLE ${t.name} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${col.name}) REFERENCES ${col.linkedTable}(${targetCol}) DEFERRABLE INITIALLY DEFERRED;`
            );
          } else {
            line += ` REFERENCES ${col.linkedTable}(${targetCol})`;
          }
        } else {
          line += ` /* REFERENCES ${col.linkedTable}(${targetCol}) -- table not in schema */`;
        }
      }
      lines.push(line);
    });
    sql += lines.join(",\n");
    sql += "\n);\n\n";
  });

  // Add deferred FK constraints at the end (all tables exist at this point)
  if (deferredFKs.length > 0) {
    sql += "-- Foreign Key Constraints (deferred to avoid ordering issues)\n";
    sql += "-- These run after ALL tables have been created\n\n";
    for (const fk of deferredFKs) {
      sql += fk + "\n";
    }
    sql += "\n";
  }

  // Add CHECK constraints
  const allChecks = sorted.filter(t => t.checkConstraints && t.checkConstraints.length > 0);
  if (allChecks.length > 0) {
    sql += "-- CHECK Constraints\n";
    for (const t of allChecks) {
      for (const chk of t.checkConstraints!) {
        sql += `ALTER TABLE ${t.name} ADD CONSTRAINT ${chk.name} CHECK (${chk.expression});\n`;
      }
    }
    sql += "\n";
  }

  // Add Indexes (including partial indexes with WHERE)
  const allIndexes = sorted.filter(t => t.indexes && t.indexes.length > 0);
  if (allIndexes.length > 0) {
    sql += "-- Indexes\n";
    for (const t of allIndexes) {
      for (const idx of t.indexes!) {
        const unique = idx.unique ? "UNIQUE " : "";
        const where = idx.where ? ` WHERE ${idx.where}` : "";
        sql += `CREATE ${unique}INDEX ${idx.name} ON ${t.name}(${idx.columns.join(", ")})${where};\n`;
      }
    }
    sql += "\n";
  }

  // Functions & Triggers — created AFTER tables
  if (functions && functions.length > 0) {
    sql += "-- Functions & Triggers\n";
    for (const fn of functions) {
      sql += fn.body + "\n\n";
    }
  }

  return sql;
}

function topologicalSort(tables: TableNode[]): TableNode[] {
  const tableNames = new Set(tables.map(t => t.name.toLowerCase()));
  const tableMap = new Map<string, TableNode>();
  tables.forEach(t => tableMap.set(t.name.toLowerCase(), t));

  const deps = new Map<string, Set<string>>();

  tables.forEach(t => {
    const tableDeps = new Set<string>();
    t.columns.forEach(col => {
      if (col.isForeignKey && col.linkedTable && col.linkedTable.toLowerCase() !== t.name.toLowerCase()) {
        if (tableNames.has(col.linkedTable.toLowerCase())) {
          tableDeps.add(col.linkedTable.toLowerCase());
        }
      }
    });
    deps.set(t.name.toLowerCase(), tableDeps);
  });

  const sorted: TableNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);
    const tableDeps = deps.get(name);
    if (tableDeps) {
      tableDeps.forEach(dep => visit(dep));
    }
    visiting.delete(name);
    visited.add(name);
    const table = tableMap.get(name);
    if (table) sorted.push(table);
  }

  tables.forEach(t => visit(t.name.toLowerCase()));
  return sorted;
}

export function generatePrismaSchema(tables: TableNode[]): string {
  let schema = "// Generated by VibeDB\n\n";
  tables.forEach(table => {
    schema += `model ${table.name} {\n`;
    table.columns.forEach(col => {
      let type = col.type;
      if (type === "varchar" || type === "text") type = "String";
      else if (type === "int") type = "Int";
      else if (type === "uuid") type = "String";
      else if (type === "timestamp") type = "DateTime";
      else if (type === "boolean") type = "Boolean";
      else if (type === "numeric" || type === "decimal" || type === "float") type = "Float";
      else if (type === "jsonb") type = "Json";

      const attrs: string[] = [];
      if (col.constraints?.some(c => c.type === "primary")) attrs.push("@id");
      if (col.constraints?.some(c => c.type === "unique")) attrs.push("@unique");
      if (col.constraints?.some(c => c.type === "default" && c.value)) {
        const def = col.constraints!.find(c => c.type === "default");
        attrs.push(`@default(${def!.value})`);
      }
      if (col.isForeignKey && col.linkedTable) {
        const relationName = `${table.name}To${col.linkedTable}`;
        attrs.push(`@relation("${relationName}", fields: [${col.name}], references: [${col.linkedColumn || "id"}])`);
      }

      schema += `  ${col.name} ${type}${attrs.length ? " " + attrs.join(" ") : ""}\n`;
    });
    schema += "}\n\n";
  });
  return schema;
}

export function generateDrizzleSchema(tables: TableNode[]): string {
  let code =
    "// Generated by VibeDB\nimport { pgTable, serial, varchar, integer, timestamp, boolean, numeric, text, jsonb, uuid, foreignKey } from 'drizzle-orm/pg-core';\n\n";
  tables.forEach(table => {
    code += `export const ${table.name} = pgTable('${table.name}', {\n`;
    table.columns.forEach(col => {
      let type = "varchar";
      if (col.type === "int") type = "integer";
      else if (col.type === "uuid") type = "uuid";
      else if (col.type === "timestamp") type = "timestamp";
      else if (col.type === "boolean") type = "boolean";
      else if (col.type === "numeric") type = "numeric";
      else if (col.type === "text") type = "text";
      else if (col.type === "jsonb") type = "jsonb";

      let chain = `${type}()`;
      if (col.constraints?.some(c => c.type === "primary")) chain += ".primaryKey()";
      if (col.constraints?.some(c => c.type === "unique")) chain += ".unique()";
      if (col.constraints?.some(c => c.type === "notNull")) chain += ".notNull()";
      if (col.constraints?.some(c => c.type === "default")) {
        const def = col.constraints!.find(c => c.type === "default");
        chain += `.default(${def?.value || "''"})`;
      }

      code += `  ${col.name}: ${chain},\n`;
    });
    code += "});\n\n";
  });
  return code;
}

export function generateGraphQLTypes(tables: TableNode[]): string {
  let types = "# Generated by VibeDB\n\ntype Query {\n";
  tables.forEach(t => {
    types += `  ${t.name.toLowerCase()}s: [${t.name}]\n`;
    types += `  ${t.name.toLowerCase()}(id: ID!): ${t.name}\n`;
  });
  types += "}\n\n";

  tables.forEach(table => {
    types += `type ${table.name} {\n`;
    types += "  id: ID!\n";
    table.columns
      .filter(c => !c.constraints?.some(con => con.type === "primary"))
      .forEach(col => {
        let type = "String";
        if (col.type === "int") type = "Int";
        else if (col.type === "boolean") type = "Boolean";
        else if (col.type === "timestamp") type = "DateTime";
        else if (col.type === "numeric" || col.type === "float") type = "Float";

        const nullable = !col.constraints?.some(c => c.type === "notNull") ? "" : "!";
        types += `  ${col.name}: ${type}${nullable}\n`;
      });
    types += "}\n\n";
  });
  return types;
}

export function generateCSV(tables: TableNode[]): string {
  const header = ["Table", "Column", "Type", "Constraints", "Foreign Key"];
  const rows: string[][] = [];

  tables.forEach(table => {
    table.columns.forEach(col => {
      const constraints = col.constraints?.map(c => c.type).join(" | ") || "";
      const fk = col.isForeignKey ? `Ref: ${col.linkedTable}.${col.linkedColumn}` : "";
      rows.push([table.name, col.name, col.type, constraints, fk]);
    });
  });

  return [
    header.join(","),
    ...rows.map(row => row.map(cell => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
}
