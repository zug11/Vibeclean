import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Database, Plus, Sparkles, Trash2, X, Loader2, Copy, Check,
  Zap, Download, Lightbulb, RefreshCw, Undo2, Redo2, Eye,
  Wand2, Terminal, ArrowLeft, LayoutTemplate, ArrowUpDown,
  Table as TableIcon, Code, Upload, ShieldCheck, Edit3, ChevronDown,
  Settings, GitCompare, Key, Hash, LinkIcon, GripVertical, DatabaseZap,
  Box, Columns, Webhook, FileText, Rocket, Plug, CheckCircle2, AlertCircle,
  FolderOpen, Save, FilePlus, PanelLeftOpen, PanelLeftClose, MessageCircle, Clock, Activity, BookOpen
} from "lucide-react";
import { Link } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { motion, AnimatePresence } from "framer-motion";
import { ProjectStorage } from "@/lib/project-storage";
import { createGenerationTracker, type GenerationProgress } from "@/lib/generation-tracker";
import { STRATEGIES, getDefaultStrategy, setDefaultStrategy } from "@/lib/generation-strategies";
import { GenerationHistoryStore, type GenerationRecord } from "@/lib/generation-history";
import { runCompilerPass } from "@/lib/compiler-pass";
import { generateRLSPolicies, introspectSupabaseSchema } from "@/lib/supabase-integration";
import { computeSchemaDiff, generateMigrationSQL, type SchemaDiff } from "@/lib/schema-diff";
import GenerationHistoryPanel from "@/components/vibedb/GenerationHistoryPanel";
import SchemaCompareModal from "@/components/vibedb/SchemaCompareModal";
import DatabaseManagerPanel from "@/components/vibedb/DatabaseManagerPanel";
import QueryBuilderPanel from "@/components/vibedb/QueryBuilderPanel";
import SupabasePanel from "@/components/vibedb/SupabasePanel";
import SREModePanel from "@/components/vibedb/SREModePanel";
import AskDataPanel from "@/components/vibedb/AskDataPanel";
import VibeDBSidebar from "@/components/vibedb/VibeDBSidebar";
import SchemaAuditModal from "@/components/vibedb/SchemaAuditModal";
import AIChatPanel from "@/components/vibedb/AIChatPanel";
import SQLViewerModal from "@/components/vibedb/SQLViewerModal";
import MockDataModal from "@/components/vibedb/MockDataModal";
import {
  generateSQL, generateSQLDeferred, generatePrismaSchema, generateDrizzleSchema,
  generateGraphQLTypes, generateCSV, detectMissingFKTargets,
  diagnoseAndFixSchema, preDeployValidateSchema, type FixResult,
  findDuplicateIndex, deduplicateSchema, buildSchemaFromIntent,
  generateZodSchema, generateDataDictionary,
} from "@/components/vibedb/ExportGenerators";

// ─── Types ──────────────────────────────────────────────
import type { Column, TableNode, SchemaEnum, SchemaFunction, Toast, Project, AuditReport, CompilerReport, SupabaseBaseline, DDLPatch } from "@/lib/types";

// ─── Constants ──────────────────────────────────────────
const COLUMN_TYPES = ["uuid", "varchar", "int", "timestamptz", "timestamp", "boolean", "numeric", "text", "jsonb", "decimal", "float"];
const PROMPT_SUGGESTIONS = [
  "E-commerce with users, products, orders",
  "SaaS app with workspaces, subscriptions, billing",
  "Social network with posts, likes, followers",
  "Project management with tasks, sprints, teams",
  "CRM with contacts, deals, pipelines, activities",
  "Marketplace with sellers, listings, reviews",
  "Hotel booking with rooms, guests, reservations",
  "Learning platform with courses, lessons, progress",
  "Healthcare app with patients, doctors, appointments",
  "Forum with threads, comments, votes",
  "Music streaming with artists, albums, playlists",
  "Issue tracker with bugs, milestones, assignees",
  "Restaurant POS with menus, tables, staff",
  "Event ticketing with venues, attendees, tickets",
  "Job board with postings, companies, applicants",
  "Fitness tracker with workouts, exercises, logs",
  "Banking app with accounts, transfers, cards",
  "Inventory system with warehouses, stock, suppliers",
];
const MAX_CONTINUATION_CALLS = 4; // max 5 total calls (1 initial + 4 continuations)
const MAX_AUDIT_CONTINUATIONS = 2; // max 3 total audit calls (1 initial + 2 continuations)
const TABLE_WIDTH = 260;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 32;
const MIN_CANVAS_ZOOM = 0.3;
const MAX_CANVAS_ZOOM = 3;
const CANVAS_ZOOM_SENSITIVITY = 0.0005;
const MAX_CANVAS_ZOOM_STEP = 0.05;
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_PAGE_HEIGHT = 800;
const PROMPT_TEXTAREA_MAX_HEIGHT = 116;

function cloneTables(tables: TableNode[]): TableNode[] {
  return typeof structuredClone === "function"
    ? structuredClone(tables)
    : JSON.parse(JSON.stringify(tables));
}

function hasSchemaDiffChanges(diff: SchemaDiff | null): boolean {
  return !!diff && (
    diff.addedTables.length > 0 ||
    diff.removedTables.length > 0 ||
    diff.modifiedTables.length > 0
  );
}

function countSchemaDiffChanges(diff: SchemaDiff | null): number {
  if (!diff) return 0;
  const tableChanges = diff.addedTables.length + diff.removedTables.length;
  const modifiedChanges = diff.modifiedTables.reduce((sum, mod) => (
    sum +
    mod.addedColumns.length +
    mod.removedColumns.length +
    mod.modifiedColumns.length +
    mod.addedIndexes.length +
    mod.removedIndexes.length
  ), 0);
  return tableChanges + modifiedChanges;
}

function summarizeSchemaDiff(diff: SchemaDiff | null): string[] {
  if (!diff) return [];
  const summary: string[] = [];
  if (diff.addedTables.length > 0) summary.push(`${diff.addedTables.length} table${diff.addedTables.length !== 1 ? "s" : ""} added`);
  if (diff.removedTables.length > 0) summary.push(`${diff.removedTables.length} table${diff.removedTables.length !== 1 ? "s" : ""} removed`);

  const addedColumns = diff.modifiedTables.reduce((sum, mod) => sum + mod.addedColumns.length, 0);
  const removedColumns = diff.modifiedTables.reduce((sum, mod) => sum + mod.removedColumns.length, 0);
  const modifiedColumns = diff.modifiedTables.reduce((sum, mod) => sum + mod.modifiedColumns.length, 0);
  const addedIndexes = diff.modifiedTables.reduce((sum, mod) => sum + mod.addedIndexes.length, 0);
  const removedIndexes = diff.modifiedTables.reduce((sum, mod) => sum + mod.removedIndexes.length, 0);

  if (addedColumns > 0) summary.push(`${addedColumns} column${addedColumns !== 1 ? "s" : ""} added`);
  if (removedColumns > 0) summary.push(`${removedColumns} column${removedColumns !== 1 ? "s" : ""} removed`);
  if (modifiedColumns > 0) summary.push(`${modifiedColumns} column${modifiedColumns !== 1 ? "s" : ""} modified`);
  if (addedIndexes > 0) summary.push(`${addedIndexes} index${addedIndexes !== 1 ? "es" : ""} added`);
  if (removedIndexes > 0) summary.push(`${removedIndexes} index${removedIndexes !== 1 ? "es" : ""} removed`);

  return summary;
}

function analyzeMigrationRisks(sql: string): string[] {
  const risks: string[] = [];
  if (/\bDROP\s+TABLE\b/i.test(sql)) risks.push("Drops table data or dependent objects");
  if (/\bDROP\s+COLUMN\b/i.test(sql)) risks.push("Drops column data");
  if (/\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i.test(sql)) risks.push("Alters a column type and may require casts/backfills");
  if (/\bCASCADE\b/i.test(sql)) risks.push("Uses CASCADE and may affect dependent objects");
  return [...new Set(risks)];
}

function cleanSqlFence(sql: string): string {
  return sql.replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();
}

function buildDdlPatchSql(patches: DDLPatch[]): string {
  const pending = patches.filter(p => p.status === "pending" && p.sql.trim());
  if (pending.length === 0) return "";

  return [
    "-- Pending DDL patches",
    ...pending.flatMap((patch) => [
      "",
      `-- ${patch.title}`,
      ...(patch.description ? [`-- ${patch.description}`] : []),
      cleanSqlFence(patch.sql),
    ]),
  ].join("\n").trim();
}

function appendDdlPatchSql(sql: string, patches: DDLPatch[]): string {
  const patchSql = buildDdlPatchSql(patches);
  if (!patchSql) return sql.trim();
  if (!sql.trim()) return patchSql;
  return `${sql.trim()}\n\n${patchSql}`;
}

function mergeImportedTablesWithLayout(importedTables: TableNode[], currentTables: TableNode[]): TableNode[] {
  const currentByName = new Map(currentTables.map(t => [t.name.toLowerCase(), t]));

  return importedTables.map((table) => {
    const existingTable = currentByName.get(table.name.toLowerCase());
    const existingColumnsByName = new Map(
      (existingTable?.columns || []).map(col => [col.name.toLowerCase(), col])
    );

    return {
      ...table,
      id: existingTable?.id || table.id,
      x: existingTable?.x ?? table.x,
      y: existingTable?.y ?? table.y,
      columns: table.columns.map(col => ({
        ...col,
        id: existingColumnsByName.get(col.name.toLowerCase())?.id || col.id,
      })),
    };
  });
}

// ─── Naming Convention Linter ───────────────────────────
const NAMING_PATTERNS: Record<string, RegExp> = {
  snake_case: /^[a-z][a-z0-9_]*$/,
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
};

function lintSchema(tables: TableNode[], convention = "snake_case") {
  const issues: { type: string; severity: string; message: string }[] = [];
  const regex = NAMING_PATTERNS[convention];
  if (!regex) return issues;
  tables.forEach(table => {
    if (!regex.test(table.name))
      issues.push({ type: "naming", severity: "warning", message: `Table "${table.name}" should be ${convention}` });
    table.columns.forEach(col => {
      if (!regex.test(col.name))
        issues.push({ type: "naming", severity: "warning", message: `Column "${col.name}" in ${table.name} should be ${convention}` });
    });
  });
  return issues;
}

// ─── Smart FK Inference Engine ──────────────────────────
const ROLE_BASED_IDS: Record<string, string> = {
  "buyer_id": "users", "seller_id": "users", "reviewer_id": "users",
  "actor_id": "users", "sender_id": "users", "receiver_id": "users",
  "owner_id": "users", "creator_id": "users"
};

const EXTERNAL_ID_PREFIXES = ["stripe_", "payment_provider_", "exchange_", "provider_"];
const POLYMORPHIC_IDS = ["resource_id", "entity_id", "reference_id", "target_id", "object_id", "item_id"];

function smartPluralize(word: string): string {
  if (word.endsWith("y") && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (word.endsWith("s")) return word;
  return word + "s";
}

// ─── Canvas-aware FK Resolution ─────────────────────────
// Pure function: given a list of all canvas tables, resolves FK links bidirectionally.
// - Forward: columns on `newTables` pointing at existing canvas tables get resolved
// - Backward: columns on existing canvas tables pointing at any new table get resolved
// Returns the full merged array with all resolvable FKs green.
function resolveCanvasFKsBidirectional(existingTables: TableNode[], newTables: TableNode[]): TableNode[] {
  // Build name→id map for ALL tables (existing + new)
  const tableMap = new Map<string, string>();
  for (const t of existingTables) {
    const name = t.name.toLowerCase();
    tableMap.set(name, t.id);
    tableMap.set(smartPluralize(name), t.id);
    if (name.endsWith("ies")) tableMap.set(name.slice(0, -3) + "y", t.id);
    else if (name.endsWith("s") && !name.endsWith("ss")) tableMap.set(name.slice(0, -1), t.id);
  }
  for (const t of newTables) {
    const name = t.name.toLowerCase();
    tableMap.set(name, t.id);
    tableMap.set(smartPluralize(name), t.id);
    if (name.endsWith("ies")) tableMap.set(name.slice(0, -3) + "y", t.id);
    else if (name.endsWith("s") && !name.endsWith("ss")) tableMap.set(name.slice(0, -1), t.id);
  }

  const resolveColumns = (t: TableNode): TableNode => {
    const fixedCols = t.columns.map(col => {
      if (col.fkStatus === "resolved") return col;
      if (!col.isForeignKey || !col.linkedTable) return col;
      const targetName = col.linkedTable.toLowerCase();
      const targetId = tableMap.get(targetName) || tableMap.get(smartPluralize(targetName));
      if (targetId && targetId !== t.id) {
        return { ...col, linkedTableId: targetId, fkStatus: "resolved" as const };
      }
      return col;
    });
    return { ...t, columns: fixedCols };
  };

  // Forward: resolve new tables' FKs against everything
  const resolvedNew = newTables.map(resolveColumns);
  // Backward: resolve existing tables' FKs that may point at new tables
  const resolvedExisting = existingTables.map(resolveColumns);

  return [...resolvedExisting, ...resolvedNew];
}

function applySmartFKResolution(tables: Omit<TableNode, "x" | "y">[]) {
  const availableTables = new Set(tables.map(t => t.name.toLowerCase()));

  tables.forEach(table => {
    table.columns.forEach(col => {
      // Skip if explicitly resolved already
      if (col.isForeignKey && col.linkedTable) return;

      const lowerName = col.name.toLowerCase();
      if (lowerName.endsWith("_id")) {
        // Skip explicitly external IDs
        if (EXTERNAL_ID_PREFIXES.some(prefix => lowerName.startsWith(prefix))) {
          col.isForeignKey = false;
          col.linkedTable = undefined;
          col.fkStatus = "resolved";
          return;
        }

        // Skip naturally polymorphic or highly ambiguous IDs that break deterministic mapping
        if (POLYMORPHIC_IDS.includes(lowerName)) {
          col.isForeignKey = false;
          col.linkedTable = undefined;
          col.fkStatus = "resolved";
          return;
        }

        if (ROLE_BASED_IDS[lowerName]) {
          col.isForeignKey = true;
          col.linkedTable = ROLE_BASED_IDS[lowerName];
          col.linkedColumn = "id";
          col.fkStatus = "unresolved";
          return;
        }

        const baseName = lowerName.replace("_id", "");
        const pluralName = smartPluralize(baseName);

        let finalTable = pluralName;
        if (availableTables.has(baseName)) {
          finalTable = baseName;
        }

        col.isForeignKey = true;
        col.linkedTable = finalTable;
        col.linkedColumn = "id";
        col.fkStatus = "unresolved";
      }
    });
  });
}

// ─── Shared CSV Utilities ────────────────────────────────
function splitCSVRow(line: string): string[] {
  const values: string[] = [];
  let cur = "";
  let inQuote = false;
  const isTSV = line.includes('\t') && !line.includes('","');
  const separator = isTSV ? '\t' : ',';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuote = !inQuote;
    } else if (line[i] === separator && !inQuote) {
      values.push(cur);
      cur = "";
    } else {
      cur += line[i];
    }
  }
  values.push(cur);
  return values.map(v => v.trim());
}

function inferColumnType(values: string[]): string {
  let isUuid = true, isBoolean = true, isInteger = true, isNumeric = true, isTimestamp = true, isJsonb = true;
  for (const val of values) {
    if (!val) continue;
    const ln = val.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) isUuid = false;
    if (ln !== "true" && ln !== "false" && ln !== "1" && ln !== "0") isBoolean = false;
    if (!/^-?\d+$/.test(val)) isInteger = false;
    if (!/^-?\d+(\.\d+)?$/.test(val)) isNumeric = false;
    if (isNaN(Date.parse(val)) || /^\d+$/.test(val)) isTimestamp = false;
    if (typeof val === 'string' && (!val.startsWith('{') && !val.startsWith('['))) isJsonb = false;
    try { if (isJsonb) JSON.parse(val); } catch { isJsonb = false; }
  }
  if (isUuid) return "uuid";
  if (isBoolean) return "boolean";
  if (isInteger) return "int";
  if (isNumeric) return "numeric";
  if (isTimestamp) return "timestamptz";
  if (isJsonb) return "jsonb";
  return "varchar";
}

// ─── CSV Parser ──────────────────────────────────────────
function parseCSVData(csvText: string, tableName = "imported_table", skipSmartFK = false): { tables: Omit<TableNode, "x" | "y">[] } {
  // Check if it has multiple table segments
  const tableSegments = csvText.split(/---\s*TABLE:\s*([^-]+)---\r?\n/i);
  if (tableSegments.length > 1) {
    const allTables: Omit<TableNode, "x" | "y">[] = [];
    for (let i = 1; i < tableSegments.length; i += 2) {
      const segName = tableSegments[i].trim();
      const content = tableSegments[i + 1].trim();
      if (!content) continue;
      const res = parseCSVData(content, segName, true);
      allTables.push(...res.tables);
    }
    if (!skipSmartFK) applySmartFKResolution(allTables);
    return { tables: allTables };
  }

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have at least a header row and one data row.");

  const headers = splitCSVRow(lines[0]).map(h => h.toLowerCase().trim());
  const dataRows = lines.slice(1).map(splitCSVRow).filter(r => r.length === headers.length || r.some(c => c !== ""));

  // Check if this is a Schema CSV Export (Table, Column, Type, Constraints, Foreign Key)
  const isSchemaCSV = headers.includes("table") && headers.includes("column") && headers.includes("type");

  if (isSchemaCSV) {
    const tableMap = new Map<string, Omit<TableNode, "x" | "y">>();

    // Find index of headers
    const tIdx = headers.indexOf("table");
    const cIdx = headers.indexOf("column");
    const typeIdx = headers.indexOf("type");
    const constrIdx = headers.indexOf("constraints");
    const fkIdx = headers.indexOf("foreign key");

    for (const row of dataRows) {
      if (row.length <= Math.max(tIdx, cIdx, typeIdx)) continue;
      const tName = row[tIdx] || "unknown_table";
      const cName = row[cIdx];
      const colType = row[typeIdx] || "varchar";
      const constraintsStr = constrIdx >= 0 ? row[constrIdx] : "";
      const fkStr = fkIdx >= 0 ? row[fkIdx] : "";

      if (!cName) continue;

      if (!tableMap.has(tName)) {
        tableMap.set(tName, {
          id: uuidv4(),
          name: tName,
          columns: []
        });
      }

      const table = tableMap.get(tName)!;

      const constraints: { type: string; value?: string }[] = [];
      if (constraintsStr) {
        const parts = constraintsStr.split("|").map(s => s.trim().toLowerCase());
        if (parts.includes("primary")) constraints.push({ type: "primary" });
        if (parts.includes("notnull")) constraints.push({ type: "notNull" });
        if (parts.includes("unique")) constraints.push({ type: "unique" });
        if (parts.includes("default")) constraints.push({ type: "default" }); // simplistic default extraction
      }

      let isForeignKey = false;
      let linkedTable: string | undefined = undefined;
      let linkedColumn: string | undefined = undefined;

      if (fkIdx >= 0) {
        if (fkStr && fkStr.toLowerCase().startsWith("ref:")) {
          isForeignKey = true;
          const refParts = fkStr.substring(4).trim().split(".");
          if (refParts.length === 2) {
            linkedTable = refParts[0];
            linkedColumn = refParts[1];
          } else {
            linkedTable = fkStr.substring(4).trim();
            linkedColumn = "id";
          }
        }
      }

      table.columns.push({
        id: uuidv4(),
        name: cName,
        type: colType,
        isForeignKey,
        linkedTable,
        linkedColumn,
        fkStatus: isForeignKey ? "unresolved" : "resolved",
        constraints
      });
    }

    return { tables: Array.from(tableMap.values()) };
  }

  // Otherwise, fallback to generic Data row inference for a single flat table
  const columns = headers.map((header, colIndex) => {
    const colValues = dataRows.map(row => row[colIndex] || "");
    const type = inferColumnType(colValues);
    let isForeignKey = false;
    let linkedTable: string | undefined = undefined;

    const cleanName = header.toLowerCase().replace(/[^a-z0-9_]/g, "_");

    return {
      id: uuidv4(),
      name: cleanName || `col_${colIndex}`,
      type: type,
      isForeignKey,
      linkedTable,
      fkStatus: isForeignKey ? "unresolved" : "resolved",
      constraints: cleanName === "id" ? [{ type: "primary" }, { type: "notNull" }] : []
    };
  });

  if (!columns.some(c => c.name === "id")) {
    columns.unshift({
      id: uuidv4(),
      name: "id",
      type: "uuid",
      constraints: [{ type: "primary" }, { type: "notNull" }],
      fkStatus: "resolved",
      isForeignKey: false,
      linkedTable: undefined
    });
  }

  const generatedRows = dataRows.map((row, rIdx) => {
    const obj: Record<string, string> = {};
    let hasIdVal = false;
    headers.forEach((h, i) => {
      const colName = h.toLowerCase().replace(/[^a-z0-9_]/g, "_") || `col_${i}`;
      if (colName === 'id') hasIdVal = !!row[i];
      obj[colName] = row[i];
    });
    // Ensure every row has an 'id' if we added the 'id' column
    if (!hasIdVal) {
      // If we didn't have an ID column in the CSV, just generate one for the dataRow
      obj['id'] = uuidv4();
    }
    return obj;
  });

  const table: Omit<TableNode, "x" | "y"> = {
    id: uuidv4(),
    name: tableName,
    columns,
    dataRows: generatedRows,
    importedData: {
      headers: headers,
      rows: dataRows
    }
  };

  const finalTables = [table];
  if (!skipSmartFK) applySmartFKResolution(finalTables);

  return { tables: finalTables };
}

// ─── CSV-to-3NF Normalization Engine ─────────────────────
async function normalizeCSVData(csvText: string): Promise<{ tables: Omit<TableNode, "x" | "y">[]; normalizedSQL: string }> {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have at least a header row and one data row.");

  // Send ALL data (up to 200 rows) to AI for full SQL generation
  const maxRows = 200;
  const csvToSend = lines.slice(0, maxRows + 1).join("\n");
  const totalRows = lines.length - 1;
  const prompt = `Normalize this CSV data (${totalRows} rows, showing ${Math.min(totalRows, maxRows)}):\n\n${csvToSend}${totalRows > maxRows ? `\n\n-- (${totalRows - maxRows} more rows not shown, but include ALL ${Math.min(totalRows, maxRows)} shown rows in INSERT statements)` : ""}`;

  console.log("[Normalize] Sending full CSV to AI for SQL generation, rows:", totalRows);
  const aiSQL = await callAI("normalize-csv", prompt);
  console.log("[Normalize] Got SQL back, length:", aiSQL.length);
  console.log("[Normalize] SQL preview:", aiSQL.substring(0, 500));

  // Clean up any markdown fences the AI might have added
  const cleanSQL = aiSQL.replace(/```sql\n?/g, "").replace(/```\n?/g, "").trim();

  // Parse CREATE TABLE statements into canvas tables
  const { tables } = parseSQLDDL(cleanSQL);
  if (tables.length === 0) throw new Error("AI returned no valid CREATE TABLE statements");
  console.log("[Normalize] Parsed tables:", tables.map(t => t.name));

  // Parse INSERT statements to populate dataRows on each table
  const insertData = parseInsertStatements(cleanSQL);
  console.log("[Normalize] Parsed INSERT data:", Array.from(insertData.entries()).map(([k, v]) => `${k}: ${v.length} rows`));

  for (const table of tables) {
    const rows = insertData.get(table.name.toLowerCase());
    if (rows && rows.length > 0) {
      table.dataRows = rows.map(row => ({ id: uuidv4(), ...row }));
    }
  }

  // Ensure every table has an "id" column for canvas compatibility
  for (const table of tables) {
    if (!table.columns.some(c => c.name === "id")) {
      table.columns.unshift({
        id: uuidv4(),
        name: "id",
        type: "uuid",
        constraints: [{ type: "primary" }, { type: "notNull" }],
        isForeignKey: false,
        fkStatus: "resolved",
      });
    }
  }

  return { tables, normalizedSQL: cleanSQL };
}

// ─── SQL DDL Parser ─────────────────────────────────────
function parseSQLDDL(sql: string): { tables: Omit<TableNode, "x" | "y">[] } {
  const tables: Omit<TableNode, "x" | "y">[] = [];
  const statements = sql.split(/(?=CREATE\s+TABLE)/i).filter(s => s.trim().length > 0);
  statements.forEach(statement => {
    const nameMatch = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["'`]?\w+["'`]?\.)?["'`]?(\w+)["'`]?/i);
    if (!nameMatch) return;
    const tableName = nameMatch[1];
    const firstParen = statement.indexOf("(");
    const lastParen = statement.lastIndexOf(")");
    if (firstParen === -1 || lastParen === -1) return;
    const body = statement.substring(firstParen + 1, lastParen);
    const cleanBody = body.replace(/\(([^)]+)\)/g, (match) => match.replace(/,/g, "|"));
    const colLines = cleanBody.split(",").map(s => s.trim()).filter(Boolean);
    const columns: Column[] = [];
    colLines.forEach(line => {
      const def = line.replace(/\|/g, ",");
      if (def.match(/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|INDEX|CHECK)/i)) return;
      const colMatch = def.match(/^\s*["'`]?(\w+)["'`]?\s+(["'`]?\w+["'`]?(?:\([\d\s,]+\))?)/i);
      if (!colMatch) return;
      const colName = colMatch[1];
      const rawType = colMatch[2].replace(/[[\]]/g, "").toLowerCase();
      const isPK = /PRIMARY\s+KEY/i.test(def);
      const isFK = /REFERENCES/i.test(def);
      const isNotNull = /NOT\s+NULL/i.test(def);
      const defaultMatch = def.match(/DEFAULT\s+([^,\s]+)/i);
      let normalizedType = "varchar";
      if (rawType.includes("int")) normalizedType = "int";
      else if (rawType.includes("uuid")) normalizedType = "uuid";
      else if (rawType.includes("timestamptz")) normalizedType = "timestamptz";
      else if (rawType.includes("time") || rawType.includes("date")) normalizedType = "timestamp";
      else if (rawType.includes("bool")) normalizedType = "boolean";
      else if (rawType.includes("decimal") || rawType.includes("numeric")) normalizedType = "numeric";
      else if (rawType.includes("float") || rawType.includes("real")) normalizedType = "float";
      else if (rawType.includes("json")) normalizedType = "jsonb";
      else if (rawType.includes("text")) normalizedType = "text";
      const constraints: { type: string; value?: string }[] = [];
      if (isPK) constraints.push({ type: "primary" });
      if (isNotNull && !isPK) constraints.push({ type: "notNull" });
      if (defaultMatch) constraints.push({ type: "default", value: defaultMatch[1] });
      let linkedTable: string | undefined;
      let linkedColumn: string | undefined;
      if (isFK) {
        const fkMatch = def.match(/REFERENCES\s+["'`]?(\w+)["'`]?(?:\s*\(["'`]?(\w+)["'`]?\))?/i);
        if (fkMatch) { linkedTable = fkMatch[1]; linkedColumn = fkMatch[2] || "id"; }
      }
      columns.push({ id: uuidv4(), name: colName, type: normalizedType, isForeignKey: isFK, linkedTable, linkedColumn, constraints, fkStatus: isFK ? "unresolved" : "resolved" });
    });
    if (columns.length > 0) tables.push({ id: uuidv4(), name: tableName, columns });
  });
  return { tables };
}

// ─── INSERT Statement Parser ─────────────────────────────
function splitSQLValues(valStr: string): string[] {
  const values: string[] = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < valStr.length; i++) {
    const ch = valStr[i];
    if (ch === "'" && (i === 0 || valStr[i - 1] !== "\\")) {
      inQuote = !inQuote;
      cur += ch;
    } else if (ch === "," && !inQuote) {
      values.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  values.push(cur.trim());
  return values;
}

function parseInsertStatements(sql: string): Map<string, Record<string, string>[]> {
  const result = new Map<string, Record<string, string>[]>();
  // Match INSERT INTO table (col1, col2, ...) VALUES ...;
  const insertRegex = /INSERT\s+INTO\s+["'`]?(\w+)["'`]?\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?);/gi;
  let match;
  while ((match = insertRegex.exec(sql)) !== null) {
    const tableName = match[1].toLowerCase();
    const columns = match[2].split(",").map(c => c.trim().replace(/["'`]/g, "").toLowerCase());
    const valuesBlock = match[3];
    const rows: Record<string, string>[] = [];
    // Parse each (...) value tuple, handling quoted strings with commas/parens
    let i = 0;
    while (i < valuesBlock.length) {
      if (valuesBlock[i] === "(") {
        let depth = 1, inQ = false, tupleContent = "";
        i++;
        while (i < valuesBlock.length && depth > 0) {
          const c = valuesBlock[i];
          if (c === "'" && (i === 0 || valuesBlock[i - 1] !== "\\")) inQ = !inQ;
          if (!inQ) {
            if (c === "(") depth++;
            if (c === ")") { depth--; if (depth === 0) break; }
          }
          tupleContent += c;
          i++;
        }
        // Parse the tuple content into values
        const vals = splitSQLValues(tupleContent);
        const row: Record<string, string> = {};
        columns.forEach((col, idx) => {
          let v = (vals[idx] || "").trim();
          // Strip surrounding quotes
          if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
          // Handle NULL
          if (v.toUpperCase() === "NULL") v = "";
          row[col] = v;
        });
        rows.push(row);
      }
      i++;
    }
    const existing = result.get(tableName) || [];
    result.set(tableName, [...existing, ...rows]);
  }
  return result;
}

// ─── AI Helper ──────────────────────────────────────────
function robustJsonParse(str: string): any {
  // Step 1: Remove markdown fences
  str = str.replace(/```json\n?/gi, "").replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();

  // Step 2: Try direct parse first
  try { return JSON.parse(str); } catch { }

  // Step 3: Extract JSON object/array from surrounding text
  const firstBrace = str.search(/[{\[]/);
  const lastClose = Math.max(str.lastIndexOf("}"), str.lastIndexOf("]"));
  if (firstBrace !== -1 && lastClose > firstBrace) {
    str = str.substring(firstBrace, lastClose + 1);
  }
  try { return JSON.parse(str); } catch { }

  // Step 4: Fix common issues
  let cleaned = str;
  // Remove single-line comments (but not inside strings)
  cleaned = cleaned.replace(/(?<="[^"]*")\s*\/\/[^\n]*/g, "");
  cleaned = cleaned.replace(/^\s*\/\/[^\n]*/gm, "");
  // Remove trailing commas
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
  // Replace single quotes around values with double quotes (simplified)
  cleaned = cleaned.replace(/:\s*'([^']*)'/g, ': "$1"');
  // Remove control characters inside strings
  cleaned = cleaned.replace(/[\x00-\x1f]/g, (ch) => ch === "\n" || ch === "\r" || ch === "\t" ? " " : "");
  try { return JSON.parse(cleaned); } catch { }

  // Step 5: Try to fix truncated JSON by closing open brackets
  let fixed = cleaned;
  let openBraces = 0, openBrackets = 0;
  let inString = false, escape = false;
  for (const ch of fixed) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }
  // Close the string if LLM truncated mid-value
  if (inString) fixed += '"';
  // Remove any trailing comma before we close
  fixed = fixed.replace(/,\s*$/, "");
  for (let i = 0; i < openBrackets; i++) fixed += "]";
  for (let i = 0; i < openBraces; i++) fixed += "}";
  try { return JSON.parse(fixed); } catch { }

  // Step 6: Extract complete table objects from truncated {"tables":[...]} JSON
  const tablesIdx = fixed.indexOf('"tables"');
  if (tablesIdx !== -1) {
    const arrStart = fixed.indexOf("[", tablesIdx);
    if (arrStart !== -1) {
      const tableObjects: string[] = [];
      let pos = arrStart + 1;
      while (pos < fixed.length) {
        // Skip whitespace and commas
        while (pos < fixed.length && /[\s,]/.test(fixed[pos])) pos++;
        if (pos >= fixed.length || fixed[pos] !== "{") break;
        // Find matching close brace for this table object
        let depth = 0;
        const start = pos;
        let inStr2 = false;
        let esc2 = false;
        for (; pos < fixed.length; pos++) {
          if (esc2) { esc2 = false; continue; }
          if (fixed[pos] === "\\") { esc2 = true; continue; }
          if (fixed[pos] === '"') { inStr2 = !inStr2; continue; }
          if (inStr2) continue;
          if (fixed[pos] === "{") depth++;
          if (fixed[pos] === "}") { depth--; if (depth === 0) { pos++; break; } }
        }
        if (depth === 0) {
          const obj = fixed.substring(start, pos);
          try { JSON.parse(obj); tableObjects.push(obj); } catch { /* skip malformed table */ }
        } else break; // Incomplete object — stop
      }
      if (tableObjects.length > 0) {
        console.log(`[VibeDB] Recovered ${tableObjects.length} complete tables from truncated JSON`);
        return JSON.parse(`{"tables":[${tableObjects.join(",")}]}`);
      }
    }
  }

  // Give up
  throw new Error("Failed to parse AI response as JSON");
}

// ─── Graceful fallback for truncated audit JSON ───
function extractPartialAuditResult(raw: string): any {
  const result: any = {};

  // Extract score (always near the start)
  const scoreMatch = raw.match(/"score"\s*:\s*(\d+)/);
  if (scoreMatch) result.score = parseInt(scoreMatch[1], 10);

  // Helper: extract complete JSON objects from an array in the raw string
  function extractObjects(fieldName: string): any[] | null {
    const fieldIdx = raw.indexOf(`"${fieldName}"`);
    if (fieldIdx === -1) return null;
    const arrStart = raw.indexOf("[", fieldIdx);
    if (arrStart === -1 || arrStart - fieldIdx > 20) return null; // sanity: [ must be close to field name

    const objects: any[] = [];
    let pos = arrStart + 1;
    while (pos < raw.length) {
      while (pos < raw.length && /[\s,]/.test(raw[pos])) pos++;
      if (pos >= raw.length || raw[pos] !== "{") break;
      let depth = 0, inStr = false, esc = false;
      const start = pos;
      for (; pos < raw.length; pos++) {
        if (esc) { esc = false; continue; }
        if (raw[pos] === "\\") { esc = true; continue; }
        if (raw[pos] === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (raw[pos] === "{") depth++;
        if (raw[pos] === "}") { depth--; if (depth === 0) { pos++; break; } }
      }
      if (depth === 0) {
        try { objects.push(JSON.parse(raw.substring(start, pos))); } catch { /* skip */ }
      } else break;
    }
    return objects.length > 0 ? objects : null;
  }

  // Helper: extract string items from a string array field
  function extractStrings(fieldName: string): string[] | null {
    const fieldIdx = raw.indexOf(`"${fieldName}"`);
    if (fieldIdx === -1) return null;
    const arrStart = raw.indexOf("[", fieldIdx);
    if (arrStart === -1 || arrStart - fieldIdx > 30) return null;

    // Find array boundary (may be incomplete)
    let depth = 0, arrEnd = raw.length;
    let inStr = false, esc = false;
    for (let i = arrStart; i < raw.length; i++) {
      if (esc) { esc = false; continue; }
      if (raw[i] === "\\") { esc = true; continue; }
      if (raw[i] === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (raw[i] === "[") depth++;
      if (raw[i] === "]") { depth--; if (depth === 0) { arrEnd = i; break; } }
    }
    const arrContent = raw.substring(arrStart + 1, arrEnd);
    const strings: string[] = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(arrContent)) !== null) strings.push(m[1]);
    return strings.length > 0 ? strings : null;
  }

  // Extract each field
  const issues = extractObjects("issues");
  if (issues) result.issues = issues;
  const suggestions = extractObjects("suggestions");
  if (suggestions) result.suggestions = suggestions;
  const strengths = extractStrings("strengths");
  if (strengths) result.strengths = strengths;
  const missing = extractStrings("missing_elements");
  if (missing) result.missing_elements = missing;
  const risks = extractStrings("risks");
  if (risks) result.risks = risks;

  // Add truncation note
  if (!result.score && !result.issues && !result.suggestions) {
    result.issues = [{ severity: "warning", message: "AI audit response was truncated and could not be parsed. Try re-running the audit." }];
  } else {
    result.issues = [...(result.issues || []), { severity: "info", message: "AI audit response was truncated. Some suggestions or details may be missing." }];
  }

  return result;
}

// ─── Audit chaining helpers ───

function buildAuditContinuationPrompt(
  schemaContext: string,
  partialResult: any,
): string {
  const parts: string[] = [];
  if (partialResult.score !== undefined) parts.push(`Score: ${partialResult.score}`);
  if (partialResult.issues?.length) parts.push(`Issues already identified: ${partialResult.issues.length}`);
  if (partialResult.suggestions?.length) {
    const summaries = partialResult.suggestions.map(
      (s: any) => `- ${s.type} on ${s.target_table || "schema"}: ${(s.reason || s.description || "").substring(0, 80)}`
    );
    parts.push(`Suggestions already generated:\n${summaries.join("\n")}`);
  }
  if (partialResult.strengths?.length) parts.push(`Strengths already identified: ${partialResult.strengths.length}`);
  if (partialResult.missing_elements?.length) parts.push(`Missing elements already identified: ${partialResult.missing_elements.length}`);
  if (partialResult.risks?.length) parts.push(`Risks already identified: ${partialResult.risks.length}`);

  return `You are continuing a database schema audit that was truncated due to length.

Schema being audited:
${schemaContext}

Previous audit progress:
${parts.join("\n")}

Your task: generate ONLY the remaining analysis. Do NOT regenerate the score or already-identified issues/suggestions.

CRITICAL: Return a single valid JSON object with ONLY new/additional items:
{"suggestions":[...],"strengths":[...],"missing_elements":[...],"risks":[...]}

- suggestions: any NEW suggestions not already listed above. Each must have "type", "target_table", "payload", and "reason".
- strengths/missing_elements/risks: generate fresh if not in previous response, or add new items.
- Do NOT include "score" or "issues" — those are already captured.
- Keep the response compact. No markdown. No text outside JSON.`;
}

function mergeAuditResults(base: any, continuation: any): any {
  // Dedup suggestions by type+target_table+payload key
  const allSuggestions = [...(base.suggestions || []), ...(continuation.suggestions || [])];
  const seenSuggestions = new Set<string>();
  const dedupedSuggestions = allSuggestions.filter((s: any) => {
    const payloadKey = s.payload
      ? (s.payload.name || s.payload.column || s.payload.columns?.join(",") || s.payload.newName || "")
      : "";
    const key = `${s.type}|${s.target_table || ""}|${payloadKey}`;
    if (seenSuggestions.has(key)) return false;
    seenSuggestions.add(key);
    return true;
  });

  return {
    ...base,
    score: base.score,
    issues: base.issues,
    suggestions: dedupedSuggestions,
    strengths: [...new Set([...(base.strengths || []), ...(continuation.strengths || [])])],
    missing_elements: [...new Set([...(base.missing_elements || []), ...(continuation.missing_elements || [])])],
    risks: [...new Set([...(base.risks || []), ...(continuation.risks || [])])],
  };
}

async function runAuditChain(
  schemaContext: string,
  initialResult: any,
  setPhase: (phase: string) => void,
): Promise<any> {
  let merged = { ...initialResult };
  let continuationCount = 0;
  let wasTruncated = true;

  while (wasTruncated && continuationCount < MAX_AUDIT_CONTINUATIONS) {
    continuationCount++;
    setPhase(`Gathering remaining analysis (${continuationCount + 1}/${MAX_AUDIT_CONTINUATIONS + 1})...`);

    const contPrompt = buildAuditContinuationPrompt(schemaContext, merged);
    let contResponse: AIRawResponse;
    try {
      contResponse = await callAIRaw("inspect-schema", contPrompt, schemaContext);
    } catch (err) {
      console.warn(`[VibeDB] Audit continuation ${continuationCount} fetch failed, returning partial results:`, err);
      break;
    }

    try {
      let contResult: any;
      try {
        contResult = robustJsonParse(contResponse.result);
      } catch {
        contResult = extractPartialAuditResult(contResponse.result);
      }

      if (contResult && typeof contResult === "object") {
        // Remove truncation info messages before merging
        if (contResult.issues) {
          contResult.issues = contResult.issues.filter((i: any) => !i.message?.includes("truncated"));
        }
        merged = mergeAuditResults(merged, contResult);
        console.log(
          `[VibeDB] Audit continuation ${continuationCount}: ` +
          `+${contResult.suggestions?.length || 0} suggestions, ` +
          `+${contResult.strengths?.length || 0} strengths` +
          `${contResponse.truncated ? " — still truncated" : ""}`
        );
      } else {
        console.log(`[VibeDB] Audit continuation ${continuationCount}: empty result, stopping`);
        break;
      }
    } catch (err) {
      console.warn(`[VibeDB] Audit continuation ${continuationCount} parse error, stopping:`, err);
      break;
    }

    wasTruncated = contResponse.truncated;
  }

  return merged;
}

// ─── Continuation prompt for reactive chaining ───
function buildContinuationPrompt(
  originalPrompt: string,
  existingTables: Omit<TableNode, "x" | "y">[]
): string {
  const tableSummaries = existingTables.map(t => {
    const colNames = t.columns.map(c => c.name).join(", ");
    return `- ${t.name}: ${colNames}`;
  }).join("\n");

  return `You are continuing to generate a PostgreSQL schema. The previous response was truncated due to length.

Original requirement: "${originalPrompt}"

These ${existingTables.length} tables have already been generated:
${tableSummaries}

Generate ONLY the remaining tables needed to fulfill the original requirement. Do NOT regenerate any table listed above.
Foreign keys referencing existing tables should use their exact names and reference the "id" column.
Return JSON: {"tables": [...]} containing ONLY the new tables.`;
}

// ─── Type inference: correct AI type mistakes based on column name semantics ───
function inferCorrectType(colName: string, aiType: string, isForeignKey: boolean): string {
  const name = colName.toLowerCase();

  // FK columns and ID columns → uuid is correct
  if (isForeignKey || name === "id") return aiType;
  if (name.endsWith("_id") && aiType === "uuid") return "uuid"; // FK pattern

  // If AI used uuid for a non-ID/non-FK column, correct it
  if (aiType === "uuid" && !name.endsWith("_id") && name !== "id") {
    // Determine correct type from name semantics
    if (name.includes("url") || name.includes("link") || name.includes("href")) return "text";
    if (name.includes("email")) return "varchar";
    if (name.includes("name") || name.includes("title") || name.includes("slug") || name.includes("label")) return "varchar";
    if (name.includes("description") || name.includes("bio") || name.includes("content") || name.includes("body") || name.includes("notes") || name.includes("readme")) return "text";
    if (name.includes("status") || name.includes("role") || name.includes("type") || name.includes("category") || name.includes("tier") || name.includes("level")) return "varchar";
    if (name.includes("version") || name.includes("code") || name.includes("sku") || name.includes("license") || name.includes("coupon")) return "varchar";
    if (name.includes("phone") || name.includes("address") || name.includes("city") || name.includes("country") || name.includes("zip") || name.includes("state")) return "varchar";
    if (name.includes("currency") || name.includes("locale") || name.includes("language") || name.includes("timezone")) return "varchar";
    if (name.includes("path") || name.includes("filename") || name.includes("extension") || name.includes("mime")) return "varchar";
    if (name.includes("token") || name.includes("secret") || name.includes("key") || name.includes("hash") || name.includes("password")) return "varchar";
    if (name.includes("ip") || name.includes("user_agent") || name.includes("origin") || name.includes("referer")) return "varchar";
    if (name.includes("count") || name.includes("quantity") || name.includes("total") || name.includes("number") || name.includes("max") || name.includes("min") || name.includes("size")) return "int";
    if (name.includes("price") || name.includes("amount") || name.includes("rate") || name.includes("fee") || name.includes("cost") || name.includes("balance") || name.includes("salary")) return "numeric";
    if (name.includes("rating") || name.includes("score") || name.includes("percent")) return "numeric";
    if (name.includes("is_") || name.includes("has_") || name.includes("enabled") || name.includes("active") || name.includes("verified") || name.includes("public") || name.includes("featured")) return "boolean";
    if (name.includes("_at") || name.includes("date") || name.includes("time") || name.includes("expires") || name.includes("started") || name.includes("ended")) return "timestamptz";
    if (name.includes("meta") || name.includes("config") || name.includes("settings") || name.includes("data") || name.includes("payload") || name.includes("options")) return "jsonb";
    // Default correction: uuid → varchar for unknown non-ID columns
    return "varchar";
  }

  // timestamptz is a first-class type the AI is told to emit — never silently change it.
  if (aiType === "timestamptz") return "timestamptz";

  // Plain timestamp: upgrade to timestamptz for genuine date/time columns (so all generated
  // timestamps are timezone-aware), and downcast to varchar only for clearly-misnamed columns.
  if (aiType === "timestamp") {
    const isDateNamed = name.includes("_at") || name.includes("date") || name.includes("time") ||
      name.includes("expires") || name.includes("started") || name.includes("ended") ||
      name.includes("created") || name.includes("updated") || name.includes("deleted") ||
      name.includes("published") || name.includes("scheduled") || name.includes("last_") ||
      name.includes("next_");
    if (isDateNamed) return "timestamptz";
    if (name.includes("code") || name.includes("coupon") || name.includes("token") || name.includes("name") || name.includes("key") || name.includes("status") || name.includes("version")) return "varchar";
  }

  return aiType;
}

// Sanitize AI-generated tables: deduplicate columns and fix AI type mistakes.
// ID/timestamp injection is handled by compiler Pass 7 (ensureStandardColumns).
function sanitizeGeneratedTables(tables: any[]): any[] {
  return tables.map(t => {
    const seen = new Set<string>();
    const cleanedCols = (t.columns || []).filter((c: any) => {
      const name = (c.name || "").toLowerCase();
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    }).map((c: any) => ({
      ...c,
      type: inferCorrectType(c.name, c.type || "varchar", !!c.isForeignKey),
    }));

    return { ...t, columns: cleanedCols };
  });
}

// Convert edge function's {"tables":[...]} JSON format to TableNode[]
// This handles the AI response when the edge function overrides the system prompt
// to return full table definitions (with indexes, CHECK constraints, etc.)
function convertAITablesToNodes(tables: any[]): Omit<TableNode, "x" | "y">[] {
  const sanitized = sanitizeGeneratedTables(tables);
  return sanitized.map(t => {
    const columns: Column[] = (t.columns || []).map((c: any) => ({
      id: uuidv4(),
      name: c.name,
      type: c.type || "varchar",
      isForeignKey: !!c.isForeignKey,
      linkedTable: c.linkedTable || undefined,
      linkedColumn: c.linkedColumn || "id",
      constraints: c.constraints || [],
      description: c.description,
      fkStatus: c.isForeignKey ? "unresolved" : "resolved",
    }));
    return {
      id: uuidv4(),
      name: t.name,
      columns,
      indexes: t.indexes,
      checkConstraints: t.checkConstraints,
    };
  });
}

// ─── Reactive Chaining: continuation loop for truncated schema generation ───
async function runContinuationChain(
  originalPrompt: string,
  initialTables: Omit<TableNode, "x" | "y">[],
  strategy: string,
  tracker: ReturnType<typeof createGenerationTracker>,
): Promise<{ tables: Omit<TableNode, "x" | "y">[]; continuationCount: number }> {
  let allTables = [...initialTables];
  let continuationCount = 0;
  let wasTruncated = true;

  while (wasTruncated && continuationCount < MAX_CONTINUATION_CALLS) {
    continuationCount++;
    const batchLabel = `Generating remaining tables (batch ${continuationCount + 1})`;
    tracker.insertStep(batchLabel);
    tracker.advanceStep();

    const contPrompt = buildContinuationPrompt(originalPrompt, allTables);
    const contResponse = await callAIRaw("generate-schema", contPrompt, undefined, strategy);

    try {
      const contResult = robustJsonParse(contResponse.result);
      if (contResult?.tables && Array.isArray(contResult.tables) && contResult.tables.length > 0) {
        const newTables = convertAITablesToNodes(contResult.tables);
        // Dedup: filter out tables whose names already exist (case-insensitive)
        const existingNames = new Set(allTables.map(t => t.name.toLowerCase()));
        const uniqueNew = newTables.filter(t => !existingNames.has(t.name.toLowerCase()));
        allTables = [...allTables, ...uniqueNew];
        console.log(`[VibeDB] Continuation batch ${continuationCount}: +${uniqueNew.length} tables (${allTables.length} total)${contResponse.truncated ? " — still truncated" : ""}`);
      } else {
        // AI returned no more tables — schema is complete
        console.log(`[VibeDB] Continuation batch ${continuationCount}: no new tables returned, stopping`);
        break;
      }
    } catch (err) {
      // Continuation parse failed — stop chaining, keep what we have
      console.warn(`[VibeDB] Continuation batch ${continuationCount} parse error, stopping:`, err);
      break;
    }

    wasTruncated = contResponse.truncated;
  }

  return { tables: allTables, continuationCount };
}

interface AIRawResponse {
  result: string;
  truncated: boolean;
  modelUsed: string;
}

async function callAIRaw(type: string, prompt: string, context?: string, strategy?: string): Promise<AIRawResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const controller = new AbortController();
  const timeoutMs = type === "generate-schema" ? 300000 : 120000; // 5 min for schema gen, 2 min otherwise
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/vibedb-ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ type, prompt, context, strategy }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `AI service error (${res.status})`);
    if (data?.error) throw new Error(data.error);
    const result = (data?.result || "").replace(/```json\n?/g, "").replace(/```sql\n?/g, "").replace(/```\n?/g, "").trim();
    return {
      result,
      truncated: !!data?.truncated,
      modelUsed: data?.model_used || "",
    };
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("Request timed out — try a simpler prompt or generate in parts");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function callAI(type: string, prompt: string, context?: string, strategy?: string) {
  const { result } = await callAIRaw(type, prompt, context, strategy);
  return result;
}

// ─── Force Layout ───────────────────────────────────────
// Deterministic greedy grid layout.
//   1. Sort tables by connection count (desc), ties broken by column count
//      (desc) then id (asc) so the result is fully deterministic.
//   2. Place them one at a time onto a uniform grid whose cell size is the
//      widest card + gap by the tallest card + gap — so two cells can never
//      overlap, regardless of card height.
//   3. Each table goes into the nearest free cell to the centroid of its
//      already-placed connected tables (spiral search outward), so connected
//      tables cluster together. Disconnected tables pack near the centre of
//      whatever is already on the canvas.
function runForceLayout(nodes: TableNode[]): TableNode[] {
  if (nodes.length === 0) return [];
  const newNodes: TableNode[] = JSON.parse(JSON.stringify(nodes));

  const H_GAP = 100; // set horizontal gap between cards
  const V_GAP = 48; // set vertical gap between cards
  const nodeH = (n: TableNode) => HEADER_HEIGHT + n.columns.length * ROW_HEIGHT;

  // Uniform cell: widest card + gap × tallest card + gap → cells never overlap.
  const stepX = TABLE_WIDTH + H_GAP;
  const stepY = Math.max(...newNodes.map(nodeH)) + V_GAP;

  // Build the connection (neighbour) graph from FK columns, both directions.
  const idToNode = new Map(newNodes.map(n => [n.id, n]));
  const neighbours = new Map<string, Set<string>>(newNodes.map(n => [n.id, new Set<string>()]));
  newNodes.forEach(n => {
    n.columns.forEach(col => {
      if (col.isForeignKey && col.linkedTableId && idToNode.has(col.linkedTableId)) {
        neighbours.get(n.id)!.add(col.linkedTableId);
        neighbours.get(col.linkedTableId)!.add(n.id);
      }
    });
  });

  // Most-connected first; ties → more columns first; then id for stability.
  const ordered = [...newNodes].sort((a, b) => {
    const d = neighbours.get(b.id)!.size - neighbours.get(a.id)!.size;
    if (d !== 0) return d;
    const c = b.columns.length - a.columns.length;
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });

  const cellOf = new Map<string, { col: number; row: number }>();
  const occupied = new Set<string>();
  const key = (c: number, r: number) => `${c},${r}`;
  const cellWorld = (c: number, r: number) => ({ x: c * stepX, y: r * stepY });

  ordered.forEach((n, i) => {
    if (i === 0) {
      cellOf.set(n.id, { col: 0, row: 0 });
      occupied.add(key(0, 0));
      return;
    }

    // Anchor = centroid of placed connected neighbours, else of everything placed.
    const placedNeighbours = [...neighbours.get(n.id)!].filter(id => cellOf.has(id));
    const anchorSet = placedNeighbours.length
      ? placedNeighbours.map(id => cellOf.get(id)!)
      : [...cellOf.values()];
    const aCol = Math.round(anchorSet.reduce((s, c) => s + c.col, 0) / anchorSet.length);
    const aRow = Math.round(anchorSet.reduce((s, c) => s + c.row, 0) / anchorSet.length);

    // Cost of a candidate cell = total distance to placed connected neighbours
    // (or to the anchor itself when this table has none placed yet).
    const targets = placedNeighbours.length
      ? placedNeighbours.map(id => cellWorld(cellOf.get(id)!.col, cellOf.get(id)!.row))
      : [cellWorld(aCol, aRow)];
    const cost = (c: number, r: number) => {
      const w = cellWorld(c, r);
      return targets.reduce((s, t) => s + Math.hypot(w.x - t.x, w.y - t.y), 0);
    };

    // Spiral outward in square rings. Once a free cell is found, scan one extra
    // ring too and keep the lowest Euclidean-cost cell — this rounds off the
    // diamond corners so the whole layout fills a disk rather than a square.
    let best: { col: number; row: number } | null = null;
    let bestCost = Infinity;
    let foundRing = -1;
    for (let ring = 0; ring <= 256; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue; // perimeter only
          const c = aCol + dc, r = aRow + dr;
          if (occupied.has(key(c, r))) continue;
          const k = cost(c, r);
          if (k < bestCost) { bestCost = k; best = { col: c, row: r }; }
        }
      }
      if (best) {
        if (foundRing === -1) foundRing = ring;
        if (ring >= foundRing + 1) break; // one extra ring rounds the corners
      }
    }

    const slot = best ?? { col: aCol, row: aRow };
    cellOf.set(n.id, slot);
    occupied.add(key(slot.col, slot.row));
  });

  // Write final pixel positions: card centred within its grid cell.
  newNodes.forEach(n => {
    const { col, row } = cellOf.get(n.id)!;
    const c = cellWorld(col, row);
    n.x = c.x - TABLE_WIDTH / 2;
    n.y = c.y - nodeH(n) / 2;
  });

  return newNodes;
}

// ─── Hook: History ──────────────────────────────────────
function useHistory<T>(initial: T): [T, (action: T | ((prev: T) => T)) => void, () => void, () => void, boolean, boolean] {
  const [history, setHistory] = useState([initial]);
  const [idx, setIdx] = useState(0);
  const state = history[idx];
  const setState = useCallback((action: T | ((prev: T) => T)) => {
    setHistory(prev => {
      const slice = prev.slice(0, idx + 1);
      const current = slice[slice.length - 1];
      const next = typeof action === "function" ? (action as (prev: T) => T)(current) : action;
      const cloned = JSON.parse(JSON.stringify(next));
      const newH = [...slice, cloned];
      setIdx(newH.length - 1);
      return newH;
    });
  }, [idx]);
  const undo = useCallback(() => setIdx(p => Math.max(0, p - 1)), []);
  const redo = useCallback(() => setIdx(p => Math.min(history.length - 1, p + 1)), [history.length]);
  return [state, setState, undo, redo, idx > 0, idx < history.length - 1];
}

// ─── Generation Progress UI ─────────────────────────────
function GenerationProgressUI({ progress }: { progress: GenerationProgress }) {
  return (
    <div className="space-y-1.5">
      {progress.steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2 text-xs">
          {step.status === "completed" ? (
            <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
          ) : step.status === "error" ? (
            <AlertCircle size={12} className="text-red-500 shrink-0" />
          ) : step.status === "active" ? (
            <Loader2 size={12} className="animate-spin text-accent shrink-0" />
          ) : (
            <div className="h-3 w-3 shrink-0 rounded-full border border-muted-foreground/30" />
          )}
          <span className={step.status === "active" ? "text-foreground font-medium" : "text-muted-foreground"}>
            {step.label}
          </span>
          {step.startedAt && step.completedAt && (
            <span className="ml-auto text-[10px] text-muted-foreground/60">
              {((step.completedAt - step.startedAt) / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      ))}
      {progress.totalDurationMs != null && progress.overallStatus !== "running" && (
        <div className="mt-1 text-[10px] text-muted-foreground/60">
          Total: {(progress.totalDurationMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
}

// ─── Compiler Report UI ──────────────────────────────────
function CompilerReportUI({ report }: { report: CompilerReport }) {
  const [expanded, setExpanded] = React.useState(false);

  // Group actions by pass type
  const grouped = React.useMemo(() => {
    const map = new Map<string, typeof report.actions>();
    for (const a of report.actions) {
      const group = map.get(a.pass) || [];
      group.push(a);
      map.set(a.pass, group);
    }
    return map;
  }, [report.actions]);

  const passLabels: Record<string, string> = {
    "naming": "Naming fixes",
    "domain-detection": "Domain detected",
    "check-constraint": "CHECK constraints added",
    "domain-type-upgrade": "Domain type upgrades",
    "fk-index": "FK indexes added",
    "dedup": "Duplicates removed",
    "timestamp-default": "Timestamp defaults added",
    "semantic-constraint": "Semantic constraint fixes",
    "standard-columns": "Standard columns enforced",
  };

  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition w-full"
      >
        <ChevronDown size={10} className={`transition-transform ${expanded ? "" : "-rotate-90"}`} />
        <Zap size={11} className="text-amber-500" />
        <span className="font-medium">Compiler: {report.actions.length} fix{report.actions.length !== 1 ? "es" : ""} applied</span>
        {report.detectedDomains?.map(d => (
          <span key={d.domain} className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-400 font-medium">{d.domain.replace(/-/g, " ")}</span>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground/50">{report.durationMs}ms</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 pl-5">
          {Array.from(grouped.entries()).map(([pass, actions]) => (
            <div key={pass} className="text-[11px]">
              <span className="text-muted-foreground">→ {actions.length} {passLabels[pass] || pass}</span>
              <div className="pl-3 space-y-0.5">
                {actions.slice(0, 5).map((a, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground/70 truncate max-w-[400px]">{a.description}</div>
                ))}
                {actions.length > 5 && (
                  <div className="text-[10px] text-muted-foreground/50">...and {actions.length - 5} more</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────
const VibeDBPage = () => {
  const [prompt, setPrompt] = useState("");
  const [isPromptFocused, setIsPromptFocused] = useState(false);
  const [typewriterText, setTypewriterText] = useState("");
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prompt !== "" || isPromptFocused) {
      setTypewriterText("");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let suggestionIndex = 0;
    let charIndex = 0;

    const tick = () => {
      if (cancelled) return;
      const current = PROMPT_SUGGESTIONS[suggestionIndex];
      if (charIndex < current.length) {
        charIndex += 1;
        setTypewriterText(current.slice(0, charIndex));
        timer = setTimeout(tick, 50);
      } else {
        timer = setTimeout(() => {
          if (cancelled) return;
          suggestionIndex = (suggestionIndex + 1) % PROMPT_SUGGESTIONS.length;
          charIndex = 0;
          setTypewriterText("");
          timer = setTimeout(tick, 50);
        }, 2000);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [prompt, isPromptFocused]);

  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, PROMPT_TEXTAREA_MAX_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > PROMPT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [prompt]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarItems, setSidebarItems] = useState<Omit<TableNode, "x" | "y">[]>([]);
  const [canvasItems, setCanvasItems, undo, redo, canUndo, canRedo] = useHistory<TableNode[]>([]);
  const [schemaEnums, setSchemaEnums] = useState<SchemaEnum[]>([]);
  const [schemaFunctions, setSchemaFunctions] = useState<SchemaFunction[]>([]);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [draggingTable, setDraggingTable] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // ─── Projects (localStorage) ─────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled Schema");
  const [supabaseBaseline, setSupabaseBaseline] = useState<SupabaseBaseline | null>(null);
  const [ddlPatches, setDdlPatches] = useState<DDLPatch[]>([]);
  const [showProjectsPanel, setShowProjectsPanel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track recently-resolved FK column IDs for green pulse animation
  const prevFkStatusRef = useRef<Map<string, string>>(new Map());
  const [recentlyResolvedIds, setRecentlyResolvedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prevMap = prevFkStatusRef.current;
    const newlyResolved = new Set<string>();
    for (const table of canvasItems) {
      for (const col of table.columns) {
        const prev = prevMap.get(col.id);
        if (prev === "unresolved" && col.fkStatus === "resolved") {
          newlyResolved.add(col.id);
        }
      }
    }
    // Update the previous map
    const nextMap = new Map<string, string>();
    for (const table of canvasItems) {
      for (const col of table.columns) {
        if (col.fkStatus) nextMap.set(col.id, col.fkStatus);
      }
    }
    prevFkStatusRef.current = nextMap;

    if (newlyResolved.size > 0) {
      setRecentlyResolvedIds(newlyResolved);
      const timer = setTimeout(() => setRecentlyResolvedIds(new Set()), 1000);
      return () => clearTimeout(timer);
    }
  }, [canvasItems]);

  // Load projects list on mount
  useEffect(() => {
    const metas = ProjectStorage.listProjects();
    setProjects(metas.map(s => ({
      id: s.id,
      name: s.name || "Untitled Schema",
      definition: [], // lightweight list — full data loaded on demand from IndexedDB
      updated_at: s.updated_at,
    })));
    const lastProjectId = ProjectStorage.getCurrentProjectId();
    if (lastProjectId) {
      const meta = metas.find(p => p.id === lastProjectId);
      if (meta) {
        setCurrentProjectId(meta.id);
        setProjectName(meta.name);
        // Load full project data (with definition + dataRows) from IndexedDB
        ProjectStorage.getProject(meta.id).then(full => {
          if (full) {
            setCanvasItems(full.definition);
            setSupabaseBaseline(full.supabaseBaseline || null);
            setDdlPatches(full.ddlPatches || []);
          }
        });
      }
    }
  }, []);

  // Auto-save current project when canvas changes (debounced)
  useEffect(() => {
    if (!currentProjectId || (canvasItems.length === 0 && ddlPatches.length === 0)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await ProjectStorage.saveProject({
        id: currentProjectId,
        name: projectName,
        definition: canvasItems,
        supabaseBaseline: supabaseBaseline || undefined,
        ddlPatches,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      setProjects(prev => prev.map(p =>
        p.id === currentProjectId
          ? { ...p, definition: canvasItems, name: projectName, updated_at: new Date().toISOString() }
          : p
      ));
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [canvasItems, currentProjectId, projectName, supabaseBaseline, ddlPatches]);

  const saveProject = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setIsSaving(true);
    try {
      if (currentProjectId) {
        await ProjectStorage.saveProject({
          id: currentProjectId,
          name: projectName,
          definition: canvasItems,
          supabaseBaseline: supabaseBaseline || undefined,
          ddlPatches,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
        setProjects(prev => prev.map(p =>
          p.id === currentProjectId
            ? { ...p, definition: canvasItems, name: projectName, updated_at: new Date().toISOString() }
            : p
        ));
        addToast("Project saved", "success");
      } else {
        const newId = uuidv4();
        const now = new Date().toISOString();
        await ProjectStorage.saveProject({
          id: newId,
          name: projectName,
          definition: canvasItems,
          supabaseBaseline: supabaseBaseline || undefined,
          ddlPatches,
          updated_at: now,
          created_at: now,
        });
        setCurrentProjectId(newId);
        ProjectStorage.setCurrentProjectId(newId);
        setProjects(prev => [{
          id: newId,
          name: projectName,
          definition: canvasItems,
          updated_at: now,
        }, ...prev]);
        addToast("Project created", "success");
      }
    } catch {
      addToast("Failed to save project", "error");
    } finally {
      setIsSaving(false);
    }
  }, [currentProjectId, canvasItems, projectName, supabaseBaseline, ddlPatches]);

  const loadProject = useCallback(async (project: Project) => {
    setCurrentProjectId(project.id);
    ProjectStorage.setCurrentProjectId(project.id);
    setProjectName(project.name);
    // Load full project data (with dataRows) from IndexedDB
    const full = await ProjectStorage.getProject(project.id);
    setCanvasItems(full ? full.definition : project.definition);
    setSupabaseBaseline(full?.supabaseBaseline || null);
    setDdlPatches(full?.ddlPatches || []);
    setSidebarItems([]);
    setShowProjectsPanel(false);
    addToast(`Opened "${project.name}"`, "info");
  }, []);

  const newProject = useCallback(() => {
    setCurrentProjectId(null);
    ProjectStorage.setCurrentProjectId(null);
    setProjectName("Untitled Schema");
    setCanvasItems([]);
    setSupabaseBaseline(null);
    setDdlPatches([]);
    setSidebarItems([]);
    setShowProjectsPanel(false);
    addToast("New project created", "info");
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    await ProjectStorage.deleteProject(projectId);
    setProjects(prev => prev.filter(p => p.id !== projectId));
    if (currentProjectId === projectId) {
      setCurrentProjectId(null);
      ProjectStorage.setCurrentProjectId(null);
      setProjectName("Untitled Schema");
      setCanvasItems([]);
      setSupabaseBaseline(null);
      setDdlPatches([]);
    }
    addToast("Project deleted", "success");
  }, [currentProjectId]);

  // Feature states
  const [expertMode, setExpertMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("vibeclean_expert_mode") === "true";
  });
  useEffect(() => {
    localStorage.setItem("vibeclean_expert_mode", String(expertMode));
  }, [expertMode]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [editingTable, setEditingTable] = useState<string | null>(null);
  const [editingTableName, setEditingTableName] = useState("");
  const [editingColumn, setEditingColumn] = useState<{ tableId: string; columnId: string } | null>(null);
  const [generatingTableId, setGeneratingTableId] = useState<string | null>(null);

  // Modals
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [generatedSql, setGeneratedSql] = useState("");
  const [copied, setCopied] = useState(false);
  const [showRlsModal, setShowRlsModal] = useState(false);
  const [generatedRlsSql, setGeneratedRlsSql] = useState("");
  const [showPlayground, setShowPlayground] = useState(false);
  const [playgroundInitialSql, setPlaygroundInitialSql] = useState("");
  const [queryPrompt, setQueryPrompt] = useState("");
  const [isCallingAI, setIsCallingAI] = useState(false);
  const [generatedQuery, setGeneratedQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [normalizeOnImport, setNormalizeOnImport] = useState(false);
  const [normalizedSQL, setNormalizedSQL] = useState<string | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditPhase, setAuditPhase] = useState("");
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPrompt, setBatchPrompt] = useState("");
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [showAddTableMenu, setShowAddTableMenu] = useState(false);
  const [aiTablePrompt, setAiTablePrompt] = useState("");
  const [isAddingAiTable, setIsAddingAiTable] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showMockDataModal, setShowMockDataModal] = useState(false);
  const [mockDataSql, setMockDataSql] = useState("");
  const [isGeneratingMockData, setIsGeneratingMockData] = useState(false);
  const [isGeneratingSidebar, setIsGeneratingSidebar] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);

  // AI Thinking & Generation Tracking
  const [generationThinking, setGenerationThinking] = useState<string>("");
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState(getDefaultStrategy);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // Feature Panels
  const [showDBManager, setShowDBManager] = useState(false);
  const [showQueryBuilder, setShowQueryBuilder] = useState(false);
  const [showSupabasePanel, setShowSupabasePanel] = useState(false);
  const [showSREMode, setShowSREMode] = useState(false);
  const [showAskData, setShowAskData] = useState(false);

  // Deploy
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployUrl, setDeployUrl] = useState(() => localStorage.getItem("vibedb_deploy_url") || "");
  const [deployKey, setDeployKey] = useState(() => localStorage.getItem("vibedb_deploy_key") || "");
  const [deployConnected, setDeployConnected] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResults, setDeployResults] = useState<{ statement: string; success: boolean; error?: string }[] | null>(null);
  const [isImportingRows, setIsImportingRows] = useState(false);
  const [deployFixResult, setDeployFixResult] = useState<FixResult | null>(null);
  const [compilerReport, setCompilerReport] = useState<CompilerReport | null>(null);
  const [showSyncReview, setShowSyncReview] = useState(false);
  const [syncSql, setSyncSql] = useState("");
  const [syncDiff, setSyncDiff] = useState<SchemaDiff | null>(null);
  const [syncPatchIds, setSyncPatchIds] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Schema Diff
  const [diffBase, setDiffBase] = useState<TableNode[] | null>(null);
  const [showSchemaCompare, setShowSchemaCompare] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // Connection mode
  const [connectionMode, setConnectionMode] = useState<{ sourceTableId: string; sourceColumnId: string } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const mockDataAbortRef = useRef<AbortController | null>(null);

  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts(prev => {
      const next = [...prev, { id, message, type }];
      // Cap at 3 visible toasts — remove oldest if over limit
      return next.length > 3 ? next.slice(-3) : next;
    });
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500);
  }, []);

  const addDdlPatch = useCallback((patch: { title?: string; description?: string; sql: string; source: DDLPatch["source"] }) => {
    const sql = cleanSqlFence(patch.sql || "");
    if (!sql) {
      addToast("DDL patch is empty", "warning");
      return null;
    }

    // Dedup by normalized SQL: patches flow straight into the exported SQL with no UI to remove
    // them, so identical AI/batch suggestions must not stack duplicate blocks.
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const dupe = ddlPatches.find(p => normalize(p.sql) === normalize(sql));
    if (dupe) return dupe;

    const next: DDLPatch = {
      id: uuidv4(),
      title: patch.title?.trim() || "DDL patch",
      description: patch.description?.trim() || undefined,
      sql,
      source: patch.source,
      status: "pending",
      warnings: analyzeMigrationRisks(sql),
      createdAt: new Date().toISOString(),
    };

    setDdlPatches(prev => [next, ...prev]);
    return next;
  }, [addToast, ddlPatches]);

  const markDdlPatchesApplied = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const appliedAt = new Date().toISOString();
    setDdlPatches(prev => prev.map(patch => (
      idSet.has(patch.id) ? { ...patch, status: "applied", appliedAt } : patch
    )));
  }, []);

  const supabaseSyncDiff = useMemo(
    () => supabaseBaseline ? computeSchemaDiff(supabaseBaseline.tables, canvasItems) : null,
    [supabaseBaseline, canvasItems]
  );
  const pendingDdlPatches = useMemo(() => ddlPatches.filter(p => p.status === "pending"), [ddlPatches]);
  const pendingDdlPatchCount = pendingDdlPatches.length;
  const hasPendingDdlPatches = pendingDdlPatchCount > 0;
  const hasSupabaseBaseline = !!supabaseBaseline;
  const hasSupabaseSyncChanges = hasSchemaDiffChanges(supabaseSyncDiff);
  const hasSupabaseSyncWork = hasSupabaseSyncChanges || hasPendingDdlPatches;
  const supabaseSyncChangeCount = countSchemaDiffChanges(supabaseSyncDiff);
  const syncReviewSummary = useMemo(() => summarizeSchemaDiff(syncDiff), [syncDiff]);
  const syncReviewRisks = useMemo(() => analyzeMigrationRisks(syncSql), [syncSql]);
  const syncReviewPatches = useMemo(
    () => ddlPatches.filter(patch => syncPatchIds.includes(patch.id)),
    [ddlPatches, syncPatchIds]
  );
  const deployNavLabel = hasSupabaseBaseline
    ? deployConnected
      ? hasSupabaseSyncWork ? "Sync" : "Synced"
      : "Connect & Sync"
    : deployConnected ? "Deploy" : "Connect & Deploy";
  const deployModalTitle = hasSupabaseBaseline ? "Sync to Supabase" : "Deploy to Supabase";
  const deployPrimaryLabel = hasSupabaseBaseline
    ? isSyncing
      ? "Syncing..."
      : hasSupabaseSyncWork ? "Review Sync" : "Synced"
    : isDeploying ? "Deploying..." : deployFixResult ? "Re-deploy Fixed Schema" : "Deploy Schema";

  // Track whether we're in the middle of a normalization import
  const skipNormalizedClearRef = useRef(false);
  useEffect(() => {
    setGeneratedSql("");
    if (skipNormalizedClearRef.current) {
      skipNormalizedClearRef.current = false; // Reset flag, don't clear normalizedSQL
    } else {
      setNormalizedSQL(null);
    }
  }, [canvasItems]);

  // Keyboard shortcuts
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSqlModal(false); setShowPlayground(false); setEditingTable(null);
        setShowImportModal(false); setShowAuditModal(false); setShowBatchModal(false);
        setShowAddTableMenu(false); setShowExportMenu(false); setShowMockDataModal(false);
        setConnectionMode(null); setEditingColumn(null); setShowDiff(false);
        setShowDeployModal(false); setShowChatPanel(false);
        setShowDBManager(false); setShowQueryBuilder(false);
        setShowSupabasePanel(false); setShowSREMode(false);
        setShowHistoryPanel(false); setShowSchemaCompare(false);
        setShowAskData(false); setShowSyncReview(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [undo, redo]);

  // ─── AI Generate Schema ───────────────────────────────
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setSidebarItems([]);
    setAuditReport(null);
    setThinkingExpanded(true);

    const tracker = createGenerationTracker(setGenerationProgress);
    const strategy = selectedStrategy;
    let generatedTables: Omit<TableNode, "x" | "y">[] = [];
    let errorMsg = "";
    let continuationCount = 0;

    if (strategy === "v4-parallel" || strategy === "v4-slow") {
      tracker.start([
        "Designing schema blueprint",
        "Generating all tables in parallel",
        ...(strategy === "v4-slow" ? ["Reviewing cross-table consistency"] : []),
        "Compiling schema (deterministic passes)",
        "Resolving foreign keys",
        "Finalizing schema",
      ]);
    } else if (strategy === "v2-pipeline") {
      tracker.start([
        "Extracting entities from prompt",
        "Designing full schema with constraints",
        "Compiling schema (deterministic passes)",
        "Resolving foreign keys",
        "Finalizing schema",
      ]);
    } else {
      tracker.start([
        "Sending prompt to AI",
        "Parsing schema response",
        "Compiling schema (deterministic passes)",
        "Resolving foreign keys",
        "Finalizing schema",
      ]);
    }

    try {
      if (strategy === "v4-parallel" || strategy === "v4-slow") {
        // ─── Parallel fan-out generation ─────────────────
        // Phase 1: one small, fast call designs the blueprint — table names,
        // purposes, and FK relationships. This pins the contract every
        // parallel worker must follow, so table names can't drift.
        const bpResponse = await callAIRaw("design-schema", prompt, undefined, strategy);
        const bpResult = robustJsonParse(bpResponse.result);
        const designTables: any[] = Array.isArray(bpResult?.tables) ? bpResult.tables : [];
        const tableNames: string[] = designTables
          .map((t: any) => (typeof t === "string" ? t : t?.name))
          .filter(Boolean);
        if (tableNames.length === 0) throw new Error("Blueprint returned no tables — try rephrasing the prompt");
        const blueprintJson = JSON.stringify({ tables: designTables });
        tracker.advanceStep(`${tableNames.length} tables planned`);

        // Phase 2: generate every table simultaneously. Each call produces
        // ~one table of JSON (seconds, not minutes) so the edge function's
        // 150s wall-clock limit is never a factor.
        const generateOne = async (name: string): Promise<any> => {
          const resp = await callAIRaw("generate-table", name, blueprintJson, strategy);
          const parsed = robustJsonParse(resp.result);
          const table = parsed?.tables?.[0] ?? parsed?.table ?? (parsed?.name && parsed?.columns ? parsed : null);
          if (!table?.name || !Array.isArray(table.columns)) throw new Error(`Invalid table response for ${name}`);
          return table;
        };

        const rawTables: any[] = [];
        let failedNames: string[] = [];

        // The first call runs alone: it writes the shared prompt cache that
        // the remaining parallel calls read (cached input is ~10% cost and
        // doesn't count toward rate limits).
        try {
          rawTables.push(await generateOne(tableNames[0]));
        } catch {
          failedNames.push(tableNames[0]);
        }

        const WAVE_SIZE = 8; // concurrency cap — keeps bursts polite
        const remaining = tableNames.slice(1);
        for (let i = 0; i < remaining.length; i += WAVE_SIZE) {
          const wave = remaining.slice(i, i + WAVE_SIZE);
          const settled = await Promise.allSettled(wave.map(generateOne));
          settled.forEach((res, j) => {
            if (res.status === "fulfilled") rawTables.push(res.value);
            else failedNames.push(wave[j]);
          });
        }

        // One sequential retry pass for any failures
        for (const name of [...failedNames]) {
          try {
            rawTables.push(await generateOne(name));
            failedNames = failedNames.filter(n => n !== name);
          } catch {
            // still failed — reported below, generation continues
          }
        }
        if (failedNames.length > 0) {
          addToast(`Could not generate: ${failedNames.join(", ")} — retry or add manually`, "warning");
        }
        if (rawTables.length === 0) throw new Error("All table generations failed — try again");
        tracker.advanceStep(`${rawTables.length}/${tableNames.length} tables generated`);

        // Phase 3 (Slow only): one review call checks the assembled schema
        // for cross-table inconsistencies and returns corrected tables.
        if (strategy === "v4-slow") {
          try {
            const reviewResp = await callAIRaw("consistency-check", "", JSON.stringify({ tables: rawTables }), strategy);
            const review = robustJsonParse(reviewResp.result);
            if (Array.isArray(review?.tables) && review.tables.length > 0) {
              const corrected = new Map(
                review.tables.filter((t: any) => t?.name && Array.isArray(t?.columns)).map((t: any) => [t.name.toLowerCase(), t]),
              );
              for (let i = 0; i < rawTables.length; i++) {
                const fix = corrected.get(rawTables[i].name.toLowerCase());
                if (fix) rawTables[i] = fix;
              }
              addToast(`Consistency review: ${corrected.size} table${corrected.size !== 1 ? "s" : ""} corrected`, "info");
            }
          } catch (err) {
            // Review is best-effort — the generated tables are still valid
            console.warn("[VibeDB] Consistency review failed, keeping generated tables:", err);
          }
          tracker.advanceStep();
        }

        generatedTables = convertAITablesToNodes(rawTables);
      } else if (strategy === "v2-pipeline") {
        // Pipeline: Step 1 — entity extraction
        const entityPrompt = `Extract the core entities (tables) and their relationships from this requirement. Return JSON: { "entities": [...], "relationships": [...] }.\n\nRequirement: "${prompt}"`;
        const entityStr = await callAI("generate-schema", entityPrompt, undefined, strategy);
        const entityResult = robustJsonParse(entityStr);
        tracker.advanceStep();

        // Pipeline: Step 2 — full schema design from entities (always use tables format)
        if (entityResult?.entities) {
          const entityNames = entityResult.entities.map((e: any) => e.name || e).join(", ");
          const schemaPrompt = `Design a full production-quality PostgreSQL schema for these entities: [${entityNames}].\nOriginal requirement: "${prompt}"\n\nIMPORTANT: Return JSON with {"tables":[...]} format. Do NOT return entities format.`;
          const schemaResponse = await callAIRaw("generate-schema", schemaPrompt, undefined, strategy);
          const schemaResult = robustJsonParse(schemaResponse.result);
          tracker.advanceStep();

          if (schemaResult?.tables && Array.isArray(schemaResult.tables)) {
            generatedTables = convertAITablesToNodes(schemaResult.tables);
          } else {
            // Fallback: if AI still returned entities, convert them to minimal tables
            const fallbackTables = (schemaResult?.entities || entityResult.entities).map((e: any) => ({
              name: typeof e === "string" ? e : e.name,
              columns: [
                { name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "notNull" }] },
                ...(e.attributes || []).map((a: any) => ({ name: a.name, type: a.type || "varchar", constraints: [{ type: "notNull" }] })),
                { name: "created_at", type: "timestamptz", constraints: [{ type: "default", value: "now()" }] },
                { name: "updated_at", type: "timestamptz", constraints: [{ type: "default", value: "now()" }] },
              ],
              indexes: [],
              checkConstraints: [],
            }));
            generatedTables = convertAITablesToNodes(fallbackTables);
          }

          // Reactive chaining: if truncated, generate remaining tables
          if (schemaResponse.truncated && generatedTables.length > 0) {
            const chainResult = await runContinuationChain(prompt, generatedTables, strategy, tracker);
            generatedTables = chainResult.tables;
            continuationCount = chainResult.continuationCount;
          }
        } else {
          tracker.advanceStep();
        }
      } else {
        // Direct or Fast: single AI call — always uses tables format via edge function system prompt
        const initialResponse = await callAIRaw("generate-schema", prompt, undefined, strategy);
        tracker.advanceStep();
        const result = robustJsonParse(initialResponse.result);

        if (result?.tables && Array.isArray(result.tables)) {
          generatedTables = convertAITablesToNodes(result.tables);
        } else if (result?.entities && Array.isArray(result.entities)) {
          // AI returned entities instead of tables — convert to tables format and process
          const fallbackTables = result.entities.map((e: any) => ({
            name: typeof e === "string" ? e : e.name,
            columns: [
              { name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "notNull" }] },
              ...(e.attributes || []).map((a: any) => ({ name: a.name, type: a.type || "varchar", constraints: [{ type: "notNull" }] })),
              { name: "created_at", type: "timestamptz", constraints: [{ type: "default", value: "now()" }] },
              { name: "updated_at", type: "timestamptz", constraints: [{ type: "default", value: "now()" }] },
            ],
            indexes: [],
            checkConstraints: [],
          }));
          generatedTables = convertAITablesToNodes(fallbackTables);
        }
        tracker.advanceStep();

        // Reactive chaining: if truncated, generate remaining tables
        if (initialResponse.truncated && generatedTables.length > 0) {
          const chainResult = await runContinuationChain(prompt, generatedTables, strategy, tracker);
          generatedTables = chainResult.tables;
          continuationCount = chainResult.continuationCount;
        }
      }

      if (generatedTables.length > 0) {
        // Position tables on canvas in a grid layout
        const positioned = generatedTables.map((t, i) => ({
          ...t,
          x: (-view.x / view.zoom) + 100 + (i % 4) * 300,
          y: (-view.y / view.zoom) + 100 + Math.floor(i / 4) * 300,
        })) as TableNode[];

        // Run deterministic compiler pipeline
        tracker.advanceStep();
        const { tables: compiled, report: cReport } = runCompilerPass(positioned);
        setCompilerReport(cReport);

        // Resolve FK linkedTableId references bidirectionally
        tracker.advanceStep();
        setCanvasItems(prev => {
          return resolveCanvasFKsBidirectional(prev, compiled);
        });
        tracker.complete();
        const fixCount = cReport.actions.length;
        const batchNote = continuationCount > 0 ? ` across ${continuationCount + 1} batches` : "";
        addToast(`Generated ${generatedTables.length} tables${batchNote}${fixCount > 0 ? ` · Compiler: ${fixCount} fix${fixCount !== 1 ? "es" : ""} applied` : ""}`, "success");
        setGenerationProgress(null);
        setThinkingExpanded(false);
      } else {
        tracker.complete();
        addToast("No tables extracted from prompt", "warning");
      }
    } catch (err: any) {
      errorMsg = err.message?.includes("Failed to fetch") || err.message?.includes("timed out")
        ? "Generation timed out — the AI is still working. Try again or use a simpler prompt."
        : err.message?.includes("parse") || err.message?.includes("JSON")
        ? "AI response was too large to process completely. Try again or use a simpler prompt."
        : err.message || "Failed to generate schema";
      tracker.fail(errorMsg);
      addToast(errorMsg, "error");
    } finally {
      setIsGenerating(false);

      // Record to generation history
      const progress = tracker.getProgress();
      const record: GenerationRecord = {
        id: uuidv4(),
        prompt: prompt.trim(),
        strategy,
        steps: progress.steps,
        resultTableCount: generatedTables.length,
        resultTableNames: generatedTables.map(t => t.name),
        startedAt: progress.startedAt || Date.now(),
        completedAt: progress.completedAt || Date.now(),
        durationMs: progress.totalDurationMs || 0,
        success: !errorMsg,
        error: errorMsg || undefined,
        continuationCount,
      };
      GenerationHistoryStore.addRecord(record);
    }
  };

  // ─── Sidebar: Generate More Tables ────────────────────
  const handleGenerateSidebarTables = async (sidebarPrompt: string) => {
    setIsGeneratingSidebar(true);
    try {
      const existingTables = [...canvasItems, ...sidebarItems.map(t => ({ ...t, x: 0, y: 0 }))].map(t => t.name).join(", ");

      // Send context about existing tables so the edge function knows what already exists
      const fullPrompt = `Generate 1-3 new tables for an existing system.\nExisting tables: [${existingTables}].\n\nRequirement: "${sidebarPrompt}"`;

      const resultStr = await callAI("generate-schema", fullPrompt, undefined, selectedStrategy);
      const result = robustJsonParse(resultStr);

      let generatedTables: Omit<TableNode, "x" | "y">[] = [];

      if (result?.tables && Array.isArray(result.tables)) {
        generatedTables = convertAITablesToNodes(result.tables);
      } else if (result?.entities && Array.isArray(result.entities)) {
        // Convert entities to minimal tables format instead of using lossy buildSchemaFromIntent
        const fallbackTables = result.entities.map((e: any) => ({
          name: typeof e === "string" ? e : e.name,
          columns: [
            { name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "notNull" }] },
            ...(e.attributes || []).map((a: any) => ({ name: a.name, type: a.type || "varchar", constraints: [{ type: "notNull" }] })),
            { name: "created_at", type: "timestamp", constraints: [{ type: "default", value: "now()" }] },
            { name: "updated_at", type: "timestamp", constraints: [{ type: "default", value: "now()" }] },
          ],
          indexes: [],
          checkConstraints: [],
        }));
        generatedTables = convertAITablesToNodes(fallbackTables);
      }

      if (generatedTables.length > 0) {
        // Run compiler pipeline on sidebar tables too
        const withPos = generatedTables.map(t => ({ ...t, x: 0, y: 0 })) as TableNode[];
        const { tables: compiled, report: cReport } = runCompilerPass(withPos);
        const withoutPos = compiled.map(({ x, y, ...rest }) => rest);
        setSidebarItems(prev => [...prev, ...withoutPos]);
        const fixCount = cReport.actions.length;
        addToast(`Compiled ${generatedTables.length} new tables${fixCount > 0 ? ` · ${fixCount} fix${fixCount !== 1 ? "es" : ""}` : ""}`, "success");
      } else {
        addToast("No valid entities extracted", "warning");
      }
    } catch {
      addToast("Failed to generate tables", "error");
    } finally {
      setIsGeneratingSidebar(false);
    }
  };

  // ─── Add item from sidebar to canvas ──────────────────
  const addItemToCanvas = useCallback((tableId: string, clientX?: number, clientY?: number) => {
    const itemIndex = sidebarItems.findIndex(i => i.id === tableId);
    if (itemIndex === -1) return;
    const item = sidebarItems[itemIndex];
    setCanvasItems(currentItems => {
      let startX: number, startY: number;
      if (clientX !== undefined && clientY !== undefined && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        startX = (clientX - rect.left - view.x) / view.zoom - TABLE_WIDTH / 2;
        startY = (clientY - rect.top - view.y) / view.zoom - HEADER_HEIGHT / 2;
      } else {
        const offset = currentItems.length * 40;
        startX = (-view.x / view.zoom) + 100 + (offset % 400);
        startY = (-view.y / view.zoom) + 100 + (offset % 300);
      }
      const newTable = { ...item, x: startX, y: startY } as TableNode;
      // Resolve FK links bidirectionally: new table → existing, existing → new table
      return resolveCanvasFKsBidirectional(currentItems, [newTable]);
    });
    setSidebarItems(prev => prev.filter((_, i) => i !== itemIndex));
  }, [sidebarItems, setCanvasItems, view]);

  // ─── Smart Add Column ─────────────────────────────────
  const handleSmartAddColumn = async (tableId: string) => {
    const table = canvasItems.find(t => t.id === tableId);
    if (!table) return;
    setGeneratingTableId(tableId);
    try {
      const existingCols = table.columns.map(c => c.name).join(", ");
      const resultStr = await callAI("smart-add-column", `Table "${table.name}" with columns: [${existingCols}]. Suggest ONE missing column.`);
      const result = robustJsonParse(resultStr);
      if (result?.name) {
        setCanvasItems(items => items.map(t =>
          t.id === tableId
            ? { ...t, columns: [...t.columns, { id: uuidv4(), name: result.name, type: result.type || "varchar", fkStatus: "resolved", constraints: [], description: result.description }] }
            : t
        ));
        addToast(`✨ Added: ${result.name}`, "success");
      }
    } catch { addToast("Failed to suggest column", "error"); }
    finally { setGeneratingTableId(null); }
  };

  // ─── Compile SQL ──────────────────────────────────────
  const handleCompileSQL = () => {
    if (canvasItems.length === 0) { addToast("Add tables first", "error"); return; }
    // If we have AI-generated normalized SQL, show that; otherwise generate from canvas
    let sql: string;
    if (normalizedSQL) {
      sql = normalizedSQL;
    } else {
      // Always run through the deterministic compiler before generating SQL
      const compiledAst = runCompilerPass(canvasItems).tables;
      sql = generateSQL(compiledAst);
    }
    setGeneratedSql(appendDdlPatchSql(sql, pendingDdlPatches));
    setShowSqlModal(true);
  };

  // ─── Generate RLS ──────────────────────────────────────
  const handleGenerateRLS = () => {
    if (canvasItems.length === 0) { addToast("Add tables first", "error"); return; }
    const compiledAst = runCompilerPass(canvasItems).tables;
    const rls = generateRLSPolicies(compiledAst);
    setGeneratedRlsSql(rls);
    setShowRlsModal(true);
  };

  // ─── Fix FK Issues from SQL Viewer ─────────────────
  const handleFixSqlIssues = () => {
    const canvasIssues = preDeployValidateSchema(canvasItems);
    if (canvasIssues.length === 0) {
      addToast("No issues found", "info");
      return;
    }

    const result = diagnoseAndFixSchema(canvasItems, canvasIssues, view);

    // Compile the fixed schema, then update canvas + SQL
    const { tables: compiledFix, report: fixReport } = runCompilerPass(result.fixedItems);
    setCompilerReport(fixReport);
    setCanvasItems(compiledFix);
    setGeneratedSql(generateSQL(compiledFix));

    const fixableCount = result.actions.filter(a => a.type !== "unfixable" && a.type !== "skip_existing").length;
    addToast(
      `Fixed ${fixableCount} issue${fixableCount !== 1 ? "s" : ""}` +
      (result.hasUnfixable ? ` (${result.actions.filter(a => a.type === "unfixable").length} unfixable)` : ""),
      result.hasUnfixable ? "warning" : "success"
    );
  };

  // ─── Export ───────────────────────────────────────────
  const handleExport = (format: string) => {
    try {
      // Always run through the deterministic compiler before exporting
      const compiledAst = runCompilerPass(canvasItems).tables;
      let content = "";
      let filename = "";
      switch (format) {
        case "prisma": content = generatePrismaSchema(compiledAst); filename = "schema.prisma"; break;
        case "drizzle": content = generateDrizzleSchema(compiledAst); filename = "schema.ts"; break;
        case "graphql": content = generateGraphQLTypes(compiledAst); filename = "schema.graphql"; break;
        case "csv": content = generateCSV(compiledAst); filename = "schema.csv"; break;
        case "zod": content = generateZodSchema(compiledAst); filename = "schema.zod.ts"; break;
        case "docs": content = generateDataDictionary(compiledAst); filename = "schema-docs.md"; break;
        case "sql": default: content = appendDdlPatchSql(generateSQL(compiledAst), pendingDdlPatches); filename = "schema.sql"; break;
      }
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setShowExportMenu(false);
      addToast(`Exported ${format}`, "success");
    } catch (e: any) {
      addToast("Export failed: " + e.message, "error");
    }
  };

  // ─── Deploy to Supabase ──────────────────────────────
  const handleTestConnection = async () => {
    if (!deployUrl || !deployKey) { addToast("Enter Supabase URL and service role key", "error"); return; }
    setIsTesting(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vibedb-deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ supabaseUrl: deployUrl, serviceRoleKey: deployKey, action: "test" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setDeployConnected(true);
      localStorage.setItem("vibedb_deploy_url", deployUrl);
      localStorage.setItem("vibedb_deploy_key", deployKey);
      addToast("Connected to Supabase!", "success");
    } catch (e: any) {
      addToast("Connection failed: " + e.message, "error");
      setDeployConnected(false);
    } finally {
      setIsTesting(false);
    }
  };

  const [deploySetupNeeded, setDeploySetupNeeded] = useState(false);

  const handleDeploy = async () => {
    if (canvasItems.length === 0) { addToast("No tables to deploy", "error"); return; }

    // Clear previous fix results
    setDeployFixResult(null);

    // Compile before deploying — enforces naming, constraints, standard columns
    const { tables: compiledItems, report: deployCompileReport } = runCompilerPass(canvasItems);
    setCompilerReport(deployCompileReport);
    setCanvasItems(compiledItems);

    // Pre-Deploy Schema Validation (on compiled schema)
    const preDeployIssues = preDeployValidateSchema(compiledItems);
    if (preDeployIssues.length > 0) {
      setDeployResults(preDeployIssues);
      addToast(`${preDeployIssues.length} schema issue${preDeployIssues.length !== 1 ? "s" : ""} found — fix before deploying`, "warning");
      return;
    }

    // Auto-heal deploy loop: deploy → if errors → classify → fix → retry (max 3 attempts)
    const MAX_ATTEMPTS = 3;
    let currentItems = compiledItems;
    let attempts = 0;
    let lastResult: { success: boolean; results: { statement: string; success: boolean; error?: string }[]; setupNeeded?: boolean } | null = null;

    setIsDeploying(true);
    setDeployResults(null);
    setDeploySetupNeeded(false);

    try {
      while (attempts < MAX_ATTEMPTS) {
        attempts++;
        console.log(`[VibeDB Deploy] Attempt ${attempts}/${MAX_ATTEMPTS}`);

        lastResult = await executeDeployCall(currentItems);

        // Setup needed — abort, show instructions
        if (lastResult.setupNeeded) {
          setDeploySetupNeeded(true);
          addToast("Setup required — see instructions in the deploy modal", "warning");
          return;
        }

        setDeployResults(lastResult.results);

        if (lastResult.success) {
          const healMsg = attempts > 1 ? ` (auto-healed after ${attempts - 1} fix${attempts > 2 ? "es" : ""})` : "";
          addToast(`Schema deployed successfully${healMsg}!`, "success");
          if (pendingDdlPatches.length > 0) {
            markDdlPatchesApplied(pendingDdlPatches.map(patch => patch.id));
          }

          // Self-Healing Telemetry
          if (deployFixResult && deployFixResult.initialErrors && deployFixResult.initialErrors.length > 0) {
            fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vibedb-telemetry`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
              body: JSON.stringify({ event: "schema_auto_fix_success", initialErrors: deployFixResult.initialErrors, appliedFixes: deployFixResult.actions }),
            }).catch(err => console.error("[VibeDB Telemetry]", err));
            setDeployFixResult(null);
          }
          return;
        }

        // Deploy failed — try auto-heal if not last attempt
        if (attempts >= MAX_ATTEMPTS) break;

        const failedResults = lastResult.results.filter(r => !r.success);
        if (failedResults.length === 0) break; // No errors to fix

        console.log(`[VibeDB Deploy] Auto-healing ${failedResults.length} errors...`);
        const fixResult = diagnoseAndFixSchema(currentItems, failedResults, view);

        if (fixResult.hasUnfixable || fixResult.actions.length === 0) {
          console.log("[VibeDB Deploy] Unfixable errors or no fixes available, stopping auto-heal");
          break;
        }

        // Apply fixes, compile, and retry
        currentItems = fixResult.fixedItems;
        const { tables: compiledFix } = runCompilerPass(currentItems);
        currentItems = compiledFix;
        setCanvasItems(currentItems);
        setDeployFixResult(fixResult);
        addToast(`Auto-healing: ${fixResult.actions.length} fix${fixResult.actions.length !== 1 ? "es" : ""} applied, retrying deploy...`, "info");
      }

      // If we get here, deploy failed after all attempts
      addToast(lastResult?.success === false ? "Deploy had errors — see details" : "Deploy failed", "warning");
    } catch (e: unknown) {
      addToast("Deploy failed: " + (e instanceof Error ? e.message : "Unknown error"), "error");
    } finally {
      setIsDeploying(false);
    }
  };


  const executeDeploySql = async (sqlToRun: string): Promise<{ success: boolean; results: { statement: string; success: boolean; error?: string }[]; setupNeeded?: boolean }> => {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vibedb-deploy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ sql: sqlToRun, supabaseUrl: deployUrl, serviceRoleKey: deployKey, action: "deploy" }),
    });
    const data = await res.json();

    if (data.setup_needed) {
      return { success: false, results: [], setupNeeded: true };
    }
    if (!res.ok && data.error) throw new Error(data.error);

    return {
      success: !!data.success,
      results: data.results || [],
    };
  };

  const executeDeployCall = async (itemsToDeploy: TableNode[]): Promise<{ success: boolean; results: { statement: string; success: boolean; error?: string }[]; setupNeeded?: boolean }> => {
    // Generate SQL from canvas items (always deferred FK mode unless we have normalized SQL)
    let sqlToRun: string;
    if (normalizedSQL) {
      sqlToRun = normalizedSQL;
      console.log("[VibeDB Deploy] Using AI-generated normalized SQL (length:", sqlToRun.length, ")");
    } else {
      sqlToRun = generateSQLDeferred(itemsToDeploy, schemaEnums, schemaFunctions);
      console.log("[VibeDB Deploy] Using DEFERRED FK SQL generation (always-on)");
    }
    const insertCount = (sqlToRun.match(/INSERT INTO/gi) || []).length;
    console.log("[VibeDB Deploy] INSERT count:", insertCount, "| Tables with dataRows:", itemsToDeploy.filter(t => t.dataRows && t.dataRows.length > 0).map(t => `${t.name}(${t.dataRows!.length} rows)`).join(", ") || "none");
    sqlToRun = appendDdlPatchSql(sqlToRun, pendingDdlPatches);
    if (pendingDdlPatches.length > 0) {
      console.log("[VibeDB Deploy] Appending pending DDL patches:", pendingDdlPatches.length);
    }

    return executeDeploySql(sqlToRun);
  };

  const handleOpenSyncReview = () => {
    if (!supabaseBaseline) return;
    const diff = computeSchemaDiff(supabaseBaseline.tables, canvasItems);
    const patchIds = pendingDdlPatches.map(patch => patch.id);

    if (!hasSchemaDiffChanges(diff) && patchIds.length === 0) {
      addToast("Supabase schema is already synced", "success");
      return;
    }

    setSyncDiff(diff);
    setSyncSql(appendDdlPatchSql(hasSchemaDiffChanges(diff) ? generateMigrationSQL(diff) : "", pendingDdlPatches));
    setSyncPatchIds(patchIds);
    setDeployFixResult(null);
    setDeployResults(null);
    setShowSyncReview(true);
  };

  const handleRunSync = async () => {
    if (!supabaseBaseline) {
      addToast("Import a Supabase schema before syncing", "error");
      return;
    }
    if (!syncSql.trim()) {
      addToast("No migration SQL to run", "error");
      return;
    }

    setIsSyncing(true);
    setDeploySetupNeeded(false);
    setDeployResults(null);

    try {
      const result = await executeDeploySql(syncSql);
      if (result.setupNeeded) {
        setDeploySetupNeeded(true);
        setShowSyncReview(false);
        addToast("Setup required - see instructions in the deploy modal", "warning");
        return;
      }

      setDeployResults(result.results);
      if (!result.success) {
        addToast("Sync had errors - see details", "warning");
        return;
      }

      if (syncPatchIds.length > 0) {
        markDdlPatchesApplied(syncPatchIds);
      }

      try {
        const liveTables = await introspectSupabaseSchema({
          url: supabaseBaseline.url,
          anonKey: deployKey,
        });
        const confirmedTables = mergeImportedTablesWithLayout(liveTables, canvasItems);
        setCanvasItems(confirmedTables);
        setSupabaseBaseline({
          url: supabaseBaseline.url,
          importedAt: new Date().toISOString(),
          tables: cloneTables(confirmedTables),
        });
      } catch {
        setSupabaseBaseline({
          url: supabaseBaseline.url,
          importedAt: new Date().toISOString(),
          tables: cloneTables(canvasItems),
        });
        addToast("Sync succeeded, but live schema refresh failed", "warning");
      }

      setShowSyncReview(false);
      setSyncSql("");
      setSyncDiff(null);
      setSyncPatchIds([]);
      addToast("Supabase schema synced", "success");
    } catch (e: unknown) {
      addToast("Sync failed: " + (e instanceof Error ? e.message : "Unknown error"), "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePrimaryDeployAction = () => {
    setDeployFixResult(null);
    if (supabaseBaseline) {
      handleOpenSyncReview();
    } else {
      handleDeploy();
    }
  };

  // ─── Fix Deploy Errors ─────────────────────────────────
  const handleFixDeployErrors = () => {
    // Combine real deploy errors with a fresh canvas-level scan
    // This ensures we catch issues even if Supabase error format changes
    const canvasIssues = preDeployValidateSchema(canvasItems);

    console.log("[VibeDB Fix] handleFixDeployErrors called");
    console.log("[VibeDB Fix] deployResults count:", deployResults?.length ?? 0);
    console.log("[VibeDB Fix] deployResults failed:", deployResults?.filter(r => !r.success).length ?? 0);
    console.log("[VibeDB Fix] canvasIssues count:", canvasIssues.length);
    // Log sample errors for debugging
    deployResults?.filter(r => !r.success).slice(0, 3).forEach((r, i) => {
      console.log(`[VibeDB Fix] Sample deploy error ${i}:`, JSON.stringify(r).substring(0, 300));
    });

    const allErrors = [
      ...(deployResults || []).filter(r => !r.success),
      ...canvasIssues,
    ];

    console.log("[VibeDB Fix] Total allErrors:", allErrors.length);

    if (allErrors.length === 0) {
      addToast("No issues found in schema", "info");
      return;
    }

    const result = diagnoseAndFixSchema(canvasItems, allErrors, view);
    console.log("[VibeDB Fix] Fix result:", { actionCount: result.actions.length, actions: result.actions });

    // Apply fixes to canvas
    setCanvasItems(result.fixedItems);

    // Store fix result for summary display
    setDeployFixResult(result);

    // Clear old deploy results since schema has changed
    setDeployResults(null);

    // Re-run force layout if new tables were added
    const createdTables = result.actions.filter(a => a.type === "create_table");
    if (createdTables.length > 0) {
      setTimeout(() => setCanvasItems(prev => runForceLayout(prev)), 100);
    }

    const fixableCount = result.actions.filter(a => a.type !== "unfixable" && a.type !== "skip_existing").length;
    addToast(
      `Fixed ${fixableCount} issue${fixableCount !== 1 ? "s" : ""}` +
      (result.hasUnfixable ? ` (${result.actions.filter(a => a.type === "unfixable").length} unfixable)` : ""),
      result.hasUnfixable ? "warning" : "success"
    );
  };

  const handleDisconnect = () => {
    setDeployConnected(false);
    setDeployUrl("");
    setDeployKey("");
    setDeployResults(null);
    setDeployFixResult(null);
    localStorage.removeItem("vibedb_deploy_url");
    localStorage.removeItem("vibedb_deploy_key");
    addToast("Disconnected", "info");
  };

  // ─── Import Rows from Supabase ─────────────────────────
  const handleImportRows = async () => {
    if (canvasItems.length === 0 || !deployConnected) return;
    setIsImportingRows(true);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    let totalRows = 0;
    let tablesUpdated = 0;

    try {
      const updatedItems = [...canvasItems];

      for (let i = 0; i < updatedItems.length; i++) {
        const table = updatedItems[i];
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/vibedb-deploy`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              action: "query",
              sql: `SELECT * FROM ${table.name} LIMIT 10000`,
              supabaseUrl: deployUrl,
              serviceRoleKey: deployKey,
            }),
          });
          const data = await res.json();
          if (data.success && data.rows && data.rows.length > 0) {
            updatedItems[i] = { ...table, dataRows: data.rows };
            totalRows += data.rows.length;
            tablesUpdated++;
          }
        } catch {
          // Table might not exist in DB yet — skip silently
        }
      }

      setCanvasItems(updatedItems);
      if (totalRows > 0) {
        addToast(`Imported ${totalRows} rows from ${tablesUpdated} table${tablesUpdated !== 1 ? "s" : ""}`, "success");
      } else {
        addToast("No data found in Supabase tables", "info");
      }
    } catch (e: any) {
      addToast("Import failed: " + (e.message || "Unknown error"), "error");
    } finally {
      setIsImportingRows(false);
    }
  };

  // ─── Auto Layout ──────────────────────────────────────
  const handleAutoLayout = () => {
    if (canvasItems.length === 0) return;
    addToast("Optimizing layout...", "info");
    setTimeout(() => setCanvasItems(runForceLayout(canvasItems)), 50);
  };

  // ─── Smart Inference ──────────────────────────────────
  const handleSmartInference = () => {
    let count = 0;
    const tableMap = new Map<string, string>();
    canvasItems.forEach(t => {
      const name = t.name.toLowerCase();
      tableMap.set(name, t.id);
      tableMap.set(smartPluralize(name), t.id);
      // Also map singularized form (strip trailing s/ies)
      if (name.endsWith("ies")) tableMap.set(name.slice(0, -3) + "y", t.id);
      else if (name.endsWith("s") && !name.endsWith("ss")) tableMap.set(name.slice(0, -1), t.id);
    });
    const updated = canvasItems.map(t => ({
      ...t,
      columns: t.columns.map(col => {
        if (col.isForeignKey && col.fkStatus === "resolved") return col; // skip resolved
        if (!col.name.endsWith("_id")) return col;
        const target = col.name.replace(/_id$/, "").toLowerCase();
        const targetId = tableMap.get(target);
        if (targetId && targetId !== t.id) {
          count++;
          return { ...col, isForeignKey: true, linkedTableId: targetId, linkedTable: canvasItems.find(ct => ct.id === targetId)?.name, linkedColumn: "id", fkStatus: "resolved" };
        }
        return col;
      }),
    }));
    setCanvasItems(updated);
    addToast(`Inferred ${count} relationships`, "success");
  };

  // ─── SQL / CSV Import ─────────────────────────────────
  const handleImport = async () => {
    try {
      let result;

      // If normalize toggle is on and it's not SQL, use AI-powered 3NF normalization
      if (normalizeOnImport && !(/CREATE\s+TABLE/i.test(importText))) {
        addToast("Analyzing CSV for 3NF normalization...", "info");
        setIsCallingAI(true);
        try {
          const normResult = await normalizeCSVData(importText);
          result = normResult;
          if (!result || result.tables.length === 0) throw new Error("Normalization produced no tables");
          setNormalizedSQL(normResult.normalizedSQL);
          skipNormalizedClearRef.current = true; // Prevent useEffect from clearing normalizedSQL
          const totalRows = result.tables.reduce((sum, t) => sum + (t.dataRows?.length || 0), 0);
          addToast(`Normalized into ${result.tables.length} tables (${totalRows} total rows)`, "success");
        } catch (normErr: any) {
          console.error("[Normalize] Failed:", normErr);
          addToast("Normalization failed: " + normErr.message + ". Falling back to flat import.", "warning");
          result = parseCSVData(importText);
        } finally {
          setIsCallingAI(false);
        }
      }
      // Simple heuristic: if it has CREATE TABLE, treat as SQL, else try CSV first
      else if (/CREATE\s+TABLE/i.test(importText)) {
        result = parseSQLDDL(importText);
        // If SQL parsing fails natively, fallback is handled below
      } else {
        try {
          result = parseCSVData(importText);
          if (result.tables.length === 0) throw new Error("No tables found in CSV");
        } catch (csvErr) {
          // CSV failed, maybe it's unstructured
          result = { tables: [] };
        }
      }

      // If both deterministic engines failed to extract a schema, fall back to LLM
      if (!result || !result.tables || result.tables.length === 0) {
        addToast("Format not strictly recognized, attempting AI inference...", "info");
        setIsCallingAI(true);
        try {
          const aiPrompt = `The following text is an unstructured data dump or schema representation. Please generate valid standard PostgreSQL CREATE TABLE statements that best represent this data, inferring column types, primary keys (UUID if missing), and foreign key references based on the context. Only output the SQL DDL.\n\nInput Data:\n${importText.substring(0, 3000)}`;
          const aiSQL = await callAI("schema", aiPrompt);
          if (!aiSQL) {
            addToast("AI inference failed to generate schema.", "error");
            return;
          }
          result = parseSQLDDL(aiSQL);
          if (result.tables.length === 0) {
            addToast("No tables found after AI inference.", "error");
            return;
          }
        } finally {
          setIsCallingAI(false);
        }
      }

      const processed = result.tables.map((t, i) => ({
        ...t, x: (-view.x / view.zoom) + 100 + (i % 3) * 300, y: (-view.y / view.zoom) + 100 + Math.floor(i / 3) * 300,
      })) as TableNode[];
      const allTables = [...canvasItems, ...processed];
      const tableMap = new Map<string, string>();
      allTables.forEach(t => tableMap.set(t.name.toLowerCase(), t.id));
      const resolved = processed.map(t => ({
        ...t,
        columns: t.columns.map(col => {
          if (col.isForeignKey && col.linkedTable) {
            const targetId = tableMap.get(col.linkedTable.toLowerCase());
            return { ...col, linkedTableId: targetId, fkStatus: targetId ? "resolved" : "unresolved" };
          }
          return col;
        }),
      }));
      setCanvasItems(prev => [...prev, ...resolved]);
      setShowImportModal(false); setImportText(""); setNormalizeOnImport(false);
      addToast(`Imported ${result.tables.length} table${result.tables.length > 1 ? "s" : ""}`, "success");
    } catch (err: any) { addToast("Import failed: " + err.message, "error"); }
  };

  // ─── Schema Audit ─────────────────────────────────────
  const handleAudit = async () => {
    if (canvasItems.length === 0) { addToast("Add tables first", "error"); return; }
    setShowAuditModal(true); setIsAuditing(true); setAuditReport(null); setAuditPhase("Analyzing schema...");
    try {
      // Compile schema before auditing so AI sees post-compiler state
      // and won't suggest fixes the compiler already handles
      const { tables: compiledForAudit } = runCompilerPass(canvasItems);

      const lintIssues = lintSchema(compiledForAudit);
      const fkIssues: { type: string; severity: string; message: string }[] = [];
      compiledForAudit.forEach(table => {
        table.columns.forEach(col => {
          if (col.isForeignKey && col.fkStatus !== "resolved")
            fkIssues.push({ type: "fk", severity: "error", message: `Unresolved FK: ${table.name}.${col.name} → ${col.linkedTable}` });
        });
      });
      // Build compact schema context to avoid token limits
      const compactSchema = compiledForAudit.map(t => {
        const cols = t.columns.map(c => {
          let s = `${c.name}:${c.type}`;
          if (c.constraints?.some(x => x.type === "primary")) s += " PK";
          if (c.constraints?.some(x => x.type === "notNull")) s += " NN";
          if (c.constraints?.some(x => x.type === "unique")) s += " UQ";
          if (c.isForeignKey && c.linkedTable) s += ` FK->${c.linkedTable}.${c.linkedColumn || "id"}`;
          return s;
        }).join(", ");
        const idxStr = t.indexes && t.indexes.length > 0
          ? ` | IDX: ${t.indexes.map(idx => `${idx.name}(${idx.columns.join(",")})${idx.unique ? " UQ" : ""}`).join("; ")}`
          : "";
        return `${t.name}(${cols})${idxStr}`;
      }).join("\n");
      const contextStr = `Tables:\n${compactSchema}${lintIssues.length > 0 ? `\n\nLint issues:\n${lintIssues.map(i => i.message).join("\n")}` : ""}${fkIssues.length > 0 ? `\n\nFK issues:\n${fkIssues.map(i => i.message).join("\n")}` : ""}`;

      // Initial AI call (using callAIRaw for truncation detection)
      const response = await callAIRaw("inspect-schema", "Inspect this schema thoroughly", contextStr);
      let result: any;
      try {
        result = robustJsonParse(response.result);
      } catch {
        result = extractPartialAuditResult(response.result);
      }

      // Reactive chaining if truncated
      if (response.truncated) {
        console.log("[VibeDB] Audit response truncated, starting continuation chain...");
        // Strip the "truncated" info messages — chaining will fill the gaps
        if (result.issues) {
          result.issues = result.issues.filter((i: any) => !i.message?.includes("truncated"));
        }
        result = await runAuditChain(contextStr, result, setAuditPhase);
      }

      setAuditPhase("Finalizing results...");
      setAuditReport({ ...result, lintIssues, fkIssues });
    } catch (err: any) { addToast(err?.message || "Audit failed", "error"); setAuditReport({ lintIssues: [], fkIssues: [], issues: [{ severity: "error", message: err?.message || "Failed to run AI audit" }] }); }
    finally { setIsAuditing(false); setAuditPhase(""); }
  };

  const handleDeduplicate = () => {
    if (canvasItems.length === 0) { addToast("No tables to deduplicate", "info"); return; }
    const { fixedItems, duplicateIndexesRemoved, duplicateColumnsRemoved } = deduplicateSchema(canvasItems);
    const total = duplicateIndexesRemoved + duplicateColumnsRemoved;
    if (total === 0) { addToast("No duplicates found", "info"); return; }
    setCanvasItems(fixedItems);
    const parts: string[] = [];
    if (duplicateIndexesRemoved > 0) parts.push(`${duplicateIndexesRemoved} duplicate index${duplicateIndexesRemoved !== 1 ? "es" : ""}`);
    if (duplicateColumnsRemoved > 0) parts.push(`${duplicateColumnsRemoved} duplicate column${duplicateColumnsRemoved !== 1 ? "s" : ""}`);
    addToast(`Removed ${parts.join(" and ")}`, "success");
  };

  // Pure function: applies a single suggestion to a tables array, returns the new tables array.
  // Used by both handleApplySuggestion (single) and handleApplyAllSuggestions (batch).
  const applySuggestionToTables = (tables: TableNode[], suggestion: any): TableNode[] => {
    const targetTable = suggestion.target_table || suggestion.targetTable || suggestion.payload?.targetTable || "";
    const payload = suggestion.payload || {};

    switch (suggestion.type) {
      case "add_column": {
        const colData = payload.columns ? payload.columns[0] : payload;
        const colName = String(colData?.name || payload.name || "new_column");
        const colType = String(colData?.type || payload.type || "varchar");
        const isFK = !!(colData?.isForeignKey);
        return tables.map(t => {
          if (t.name.toLowerCase() !== targetTable.toLowerCase()) return t;
          return { ...t, columns: [...t.columns, { id: uuidv4(), name: colName, type: colType, fkStatus: isFK ? "unresolved" : "resolved", constraints: colData?.constraints || [], isForeignKey: isFK, linkedTable: colData?.linkedTable || "", linkedColumn: colData?.linkedColumn || "" }] };
        });
      }
      case "add_table": {
        const tableName = payload.name || payload.table?.name || "new_table";
        const cols = payload.columns || payload.table?.columns || [];
        const newTable: TableNode = {
          id: uuidv4(), name: tableName,
          x: (-view.x / view.zoom) + 200 + Math.random() * 200, y: (-view.y / view.zoom) + 200 + Math.random() * 200,
          columns: cols.map((c: any) => ({
            ...c, id: uuidv4(), constraints: c.constraints || [],
            isForeignKey: !!c.isForeignKey,
            fkStatus: c.isForeignKey ? "unresolved" : "resolved",
          })),
        };
        // Resolve FK links bidirectionally against the current table set
        return resolveCanvasFKsBidirectional(tables, [newTable]);
      }
      case "add_index": {
        const idxCols = payload.columns || [];
        const chatTargetT = tables.find(t => t.name.toLowerCase() === targetTable.toLowerCase());
        if (findDuplicateIndex(chatTargetT?.indexes, idxCols)) return tables;
        return tables.map(t => {
          if (t.name.toLowerCase() !== targetTable.toLowerCase()) return t;
          return { ...t, indexes: [...(t.indexes || []), { name: payload.name || `idx_${t.name}_${idxCols.join("_")}`, columns: idxCols, type: "btree", unique: payload.unique || false }] };
        });
      }
      case "rename_table": {
        const newName = payload.newName || suggestion.newName || "";
        if (!newName) return tables;
        return tables.map(t => ({
          ...t,
          name: t.name.toLowerCase() === targetTable.toLowerCase() ? newName : t.name,
          columns: t.columns.map(c => c.linkedTable?.toLowerCase() === targetTable.toLowerCase() ? { ...c, linkedTable: newName } : c),
        }));
      }
      case "rename_column": {
        const targetCol = payload.targetColumn || payload.column || "";
        const newColName = payload.newName || "";
        if (!targetCol || !newColName) return tables;
        return tables.map(t => {
          if (t.name.toLowerCase() !== targetTable.toLowerCase()) return t;
          return {
            ...t,
            columns: t.columns.map(c => c.name.toLowerCase() === targetCol.toLowerCase() ? { ...c, name: newColName } : c),
            dataRows: t.dataRows?.map(row => {
              if (!(targetCol in row)) return row;
              const { [targetCol]: val, ...rest } = row;
              return { ...rest, [newColName]: val };
            }),
          };
        });
      }
      case "change_type": {
        const col = payload.targetColumn || payload.column || "";
        const newType = payload.newType || "";
        if (!col || !newType) return tables;
        return tables.map(t => {
          if (t.name.toLowerCase() !== targetTable.toLowerCase()) return t;
          return { ...t, columns: t.columns.map(c => c.name.toLowerCase() === col.toLowerCase() ? { ...c, type: newType } : c) };
        });
      }
      case "add_fk": {
        const fkCol = payload.column || "";
        const refTable = payload.referencesTable || "";
        if (!fkCol || !refTable) return tables;
        const refTableNode = tables.find(t => t.name.toLowerCase() === refTable.toLowerCase());
        return tables.map(t => {
          if (t.name.toLowerCase() !== targetTable.toLowerCase()) return t;
          return { ...t, columns: t.columns.map(c => c.name.toLowerCase() === fkCol.toLowerCase() ? { ...c, isForeignKey: true, linkedTable: refTable, linkedTableId: refTableNode?.id, linkedColumn: payload.referencesColumn || "id", fkStatus: refTableNode ? "resolved" : "unresolved" } : c) };
        });
      }
      case "remove_column": {
        const rmCol = payload.column || "";
        if (!rmCol) return tables;
        return tables.map(t => {
          if (t.name.toLowerCase() !== targetTable.toLowerCase()) return t;
          return { ...t, columns: t.columns.filter(c => c.name.toLowerCase() !== rmCol.toLowerCase()) };
        });
      }
      case "remove_table":
        return tables.filter(t => t.name.toLowerCase() !== targetTable.toLowerCase());
      case "add_constraint": {
        const chkName = payload.name || `chk_${targetTable}`;
        const chkExpr = payload.expression || "";
        if (!chkExpr) return tables;
        return tables.map(t => {
          if (t.name.toLowerCase() !== targetTable.toLowerCase()) return t;
          return { ...t, checkConstraints: [...(t.checkConstraints || []), { name: chkName, expression: chkExpr }] };
        });
      }
      default:
        console.warn("[VibeDB] unhandled suggestion type:", suggestion.type);
        return tables;
    }
  };

  const handleApplySuggestion = (suggestion: any, silent = false) => {
    try {
      const payload = suggestion.payload || {};

      // Handle non-table mutations separately
      if (suggestion.type === "add_enum") {
        const enumName = payload.name || "";
        const enumValues = payload.values || [];
        if (!enumName || !enumValues.length) { if (!silent) addToast("Missing enum name or values", "warning"); return; }
        setSchemaEnums(prev => {
          if (prev.some(e => e.name.toLowerCase() === enumName.toLowerCase())) return prev;
          return [...prev, { name: enumName, values: enumValues }];
        });
        if (!silent) addToast(`Added enum type ${enumName}`, "success");
      } else if (suggestion.type === "add_function") {
        const fnName = payload.name || "";
        const fnBody = payload.body || "";
        if (!fnBody) { if (!silent) addToast("Missing function body", "warning"); return; }
        setSchemaFunctions(prev => {
          if (prev.some(f => f.name.toLowerCase() === fnName.toLowerCase())) return prev;
          return [...prev, { name: fnName, body: fnBody }];
        });
        if (!silent) addToast(`Added function ${fnName}`, "success");
      } else if (suggestion.type === "ddl_patch" || suggestion.type === "sql_patch") {
        const sql = payload.sql || payload.body || payload.ddl || "";
        const created = addDdlPatch({
          title: payload.title || suggestion.description || suggestion.reason || "DDL patch",
          description: payload.description || suggestion.reason,
          sql,
          source: "ai-chat",
        });
        if (created && !silent) addToast(`Added "${created.title}" — included in exported SQL`, "success");
      } else {
        // Table mutation — use the pure function, then handshake + compile
        let compilerFixCount = 0;
        setCanvasItems(prev => {
          const mutated = applySuggestionToTables(prev, suggestion);
          const resolved = resolveCanvasFKsBidirectional([], mutated);
          const { tables: compiled, report } = runCompilerPass(resolved);
          compilerFixCount = report.actions.length;
          setCompilerReport(report);
          return compiled;
        });
        if (!silent) {
          const compilerMsg = compilerFixCount > 0 ? ` · Compiler: ${compilerFixCount} auto-fix${compilerFixCount !== 1 ? "es" : ""}` : "";
          addToast(`Applied: ${suggestion.reason || suggestion.description || suggestion.type}${compilerMsg}`, "success");
        }
      }
      setAuditReport(prev => prev ? { ...prev, suggestions: prev.suggestions?.filter(s => s !== suggestion) } : prev);
    } catch { if (!silent) addToast("Failed to apply suggestion", "error"); }
  };

  const handleApplyAllSuggestions = () => {
    if (!auditReport?.suggestions) return;
    const suggestions = auditReport.suggestions;
    const count = suggestions.length;

    // Single atomic update for all table mutations: apply → handshake → compile
    let compilerFixCount = 0;
    setCanvasItems(prev => {
      let tables = prev;
      for (const s of suggestions) {
        if (s.type !== "add_enum" && s.type !== "add_function" && s.type !== "ddl_patch" && s.type !== "sql_patch") {
          tables = applySuggestionToTables(tables, s);
        }
      }
      // Atomic handshake + compile: resolve all FK links, then enforce all compiler invariants
      const resolved = resolveCanvasFKsBidirectional([], tables);
      const { tables: compiled, report } = runCompilerPass(resolved);
      compilerFixCount = report.actions.length;
      setCompilerReport(report);
      return compiled;
    });

    // Apply non-table mutations
    const enumSuggestions = suggestions.filter(s => s.type === "add_enum");
    const fnSuggestions = suggestions.filter(s => s.type === "add_function");
    const ddlPatchSuggestions = suggestions.filter(s => s.type === "ddl_patch" || s.type === "sql_patch");
    if (enumSuggestions.length) {
      setSchemaEnums(prev => {
        let enums = [...prev];
        for (const s of enumSuggestions) {
          const p = s.payload || {};
          if (p.name && p.values?.length && !enums.some(e => e.name.toLowerCase() === p.name.toLowerCase())) {
            enums = [...enums, { name: p.name, values: p.values }];
          }
        }
        return enums;
      });
    }
    if (fnSuggestions.length) {
      setSchemaFunctions(prev => {
        let fns = [...prev];
        for (const s of fnSuggestions) {
          const p = s.payload || {};
          if (p.body && !fns.some(f => f.name.toLowerCase() === (p.name || "").toLowerCase())) {
            fns = [...fns, { name: p.name || "", body: p.body }];
          }
        }
        return fns;
      });
    }
    for (const s of ddlPatchSuggestions) {
      const p = s.payload || {};
      addDdlPatch({
        title: p.title || s.description || s.reason || "DDL patch",
        description: p.description || s.reason,
        sql: p.sql || p.body || p.ddl || "",
        source: "ai-chat",
      });
    }

    setAuditReport(prev => prev ? { ...prev, suggestions: [] } : prev);
    const compilerMsg = compilerFixCount > 0 ? ` · Compiler: ${compilerFixCount} auto-fix${compilerFixCount !== 1 ? "es" : ""}` : "";
    addToast(`Applied all ${count} suggestions${compilerMsg}`, "success");
  };

  // ─── Batch Edit ───────────────────────────────────────
  const handleBatchCommand = async () => {
    if (!batchPrompt) return;
    setIsBatchProcessing(true); setBatchError(null);
    try {
      // Send compact schema (not full JSON with IDs)
      const compactSchema = canvasItems.map(t => {
        const cols = t.columns.map(c => {
          let s = `${c.name}:${c.type}`;
          if (c.constraints?.some(x => x.type === "primary")) s += " PK";
          if (c.constraints?.some(x => x.type === "notNull")) s += " NN";
          if (c.isForeignKey && c.linkedTable) s += ` FK->${c.linkedTable}`;
          return s;
        }).join(", ");
        return `${t.name}(${cols})`;
      }).join("\n");

      const resultStr = await callAI("batch-command", batchPrompt, compactSchema);
      const result = robustJsonParse(resultStr);
      const ddlPatchResults = (result?.ddlPatches || result?.ddl_patches || result?.patches || []) as Array<Record<string, unknown>>;
      const changes = [
        ...(result?.changes || []),
        ...ddlPatchResults.map((patch) => ({ ...patch, action: typeof patch.action === "string" ? patch.action : "ddl_patch" })),
        ...(result?.sql ? [{ action: "ddl_patch", title: result.title, description: result.description, sql: result.sql }] : []),
      ];
      if (!changes.length) { setBatchError("No changes returned. Try rephrasing your command."); return; }

      // Collect non-table mutations to apply after the single setCanvasItems call
      const pendingEnums: { name: string; values: string[] }[] = [];
      const pendingFunctions: { name: string; body: string }[] = [];
      const pendingDdlPatchInputs: { title?: string; description?: string; sql: string }[] = [];

      // Single atomic state update — all table mutations happen against the moving `tables` variable
      let applied = 0;
      setCanvasItems((prev: TableNode[]) => {
        let tables = [...prev];

        for (const c of changes) {
          try {
            const action = c.action;
            const target = (c.targetTable || "").toLowerCase();
            switch (action) {
              case "add_column": {
                const col = c.column || {};
                const colIsFK = !!col.isForeignKey;
                tables = tables.map(t => {
                  if (t.name.toLowerCase() !== target) return t;
                  return { ...t, columns: [...t.columns, { id: uuidv4(), name: col.name || "new_col", type: col.type || "varchar", fkStatus: colIsFK ? "unresolved" : "resolved", constraints: col.constraints || [], isForeignKey: colIsFK, linkedTable: col.linkedTable || "", linkedColumn: col.linkedColumn || "" }] };
                });
                applied++;
                break;
              }
              case "remove_column": {
                const colName = (c.column || "").toLowerCase();
                tables = tables.map(t => {
                  if (t.name.toLowerCase() !== target) return t;
                  return { ...t, columns: t.columns.filter(col => col.name.toLowerCase() !== colName) };
                });
                applied++;
                break;
              }
              case "rename_column": {
                tables = tables.map(t => {
                  if (t.name.toLowerCase() !== target) return t;
                  return { ...t, columns: t.columns.map(col => col.name.toLowerCase() === (c.targetColumn || "").toLowerCase() ? { ...col, name: c.newName } : col) };
                });
                applied++;
                break;
              }
              case "change_type": {
                tables = tables.map(t => {
                  if (t.name.toLowerCase() !== target) return t;
                  return { ...t, columns: t.columns.map(col => col.name.toLowerCase() === (c.targetColumn || "").toLowerCase() ? { ...col, type: c.newType } : col) };
                });
                applied++;
                break;
              }
              case "add_table": {
                const tbl = c.table || {};
                const newTable: TableNode = {
                  id: uuidv4(), name: tbl.name || "new_table",
                  x: (-view.x / view.zoom) + 200 + Math.random() * 300, y: (-view.y / view.zoom) + 200 + Math.random() * 300,
                  columns: (tbl.columns || []).map((col: any) => ({ id: uuidv4(), name: col.name, type: col.type || "varchar", fkStatus: col.isForeignKey ? "unresolved" : "resolved", constraints: col.constraints || [], isForeignKey: !!col.isForeignKey, linkedTable: col.linkedTable || "", linkedColumn: col.linkedColumn || "" })),
                };
                tables = [...tables, newTable];
                applied++;
                break;
              }
              case "remove_table": {
                tables = tables.filter(t => t.name.toLowerCase() !== target);
                applied++;
                break;
              }
              case "rename_table": {
                tables = tables.map(t => ({
                  ...t,
                  name: t.name.toLowerCase() === target ? c.newName : t.name,
                  columns: t.columns.map(col => col.linkedTable?.toLowerCase() === target ? { ...col, linkedTable: c.newName } : col),
                }));
                applied++;
                break;
              }
              case "add_fk": {
                const refNode = tables.find(t => t.name.toLowerCase() === (c.referencesTable || "").toLowerCase());
                tables = tables.map(t => {
                  if (t.name.toLowerCase() !== target) return t;
                  return { ...t, columns: t.columns.map(col => col.name.toLowerCase() === (c.column || "").toLowerCase() ? { ...col, isForeignKey: true, linkedTable: c.referencesTable, linkedTableId: refNode?.id, linkedColumn: c.referencesColumn || "id", fkStatus: refNode ? "resolved" : "unresolved" } : col) };
                });
                applied++;
                break;
              }
              case "add_index": {
                const batchIdxCols = c.columns || [];
                const batchTargetT = tables.find(t => t.name.toLowerCase() === target);
                if (findDuplicateIndex(batchTargetT?.indexes, batchIdxCols)) break;
                tables = tables.map(t => {
                  if (t.name.toLowerCase() !== target) return t;
                  return { ...t, indexes: [...(t.indexes || []), { name: c.name || `idx_${t.name}_${batchIdxCols.join("_")}`, columns: batchIdxCols, type: "btree", unique: c.unique || false }] };
                });
                applied++;
                break;
              }
              case "add_constraint": {
                const constraintName = c.name || `chk_${target}_${applied}`;
                const expression = c.expression || "";
                if (!expression) break;
                tables = tables.map(t => {
                  if (t.name.toLowerCase() !== target) return t;
                  return { ...t, checkConstraints: [...(t.checkConstraints || []), { name: constraintName, expression }] };
                });
                applied++;
                break;
              }
              case "add_enum": {
                const enumName = c.name || "";
                const enumValues = c.values || [];
                if (enumName && enumValues.length) { pendingEnums.push({ name: enumName, values: enumValues }); applied++; }
                break;
              }
              case "add_function": {
                const fnName = c.name || `fn_${applied}`;
                const fnBody = c.body || "";
                if (fnBody) { pendingFunctions.push({ name: fnName, body: fnBody }); applied++; }
                break;
              }
              case "ddl_patch":
              case "sql_patch": {
                const sql = c.sql || c.body || c.ddl || "";
                if (sql) {
                  pendingDdlPatchInputs.push({
                    title: c.title || c.name || "DDL patch",
                    description: c.description || c.reason || batchPrompt,
                    sql,
                  });
                  applied++;
                }
                break;
              }
            }
          } catch { /* skip failed individual change */ }
        }

        // Atomic handshake: resolve all FK links across the entire batch
        return resolveCanvasFKsBidirectional([], tables);
      });

      // Apply non-table state mutations
      if (pendingEnums.length) {
        setSchemaEnums(prev => {
          let enums = [...prev];
          for (const e of pendingEnums) {
            if (!enums.some(ex => ex.name.toLowerCase() === e.name.toLowerCase())) enums = [...enums, e];
          }
          return enums;
        });
      }
      if (pendingFunctions.length) {
        setSchemaFunctions(prev => {
          let fns = [...prev];
          for (const f of pendingFunctions) {
            if (!fns.some(ex => ex.name.toLowerCase() === f.name.toLowerCase())) fns = [...fns, f];
          }
          return fns;
        });
      }
      if (pendingDdlPatchInputs.length) {
        for (const patch of pendingDdlPatchInputs) {
          addDdlPatch({ ...patch, source: "batch-edit" });
        }
      }

      addToast(`Batch edit: ${applied} change${applied !== 1 ? "s" : ""} applied`, "success");
      setShowBatchModal(false); setBatchPrompt("");
    } catch (e: any) {
      setBatchError(e.message || "Batch processing failed");
    } finally { setIsBatchProcessing(false); }
  };

  // ─── AI Add Table ─────────────────────────────────────
  const handleAiAddTable = async () => {
    if (!aiTablePrompt.trim()) return;
    setIsAddingAiTable(true);
    try {
      const existingTables = canvasItems.map(t => t.name).join(", ");
      const resultStr = await callAI("generate-schema", `Existing tables: [${existingTables}]. Generate 1 new table for: "${aiTablePrompt}". Return JSON with "tables" key containing exactly 1 table.`);
      const result = robustJsonParse(resultStr);
      if (result?.tables?.[0]) {
        const t = result.tables[0];
        const newTable: TableNode = {
          ...t, id: uuidv4(), x: (-view.x / view.zoom) + 200, y: (-view.y / view.zoom) + 200,
          columns: (t.columns || []).map((c: any) => ({ ...c, id: uuidv4(), fkStatus: "resolved", constraints: c.constraints || [] })),
        };
        setCanvasItems(prev => [...prev, newTable]);
        addToast(`Generated table: ${newTable.name}`, "success");
        setAiTablePrompt(""); setShowAddTableMenu(false);
      }
    } catch { addToast("Failed to generate table", "error"); }
    finally { setIsAddingAiTable(false); }
  };

  // ─── Mock Data ────────────────────────────────────────
  const handleGenerateMockData = async () => {
    if (canvasItems.length === 0) { addToast("Add tables to canvas first", "error"); return; }
    // Abort any previous request
    mockDataAbortRef.current?.abort();
    const controller = new AbortController();
    mockDataAbortRef.current = controller;

    setIsGeneratingMockData(true); setShowMockDataModal(true); setMockDataSql("");
    try {
      const schemaSummary = canvasItems.map(t => {
        const cols = t.columns.map(c => {
          let s = `${c.name}:${c.type}`;
          if (c.constraints?.some(x => x.type === "primary")) s += " PK";
          if (c.constraints?.some(x => x.type === "notNull")) s += " NN";
          if (c.isForeignKey && c.linkedTable) s += ` FK->${c.linkedTable}`;
          return s;
        }).join(", ");
        return `${t.name}(${cols})`;
      }).join("\n");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/vibedb-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
        body: JSON.stringify({ type: "generate-mock-data", prompt: "", context: schemaSummary }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `AI service error (${res.status})`);
      let result = data?.result || "";
      result = result.replace(/```sql\n?/g, "").replace(/```\n?/g, "").trim();
      setMockDataSql(result);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setMockDataSql("-- Generation cancelled --");
      } else {
        addToast(err?.message || "Failed to generate mock data", "error");
        setMockDataSql(`-- ${err?.message || "Error generating data"} --`);
      }
    }
    finally { setIsGeneratingMockData(false); mockDataAbortRef.current = null; }
  };

  const handleCancelMockData = () => {
    mockDataAbortRef.current?.abort();
  };

  // ─── Schema Diff ──────────────────────────────────────
  const saveSnapshot = () => { setDiffBase(JSON.parse(JSON.stringify(canvasItems))); addToast("Snapshot saved for comparison", "success"); };
  const computeDiff = () => {
    if (!diffBase) return null;
    const changes: { type: string; target: string; details: string; breaking?: boolean }[] = [];
    canvasItems.forEach(table => {
      const old = diffBase.find(t => t.id === table.id);
      if (!old) { changes.push({ type: "added", target: table.name, details: "New table" }); }
      else {
        table.columns.forEach(col => {
          const oldCol = old.columns.find(c => c.id === col.id);
          if (!oldCol) changes.push({ type: "added", target: `${table.name}.${col.name}`, details: "New column" });
          else if (JSON.stringify(oldCol) !== JSON.stringify(col)) changes.push({ type: "modified", target: `${table.name}.${col.name}`, details: "Column modified" });
        });
        old.columns.forEach(col => {
          if (!table.columns.find(c => c.id === col.id)) changes.push({ type: "removed", target: `${table.name}.${col.name}`, details: "Column removed", breaking: true });
        });
      }
    });
    diffBase.forEach(old => { if (!canvasItems.find(t => t.id === old.id)) changes.push({ type: "removed", target: old.name, details: "Table removed", breaking: true }); });
    return changes;
  };

  // ─── Query Playground ─────────────────────────────────
  const handleGenerateQuery = async () => {
    if (!queryPrompt) return;
    setIsQuerying(true);
    const ctx = canvasItems.map(t => `${t.name}(${t.columns.map(c => `${c.name}:${c.type}`).join(", ")})`).join("\n");
    try { const result = await callAI("generate-query", queryPrompt, ctx); setGeneratedQuery(result); }
    catch { addToast("Failed to generate query", "error"); }
    finally { setIsQuerying(false); }
  };

  // ─── Connection mode ──────────────────────────────────
  const startConnection = (tableId: string, columnId: string) => {
    setConnectionMode({ sourceTableId: tableId, sourceColumnId: columnId });
    addToast("Select target column to link", "info");
  };

  const completeConnection = (targetTableId: string, targetColumnId: string) => {
    if (!connectionMode) return;
    if (connectionMode.sourceTableId === targetTableId) { addToast("Cannot link to same table", "error"); setConnectionMode(null); return; }
    const targetTable = canvasItems.find(t => t.id === targetTableId);
    const targetCol = targetTable?.columns.find(c => c.id === targetColumnId);
    setCanvasItems(items => items.map(t => {
      if (t.id !== connectionMode.sourceTableId) return t;
      return {
        ...t,
        columns: t.columns.map(c => {
          if (c.id !== connectionMode.sourceColumnId) return c;
          return { ...c, isForeignKey: true, linkedTableId: targetTableId, linkedTable: targetTable?.name, linkedColumn: targetCol?.name || "id", fkStatus: "resolved" };
        }),
      };
    }));
    setConnectionMode(null);
    addToast("Foreign key created", "success");
  };

  // ─── Table Operations ─────────────────────────────────
  const addManualTable = () => {
    const newTable: TableNode = {
      id: uuidv4(), name: `table_${canvasItems.length + 1}`,
      x: -view.x / view.zoom + 200, y: -view.y / view.zoom + 200,
      columns: [
        { id: uuidv4(), name: "id", type: "uuid", constraints: [{ type: "primary" }], fkStatus: "resolved" },
        { id: uuidv4(), name: "created_at", type: "timestamptz", constraints: [{ type: "notNull" }], fkStatus: "resolved" },
      ],
    };
    setCanvasItems(prev => [...prev, newTable]);
    setShowAddTableMenu(false);
  };

  const deleteTable = (id: string) => {
    const item = canvasItems.find(t => t.id === id);
    if (item) {
      setCanvasItems(prev => prev.filter(t => t.id !== id));
      setSidebarItems(prev => [...prev, item]);
    }
  };
  const updateTableName = (id: string, name: string) => {
    setCanvasItems(prev => prev.map(t => ({
      ...t,
      name: t.id === id ? name : t.name,
      columns: t.columns.map(c => c.linkedTableId === id ? { ...c, linkedTable: name } : c),
    })));
  };
  const addColumn = (tableId: string) => setCanvasItems(prev => prev.map(t =>
    t.id === tableId ? { ...t, columns: [...t.columns, { id: uuidv4(), name: "new_col", type: "varchar", fkStatus: "resolved", constraints: [] }] } : t
  ));
  const updateColumn = (tableId: string, columnId: string, updates: Partial<Column>) => setCanvasItems(prev => prev.map(t =>
    t.id === tableId ? { ...t, columns: t.columns.map(c => c.id === columnId ? { ...c, ...updates } : c) } : t
  ));
  const deleteColumn = (tableId: string, colId: string) => setCanvasItems(prev => prev.map(t =>
    t.id === tableId ? { ...t, columns: t.columns.filter(c => c.id !== colId) } : t
  ));

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); addToast("Copied!", "success"); setTimeout(() => setCopied(false), 2000); }
    catch { addToast("Failed to copy", "error"); }
  };

  // ─── Canvas interaction ───────────────────────────────
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-table]")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startView = { ...view };
    const handleMove = (ev: MouseEvent) => {
      setView({ x: startView.x + (ev.clientX - startX), y: startView.y + (ev.clientY - startY), zoom: startView.zoom });
    };
    const handleUp = () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const handleTableMouseDown = (e: React.MouseEvent, tableId: string) => {
    e.stopPropagation();
    const table = canvasItems.find(t => t.id === tableId);
    if (!table) return;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const tableScreenX = table.x * view.zoom + view.x;
    const tableScreenY = table.y * view.zoom + view.y;
    setDraggingTable(tableId);
    setDragOffset({ x: e.clientX - canvasRect.left - tableScreenX, y: e.clientY - canvasRect.top - tableScreenY });
  };

  useEffect(() => {
    if (!draggingTable) return;
    const handleMove = (e: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const newX = (e.clientX - canvasRect.left - dragOffset.x - view.x) / view.zoom;
      const newY = (e.clientY - canvasRect.top - dragOffset.y - view.y) / view.zoom;
      setCanvasItems(prev => prev.map(t => t.id === draggingTable ? { ...t, x: newX, y: newY } : t));
    };
    const handleUp = () => setDraggingTable(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [draggingTable, dragOffset, view]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    const pointerX = rect ? e.clientX - rect.left : 0;
    const pointerY = rect ? e.clientY - rect.top : 0;
    const normalizedDelta = e.deltaY * (
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_HEIGHT
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? WHEEL_PAGE_HEIGHT
          : 1
    );
    const zoomFactor = Math.max(
      1 - MAX_CANVAS_ZOOM_STEP,
      Math.min(1 + MAX_CANVAS_ZOOM_STEP, Math.exp(-normalizedDelta * CANVAS_ZOOM_SENSITIVITY))
    );

    setView(v => {
      const nextZoom = Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, v.zoom * zoomFactor));
      if (!rect || nextZoom === v.zoom) return { ...v, zoom: nextZoom };

      const worldX = (pointerX - v.x) / v.zoom;
      const worldY = (pointerY - v.y) / v.zoom;

      return {
        x: pointerX - worldX * nextZoom,
        y: pointerY - worldY * nextZoom,
        zoom: nextZoom,
      };
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const tableId = e.dataTransfer.getData("tableId");
    if (tableId) addItemToCanvas(tableId, e.clientX, e.clientY);
  };

  // ─── Render FK lines ──────────────────────────────────
  const connectionPaths = useMemo(() => {
    // Centre of the whole layout — used to bulge stacked-table arcs outward.
    const layoutCenterX = canvasItems.length
      ? canvasItems.reduce((s, t) => s + t.x + TABLE_WIDTH / 2, 0) / canvasItems.length
      : 0;
    return canvasItems.flatMap((sourceTable) =>
      sourceTable.columns.map((col, idx) => {
        if (!col.isForeignKey || (!col.linkedTableId && !col.linkedTable)) return null;
        const targetTable = canvasItems.find(t => t.id === col.linkedTableId || t.name === col.linkedTable || t.name?.toLowerCase() === col.linkedTable?.toLowerCase());
        if (!targetTable) return null;

        const isRelated = hoveredTableId && (sourceTable.id === hoveredTableId || targetTable.id === hoveredTableId);
        const isSelected = connectionMode?.sourceTableId === sourceTable.id && connectionMode?.sourceColumnId === col.id;
        let stroke = col.fkStatus === "resolved" ? "hsl(var(--accent))" : "hsl(var(--destructive))";
        let opacity = 0.9;
        let width = 2.5;
        if (hoveredTableId) {
          if (isRelated) { opacity = 1; width = 3.5; } else { opacity = 0.15; }
        }
        if (isSelected) { stroke = "hsl(45, 93%, 47%)"; opacity = 1; width = 3.5; }

        const sourceRowY = sourceTable.y + HEADER_HEIGHT + (idx * ROW_HEIGHT) + (ROW_HEIGHT / 2);
        let targetRowIndex = targetTable.columns.findIndex(c => c.name === col.linkedColumn);
        if (targetRowIndex === -1) targetRowIndex = 0;
        const targetRowY = targetTable.y + HEADER_HEIGHT + (targetRowIndex * ROW_HEIGHT) + (ROW_HEIGHT / 2);

        const sourceLeft = sourceTable.x, sourceRight = sourceTable.x + TABLE_WIDTH;
        const targetLeft = targetTable.x, targetRight = targetTable.x + TABLE_WIDTH;
        const sourceCenter = sourceLeft + TABLE_WIDTH / 2;
        const targetCenter = targetLeft + TABLE_WIDTH / 2;

        // Anchor on the sides that face each other; the control-handle length is
        // proportional to the real anchor distance (clamped), so closely-connected
        // tables get a small, smooth curve and only distant ones arc more.
        // startSide/endSide: +1 = right edge, -1 = left edge.
        let startSide: number, endSide: number, startX: number, endX: number, cp1X: number, cp2X: number;
        if (sourceTable.id === targetTable.id) {
          // Self-reference: the only case that loops — a small arc off the right side.
          startSide = 1; endSide = 1;
          startX = sourceRight; endX = sourceRight;
          const loop = 60;
          cp1X = startX + loop; cp2X = endX + loop;
        } else {
          const goesRight = targetCenter >= sourceCenter;
          startSide = goesRight ? 1 : -1;
          endSide = goesRight ? -1 : 1;
          startX = goesRight ? sourceRight : sourceLeft;
          endX = goesRight ? targetLeft : targetRight;
          const dist = Math.hypot(targetCenter - sourceCenter, targetRowY - sourceRowY);
          const h = Math.min(Math.max(dist * 0.35, 24), 160);
          cp1X = startX + startSide * h;
          cp2X = endX + endSide * h;
        }
        const pathD = `M ${startX} ${sourceRowY} C ${cp1X} ${sourceRowY}, ${cp2X} ${targetRowY}, ${endX} ${targetRowY}`;

        const justResolved = recentlyResolvedIds.has(col.id);

        // Cardinality detection
        const isUnique = col.constraints?.some(c => c.type === "unique");
        const fkCols = sourceTable.columns.filter(c => c.isForeignKey && c.linkedTable);
        const isJunction = fkCols.length === 2 && (sourceTable.indexes || []).some(ix =>
          ix.unique && ix.columns.length === 2 &&
          fkCols.every(fk => ix.columns.some(ic => ic.toLowerCase() === fk.name.toLowerCase()))
        );
        const srcLabel = isUnique ? "1" : "N";
        const tgtLabel = isJunction ? "N" : "1";
        const srcLabelX = startX + startSide * 16;
        const tgtLabelX = endX + endSide * 16;
        const arrowApexDx = endSide * 10;

        return (
          <g key={`${sourceTable.id}-${col.name}-${idx}`}>
            <path d={pathD} fill="none" stroke={stroke} strokeWidth={width + 4} opacity={opacity * 0.15} strokeLinecap="round" />
            <path d={pathD} fill="none" stroke={stroke} strokeWidth={width} opacity={opacity} strokeLinecap="round" className={justResolved ? "fk-line-resolved" : ""} />
            <circle cx={startX} cy={sourceRowY} r={width + 1.5} fill={stroke} fillOpacity={opacity} />
            <circle cx={endX} cy={targetRowY} r={width + 1.5} fill={stroke} fillOpacity={opacity} />
            <polygon
              points={`${endX},${targetRowY - 5} ${endX + arrowApexDx},${targetRowY} ${endX},${targetRowY + 5}`}
              fill={stroke}
              fillOpacity={opacity}
            />
            <text x={srcLabelX} y={sourceRowY - 6} fontSize={9} fontFamily="monospace" fill={stroke} fillOpacity={opacity * 0.8} textAnchor="middle">{srcLabel}</text>
            <text x={tgtLabelX} y={targetRowY - 6} fontSize={9} fontFamily="monospace" fill={stroke} fillOpacity={opacity * 0.8} textAnchor="middle">{tgtLabel}</text>
          </g>
        );
      })
    ).filter(Boolean);
  }, [canvasItems, hoveredTableId, connectionMode, recentlyResolvedIds]);

  const relatedNodeIds = useMemo(() => {
    if (!hoveredTableId) return new Set<string>();
    const ids = new Set<string>();
    ids.add(hoveredTableId);
    canvasItems.forEach(table => {
      table.columns.forEach(col => {
        if (!col.isForeignKey) return;
        const targetId = col.linkedTableId || canvasItems.find(t => t.name?.toLowerCase() === col.linkedTable?.toLowerCase())?.id;
        if (!targetId) return;
        if (table.id === hoveredTableId) ids.add(targetId);
        if (targetId === hoveredTableId) ids.add(table.id);
      });
    });
    return ids;
  }, [hoveredTableId, canvasItems]);

  const getTableOpacity = (tableId: string) => {
    if (!hoveredTableId) return 1;
    return relatedNodeIds.has(tableId) ? 1 : 0.3;
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top Bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={() => setShowProjectsPanel(!showProjectsPanel)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition" title="Projects">
          {showProjectsPanel ? <PanelLeftClose size={20} /> : <FolderOpen size={20} />}
        </button>
        <div className="flex items-center gap-2">
          <Database size={20} className="text-accent" />
          {editingProjectName ? (
            <input
              autoFocus
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              onBlur={() => setEditingProjectName(false)}
              onKeyDown={e => { if (e.key === "Enter") setEditingProjectName(false); }}
              className="text-lg font-bold bg-transparent border-b border-primary outline-none w-48"
            />
          ) : (
            <span className="text-lg font-bold cursor-pointer hover:text-primary transition" onClick={() => setEditingProjectName(true)} title="Click to rename">{projectName}</span>
          )}
        </div>
        <button onClick={saveProject} disabled={isSaving} className="flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition disabled:opacity-50" title="Save project">
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>

        {/* History Toggle */}
        <button
          onClick={() => setShowHistoryPanel(!showHistoryPanel)}
          className={`ml-auto flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${showHistoryPanel ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"}`}
          title="Generation history"
        >
          <Clock size={14} />
        </button>

        {/* Expert Toggle */}
        <button onClick={() => setExpertMode(!expertMode)} className={`flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm transition-colors ${expertMode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"}`}>
          <Settings size={16} />
          Expert
        </button>

        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={!canUndo} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-30" title="Undo"><Undo2 size={16} /></button>
          <button onClick={redo} disabled={!canRedo} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-30" title="Redo"><Redo2 size={16} /></button>
        </div>

        {/* Branding */}
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Database size={16} className="text-primary" />
          VibeDB
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <button
          onClick={() => setShowSidebar(s => !s)}
          aria-pressed={showSidebar}
          title={showSidebar ? "Hide tables panel" : "Show tables panel"}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
            showSidebar
              ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
              : "border-border bg-transparent text-muted-foreground hover:bg-secondary"
          }`}
        >
          <TableIcon size={14} className={showSidebar ? "text-emerald-500" : "text-muted-foreground"} />
          Tables
        </button>
        <div className="relative">
          <div className="flex rounded-lg overflow-hidden border border-border">
            <button onClick={addManualTable} className="flex items-center gap-1.5 bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition"><Plus size={14} /> Add Table</button>
            <button onClick={() => setShowAddTableMenu(!showAddTableMenu)} className="flex items-center justify-center bg-secondary px-1.5 py-1.5 text-secondary-foreground hover:bg-secondary/80 transition border-l border-border"><ChevronDown size={12} /></button>
          </div>
          {showAddTableMenu && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-card border border-border shadow-xl rounded-xl p-3 z-50 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><Sparkles size={12} /> AI Generate Table</div>
              <div className="flex gap-1.5">
                <input value={aiTablePrompt} onChange={e => setAiTablePrompt(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAiAddTable()} placeholder="e.g. 'user notifications'" className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary" />
                <button onClick={handleAiAddTable} disabled={isAddingAiTable || !aiTablePrompt.trim()} className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50">
                  {isAddingAiTable ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {expertMode && <button onClick={handleAutoLayout} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition"><LayoutTemplate size={14} /> Auto Layout</button>}
        <button onClick={() => setShowImportModal(true)} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition"><Upload size={14} /> Import</button>
        {expertMode && <button onClick={() => setShowBatchModal(true)} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition"><Edit3 size={14} /> Batch Edit</button>}
        {expertMode && <button onClick={handleAudit} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition">
          {isAuditing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Audit
        </button>}
        {expertMode && <button onClick={handleDeduplicate} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition">
          <RefreshCw size={14} /> Dedup
        </button>}

        <div className="flex-1" />

        {/* Feature Panel Toggles */}
        {expertMode && <button onClick={() => setShowDBManager(!showDBManager)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${showDBManager ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}><Plug size={14} /> DB</button>}
        {expertMode && <button onClick={() => setShowQueryBuilder(!showQueryBuilder)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${showQueryBuilder ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}><Terminal size={14} /> Query</button>}
        {expertMode && <button onClick={() => setShowSupabasePanel(!showSupabasePanel)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${showSupabasePanel ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}><DatabaseZap size={14} /> Supa</button>}

        {expertMode && <button onClick={() => setShowAskData(!showAskData)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${showAskData ? "bg-violet-600 text-white" : "bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"}`}><MessageCircle size={14} /> Ask Data</button>}

        {/* Export Menu */}
        <div className="relative">
          <button onClick={handleCompileSQL} className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition hover:opacity-90"><Code size={14} /> Export SQL</button>
        </div>
        {expertMode && <button onClick={handleGenerateRLS} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 transition"><ShieldCheck size={14} /> RLS</button>}
        {expertMode && <div className="relative">
          <button onClick={() => setShowExportMenu(!showExportMenu)} className="flex items-center gap-1.5 rounded-lg bg-secondary px-2 py-1.5 text-xs text-secondary-foreground hover:bg-secondary/80 transition"><Download size={14} /></button>
          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border shadow-xl rounded-xl overflow-hidden z-50">
              {[
                { key: "sql", icon: <Database size={14} className="text-accent" />, label: "SQL" },
                { key: "prisma", icon: <Box size={14} className="text-primary" />, label: "Prisma" },
                { key: "drizzle", icon: <Columns size={14} className="text-accent" />, label: "Drizzle" },
                { key: "graphql", icon: <Webhook size={14} className="text-destructive" />, label: "GraphQL" },
                { key: "zod", icon: <ShieldCheck size={14} className="text-emerald-500" />, label: "Zod" },
                { key: "docs", icon: <BookOpen size={14} className="text-blue-400" />, label: "Docs" },
                { key: "csv", icon: <FileText size={14} className="text-primary" />, label: "CSV" },
              ].map(fmt => (
                <button key={fmt.key} onClick={() => handleExport(fmt.key)} className="w-full text-left px-4 py-2.5 hover:bg-secondary flex items-center gap-3 text-sm font-medium">
                  {fmt.icon} Export {fmt.label}
                </button>
              ))}
            </div>
          )}
        </div>}
        <button
          onClick={() => setShowChatPanel(!showChatPanel)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${showChatPanel ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
        >
          <MessageCircle size={14} /> AI Chat
        </button>
        <button onClick={() => setShowDeployModal(true)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${deployConnected ? "bg-accent text-accent-foreground hover:bg-accent/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
          {deployConnected ? <CheckCircle2 size={14} /> : <Rocket size={14} />}
          {deployNavLabel}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Projects Panel */}
        {showProjectsPanel && (
          <div className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Projects</span>
              <button onClick={newProject} className="p-1 hover:bg-secondary rounded text-accent" title="New project">
                <FilePlus size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {projects.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderOpen size={20} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No saved projects.</p>
                  <p className="text-[10px] opacity-70 mt-1">Click Save to create one.</p>
                </div>
              )}
              {projects.map(project => (
                <div
                  key={project.id}
                  className={`group rounded-lg border p-2.5 cursor-pointer transition-colors ${currentProjectId === project.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-accent/50 bg-background"
                    }`}
                  onClick={() => loadProject(project)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold truncate flex-1">{project.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}
                      className="p-0.5 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive/80"
                      title="Delete project"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {Array.isArray(project.definition) ? project.definition.length : 0} tables · {new Date(project.updated_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tables Sidebar */}
        {showSidebar && (
          <VibeDBSidebar
            sidebarItems={sidebarItems}
            setSidebarItems={setSidebarItems}
            expertMode={expertMode}
            onAddToCanvas={addItemToCanvas}
            onGenerateMore={handleGenerateSidebarTables}
            isGeneratingMore={isGeneratingSidebar}
          />
        )}

        {/* Canvas */}
        <div className="relative flex-1 overflow-hidden overscroll-contain" ref={canvasRef} onMouseDown={handleCanvasMouseDown}
          onDrop={handleCanvasDrop} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)",
            backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }} />

          {/* Connection mode banner */}
          {connectionMode && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-lg">
              <LinkIcon size={14} /> Select target column to link...
              <button onClick={() => setConnectionMode(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
            </div>
          )}

          {/* Diff banner */}
          {showDiff && diffBase && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary shadow-lg">
              <GitCompare size={14} /> Diff Mode: Comparing to snapshot
              <button onClick={() => setShowDiff(false)} className="ml-2 hover:opacity-70"><X size={14} /></button>
            </div>
          )}

          <svg className="pointer-events-none absolute inset-0 z-20" style={{ width: "100%", height: "100%" }} overflow="visible">
            <g transform={`translate(${view.x}, ${view.y}) scale(${view.zoom})`}>
              {connectionPaths}
            </g>
          </svg>

          <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0", position: "absolute", inset: 0 }}>
            {canvasItems.map(table => (
              <div
                key={table.id}
                data-table
                onMouseDown={e => handleTableMouseDown(e, table.id)}
                onMouseEnter={() => setHoveredTableId(table.id)}
                onMouseLeave={() => setHoveredTableId(null)}
                className="absolute cursor-grab select-none rounded-xl border border-border bg-card shadow-sm transition-all hover:shadow-md active:cursor-grabbing"
                style={{
                  left: table.x, top: table.y, width: TABLE_WIDTH, opacity: getTableOpacity(table.id), zIndex: hoveredTableId === table.id ? 50 : 10,
                  boxShadow: hoveredTableId === table.id ? "0 0 0 2px hsl(var(--accent)), 0 20px 25px -5px rgb(0 0 0 / 0.1)" : undefined,
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between rounded-t-xl bg-secondary/50 px-3 py-2" style={{ height: HEADER_HEIGHT }}
                  onMouseDown={e => { if (editingTable === table.id || (e.target as HTMLElement).closest('button')) e.stopPropagation(); }}>
                  {editingTable === table.id ? (
                    <input autoFocus value={editingTableName} onChange={e => setEditingTableName(e.target.value)}
                      onBlur={() => { updateTableName(table.id, editingTableName); setEditingTable(null); }}
                      onKeyDown={e => { if (e.key === "Enter") { updateTableName(table.id, editingTableName); setEditingTable(null); } e.stopPropagation(); }}
                      onMouseDown={e => e.stopPropagation()}
                      className="w-full border-none bg-transparent text-sm font-bold outline-none" onClick={e => e.stopPropagation()} />
                  ) : (
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <TableIcon size={12} className="text-muted-foreground" /> {table.name}
                      {table.dataRows && table.dataRows.length > 0 && (
                        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent leading-none">{table.dataRows.length} rows</span>
                      )}
                    </span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {editingTable !== table.id && (
                      <button onClick={e => { e.stopPropagation(); e.preventDefault(); setEditingTableName(table.name); setEditingTable(table.id); }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }} className="text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-secondary/80" title="Rename table">
                        <Edit3 size={14} />
                      </button>
                    )}
                    <button onClick={e => { e.stopPropagation(); handleSmartAddColumn(table.id); }} className="text-accent hover:opacity-80 p-1" title="AI Suggest Column">
                      {generatingTableId === table.id ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                    </button>
                    {expertMode && <button onClick={e => { e.stopPropagation(); addColumn(table.id); }} className="text-muted-foreground hover:text-accent p-1"><Plus size={13} /></button>}
                    <button onClick={e => { e.stopPropagation(); deleteTable(table.id); }} className="text-muted-foreground hover:text-destructive p-1"><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* Columns */}
                {table.columns.map((col, idx) => (
                  <div key={col.id} className={`group flex items-center gap-1 border-t border-border px-3 text-[11px] transition-colors ${connectionMode ? "cursor-crosshair hover:bg-accent/10" : ""} ${connectionMode?.sourceColumnId === col.id ? "bg-primary/10" : ""} ${recentlyResolvedIds.has(col.id) ? "animate-fk-handshake" : ""}`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => { if (connectionMode) completeConnection(table.id, col.id); }}
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden flex-1">
                      {expertMode && <GripVertical size={10} className="text-muted-foreground cursor-grab" />}
                      {col.isForeignKey ? (
                        <button onClick={e => { e.stopPropagation(); if (expertMode) { connectionMode ? completeConnection(table.id, col.id) : startConnection(table.id, col.id); } }}
                          className={`shrink-0 ${col.fkStatus === "resolved" ? "text-accent" : "text-destructive"} ${connectionMode ? "animate-pulse" : ""}`}>
                          <LinkIcon size={11} />
                        </button>
                      ) : (col.constraints?.some(c => c.type === "primary") || col.name === "id") ? (
                        <Key size={11} className="text-primary shrink-0" />
                      ) : (
                        <Hash size={11} className="text-muted-foreground/50 shrink-0" />
                      )}

                      {editingColumn?.tableId === table.id && editingColumn?.columnId === col.id ? (
                        <input autoFocus className="bg-transparent border-none outline-none text-[11px] w-full font-mono font-semibold"
                          defaultValue={col.name}
                          onBlur={e => { updateColumn(table.id, col.id, { name: e.target.value }); setEditingColumn(null); }}
                          onKeyDown={e => { if (e.key === "Enter") { updateColumn(table.id, col.id, { name: (e.target as HTMLInputElement).value }); setEditingColumn(null); } }}
                          onClick={e => e.stopPropagation()} />
                      ) : (
                        <span className={`font-mono font-semibold truncate ${col.isForeignKey ? "text-accent" : "text-foreground"}`}
                          onDoubleClick={() => expertMode && setEditingColumn({ tableId: table.id, columnId: col.id })}>
                          {col.name}
                        </span>
                      )}
                    </div>

                    {expertMode ? (
                      <select value={col.type} onChange={e => { e.stopPropagation(); updateColumn(table.id, col.id, { type: e.target.value }); }}
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] font-mono text-muted-foreground bg-transparent outline-none cursor-pointer appearance-none text-right pr-1 hover:text-foreground">
                        {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (
                      <span className="ml-auto text-muted-foreground text-[10px] font-mono">{col.type}</span>
                    )}

                    {col.constraints?.some(c => c.type === "primary") && <span className="ml-0.5 rounded bg-primary/10 px-1 text-[8px] font-bold text-primary">PK</span>}
                    {col.isForeignKey && <span className="ml-0.5 rounded bg-accent/10 px-1 text-[8px] font-bold text-accent">FK</span>}

                    {expertMode && (
                      <>
                        <button onClick={e => { e.stopPropagation(); deleteColumn(table.id, col.id); }} className="ml-0.5 hidden text-destructive group-hover:block"><X size={10} /></button>
                        <button onMouseDown={e => { e.stopPropagation(); if (!connectionMode) startConnection(table.id, col.id); }}
                          onClick={e => e.stopPropagation()} className="hidden group-hover:block text-muted-foreground hover:text-accent"><Plus size={10} /></button>
                      </>
                    )}
                  </div>
                ))}

                {/* Add Column button (non-expert) */}
                {!expertMode && (
                  <button onClick={e => { e.stopPropagation(); addColumn(table.id); }}
                    className="flex w-full items-center justify-center gap-1 border-t border-border py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/30 transition rounded-b-xl">
                    <Plus size={10} /> Add Column
                  </button>
                )}
              </div>
            ))}
          </div>

          {canvasItems.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-4">
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="pointer-events-auto relative w-full max-w-[520px] rounded-2xl border border-accent/45 bg-card/95 px-7 pb-7 pt-10 text-center shadow-[0_24px_70px_rgba(15,23,42,0.12),0_4px_16px_rgba(15,23,42,0.07)] backdrop-blur"
              >
                <div className="absolute left-1/2 top-0 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card shadow-sm">
                  <Database size={28} className="text-accent" />
                </div>
                <h3 className="text-2xl font-bold tracking-tight text-foreground">Describe your database</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Describe what you're building. VibeDB will draft tables, fields, and relationships.
                </p>

                <div className="relative mt-5">
                  <textarea
                    ref={promptTextareaRef}
                    rows={1}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    onFocus={() => setIsPromptFocused(true)}
                    onBlur={() => setIsPromptFocused(false)}
                    aria-label="Describe your database"
                    className="min-h-[48px] w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-left text-sm leading-6 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  {prompt === "" && !isPromptFocused && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-4 right-4 top-3.5 truncate text-left text-sm text-muted-foreground select-none"
                    >
                      {typewriterText}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt.trim()}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-base font-bold text-accent-foreground shadow-[0_12px_28px_rgba(16,185,129,0.22)] transition hover:opacity-90 disabled:opacity-50"
                  >
                    {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                    Generate schema
                  </button>
                </div>

                <AnimatePresence>
                  {(isGenerating || generationProgress) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-background/70 text-left"
                    >
                      <button
                        onClick={() => setThinkingExpanded(!thinkingExpanded)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground transition hover:text-foreground"
                      >
                        <ChevronDown size={12} className={`transition-transform ${thinkingExpanded ? "" : "-rotate-90"}`} />
                        {isGenerating && <Loader2 size={12} className="animate-spin text-accent" />}
                        {isGenerating ? (
                          <span className="font-medium text-accent">Generating schema...</span>
                        ) : generationProgress?.overallStatus === "completed" ? (
                          <span className="font-medium text-emerald-500">Generation complete</span>
                        ) : generationProgress?.overallStatus === "error" ? (
                          <span className="font-medium text-red-500">Generation failed</span>
                        ) : (
                          <span className="font-medium">View generation steps</span>
                        )}
                        {!isGenerating && generationProgress && (
                          <span
                            onClick={(e) => { e.stopPropagation(); setGenerationProgress(null); setThinkingExpanded(false); }}
                            className="ml-auto text-muted-foreground/50 hover:text-muted-foreground"
                          >
                            <X size={10} />
                          </span>
                        )}
                      </button>
                      <AnimatePresence>
                        {thinkingExpanded && generationProgress && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-border/60 p-3">
                              <GenerationProgressUI progress={generationProgress} />
                              {compilerReport && compilerReport.actions.length > 0 && !isGenerating && (
                                <CompilerReportUI report={compilerReport} />
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>

                {expertMode && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Generation mode</div>
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary/70 p-1">
                      {STRATEGIES.map(s => {
                        const label = s.id === "v4-parallel" ? "Parallel" : s.id === "v1-direct" ? "Sequential" : "Slow";
                        const selected = selectedStrategy === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => { setSelectedStrategy(s.id); setDefaultStrategy(s.id); }}
                            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                              selected
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                            }`}
                            title={s.description}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          )}

          {/* Minimap */}
          {canvasItems.length > 0 && (() => {
            const MINIMAP_W = 200;
            const MINIMAP_H = 140;
            const PADDING = 20;

            // Calculate bounding box of all tables
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            canvasItems.forEach(t => {
              const tableH = HEADER_HEIGHT + t.columns.length * ROW_HEIGHT + (!expertMode ? 28 : 0);
              minX = Math.min(minX, t.x);
              minY = Math.min(minY, t.y);
              maxX = Math.max(maxX, t.x + TABLE_WIDTH);
              maxY = Math.max(maxY, t.y + tableH);
            });
            minX -= PADDING; minY -= PADDING; maxX += PADDING; maxY += PADDING;
            const contentW = maxX - minX || 1;
            const contentH = maxY - minY || 1;
            const scale = Math.min(MINIMAP_W / contentW, MINIMAP_H / contentH);

            // Viewport rectangle in canvas coordinates
            const canvasEl = canvasRef.current;
            const vpW = canvasEl ? canvasEl.clientWidth / view.zoom : 0;
            const vpH = canvasEl ? canvasEl.clientHeight / view.zoom : 0;
            const vpX = -view.x / view.zoom;
            const vpY = -view.y / view.zoom;

            const handleMinimapMouseDown = (e: React.MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const navigate = (clientX: number, clientY: number) => {
                const mx = (clientX - rect.left) / scale + minX;
                const my = (clientY - rect.top) / scale + minY;
                setView(v => ({
                  ...v,
                  x: -(mx - vpW / 2) * v.zoom,
                  y: -(my - vpH / 2) * v.zoom,
                }));
              };
              navigate(e.clientX, e.clientY);
              const handleMove = (ev: MouseEvent) => navigate(ev.clientX, ev.clientY);
              const handleUp = () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
              window.addEventListener("mousemove", handleMove);
              window.addEventListener("mouseup", handleUp);
            };

            return (
              <div
                className="absolute bottom-3 right-3 z-40 rounded-lg border border-border bg-card/90 backdrop-blur-sm shadow-lg overflow-hidden cursor-crosshair"
                style={{ width: MINIMAP_W, height: MINIMAP_H }}
                onMouseDown={handleMinimapMouseDown}
              >
                <svg width={MINIMAP_W} height={MINIMAP_H}>
                  {/* FK connection lines */}
                  {canvasItems.flatMap(sourceTable =>
                    sourceTable.columns.map((col, idx) => {
                      if (!col.isForeignKey || (!col.linkedTableId && !col.linkedTable)) return null;
                      const targetTable = canvasItems.find(t => t.id === col.linkedTableId || t.name === col.linkedTable || t.name?.toLowerCase() === col.linkedTable?.toLowerCase());
                      if (!targetTable) return null;
                      const sy = sourceTable.y + HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2;
                      let ti = targetTable.columns.findIndex(c => c.name === col.linkedColumn);
                      if (ti === -1) ti = 0;
                      const ty = targetTable.y + HEADER_HEIGHT + ti * ROW_HEIGHT + ROW_HEIGHT / 2;
                      const sx = sourceTable.x + TABLE_WIDTH / 2 < targetTable.x + TABLE_WIDTH / 2 ? sourceTable.x + TABLE_WIDTH : sourceTable.x;
                      const ex = sourceTable.x + TABLE_WIDTH / 2 < targetTable.x + TABLE_WIDTH / 2 ? targetTable.x : targetTable.x + TABLE_WIDTH;
                      return (
                        <line key={`mm-${sourceTable.id}-${col.id}-${idx}`}
                          x1={(sx - minX) * scale} y1={(sy - minY) * scale}
                          x2={(ex - minX) * scale} y2={(ty - minY) * scale}
                          stroke="hsl(var(--accent))" strokeWidth={1} opacity={0.4}
                        />
                      );
                    })
                  ).filter(Boolean)}

                  {/* Table rectangles */}
                  {canvasItems.map(t => {
                    const tableH = HEADER_HEIGHT + t.columns.length * ROW_HEIGHT + (!expertMode ? 28 : 0);
                    return (
                      <rect key={`mm-${t.id}`}
                        x={(t.x - minX) * scale} y={(t.y - minY) * scale}
                        width={TABLE_WIDTH * scale} height={tableH * scale}
                        rx={2} fill="hsl(var(--primary))" fillOpacity={0.35}
                        stroke="hsl(var(--primary))" strokeWidth={0.75} strokeOpacity={0.6}
                      />
                    );
                  })}

                  {/* Viewport rectangle */}
                  <rect
                    x={(vpX - minX) * scale} y={(vpY - minY) * scale}
                    width={vpW * scale} height={vpH * scale}
                    fill="hsl(var(--accent))" fillOpacity={0.08}
                    stroke="hsl(var(--accent))" strokeWidth={1.5} strokeOpacity={0.7}
                    rx={2}
                  />
                </svg>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Query Playground */}
      <AnimatePresence>
        {showPlayground && (
          <motion.div initial={{ height: 0 }} animate={{ height: 200 }} exit={{ height: 0 }} className="overflow-hidden border-t border-border bg-card">
            <div className="flex h-full flex-col p-4">
              <div className="mb-2 flex items-center gap-2">
                <Terminal size={14} className="text-accent" />
                <span className="text-xs font-bold">Query Playground</span>
                <button onClick={() => setShowPlayground(false)} className="ml-auto text-muted-foreground"><X size={14} /></button>
              </div>
              <div className="flex flex-1 gap-4">
                <div className="flex flex-1 flex-col gap-2">
                  <input value={queryPrompt} onChange={e => setQueryPrompt(e.target.value)} onKeyDown={e => e.key === "Enter" && handleGenerateQuery()}
                    placeholder="Describe your query in natural language..." className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  <button onClick={handleGenerateQuery} disabled={isQuerying} className="flex items-center gap-2 self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50">
                    {isQuerying ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate
                  </button>
                </div>
                <div className="flex-1 overflow-auto rounded-lg bg-background p-3 font-mono text-xs">
                  {generatedQuery || <span className="text-muted-foreground">Your query will appear here...</span>}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Diff Panel */}
      <AnimatePresence>
        {showDiff && diffBase && (
          <motion.div initial={{ height: 0 }} animate={{ height: 200 }} exit={{ height: 0 }} className="overflow-hidden border-t border-border bg-card">
            <div className="flex h-full flex-col p-4">
              <div className="mb-2 flex items-center gap-2">
                <GitCompare size={14} className="text-primary" />
                <span className="text-xs font-bold">Schema Changes</span>
                <button onClick={() => setShowDiff(false)} className="ml-auto text-muted-foreground"><X size={14} /></button>
              </div>
              <div className="flex-1 overflow-auto space-y-1">
                {(() => {
                  const changes = computeDiff();
                  if (!changes || changes.length === 0) return <p className="text-xs text-muted-foreground">No changes detected.</p>;
                  return changes.map((c, i) => (
                    <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${c.type === "added" ? "bg-accent/10 text-accent" : c.type === "removed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                      <span className="font-bold">{c.type === "added" ? "+" : c.type === "removed" ? "−" : "~"}</span>
                      <span className="font-mono font-semibold">{c.target}</span>
                      <span className="text-muted-foreground">{c.details}</span>
                      {c.breaking && <span className="ml-auto text-[9px] font-bold text-destructive">BREAKING</span>}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MODALS ═══ */}

      {/* SQL Modal */}
      <SQLViewerModal
        open={showSqlModal}
        onClose={() => setShowSqlModal(false)}
        sql={generatedSql}
        tables={canvasItems}
        onCopy={handleCopy}
        copied={copied}
        onFixIssues={handleFixSqlIssues}
      />

      {/* RLS Modal */}
      <SQLViewerModal
        open={showRlsModal}
        onClose={() => setShowRlsModal(false)}
        sql={generatedRlsSql}
        tables={canvasItems}
        onCopy={handleCopy}
        copied={copied}
      />

      {/* Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm" onClick={() => setShowImportModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="mx-4 w-full max-w-2xl rounded-2xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2"><Upload size={18} /> Import SQL or CSV</h2>
                <button onClick={() => setShowImportModal(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary"><X size={16} /></button>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">Paste your SQL CREATE TABLE statements or CSV data below. CSVs will automatically build a schema and insert data.</p>
              <textarea value={importText} onChange={e => setImportText(e.target.value)}
                placeholder={`CREATE TABLE users (\n  id UUID PRIMARY KEY,\n  name VARCHAR NOT NULL\n);\n\n-- OR --\n\nid,name,email\n1,Alice,alice@example.com`}
                className="w-full rounded-xl border border-border bg-background p-4 font-mono text-xs leading-relaxed outline-none focus:border-primary resize-none" rows={12} />
              <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={normalizeOnImport} onChange={e => setNormalizeOnImport(e.target.checked)} className="rounded border-border accent-accent" />
                <span className="text-xs font-medium text-muted-foreground">Normalize to 3NF</span>
                <span className="text-[10px] text-muted-foreground/60">(split flat CSV into related tables using AI)</span>
              </label>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <input
                    type="file"
                    multiple
                    accept=".csv,.tsv,.sql,.txt"
                    className="hidden"
                    id="import-file-upload"
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      let combinedText = "";
                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const text = await file.text();
                        const tableName = file.name.replace(/\.[^/.]+$/, "");
                        if (files.length > 0 || /---\s*TABLE/i.test(text)) {
                          combinedText += `--- TABLE: ${tableName} ---\n${text}\n\n`;
                        } else {
                          combinedText += text;
                        }
                      }
                      setImportText(combinedText);
                    }}
                  />
                  <label
                    htmlFor="import-file-upload"
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold hover:bg-secondary/80"
                  >
                    <Upload size={14} /> Upload File
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowImportModal(false)} className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold hover:bg-secondary/80">Cancel</button>
                  <button onClick={handleImport} disabled={!importText.trim() || isCallingAI} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">
                    {isCallingAI ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Import
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Edit Modal */}
      <AnimatePresence>
        {showBatchModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm" onClick={() => setShowBatchModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="mx-4 w-full max-w-lg rounded-2xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2"><Edit3 size={18} /> Batch Edit</h2>
                <button onClick={() => setShowBatchModal(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary"><X size={16} /></button>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">Describe changes to apply across your schema.</p>
              <textarea value={batchPrompt} onChange={e => setBatchPrompt(e.target.value)}
                placeholder='e.g. "Add soft delete (deleted_at timestamp) to all tables"'
                className="w-full rounded-xl border border-border bg-background p-4 text-sm outline-none focus:border-primary resize-none" rows={4} />
              {batchError && <div className="mt-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">{batchError}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setShowBatchModal(false)} className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold hover:bg-secondary/80">Cancel</button>
                <button onClick={handleBatchCommand} disabled={isBatchProcessing || !batchPrompt.trim()} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">
                  {isBatchProcessing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  {isBatchProcessing ? "Processing..." : "Execute"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Mock Data Modal */}
      <MockDataModal
        open={showMockDataModal}
        onClose={() => setShowMockDataModal(false)}
        sql={mockDataSql}
        isGenerating={isGeneratingMockData}
        tableCount={canvasItems.length}
        onCopy={handleCopy}
        copied={copied}
        onCancel={handleCancelMockData}
        onLoadInPlayground={(sql) => {
          setPlaygroundInitialSql(sql);
          setShowMockDataModal(false);
          setShowQueryBuilder(true);
        }}
      />

      {/* Deploy Modal */}
      <AnimatePresence>
        {showDeployModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm" onClick={() => setShowDeployModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="mx-4 w-full max-w-lg rounded-2xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2"><Rocket size={18} /> {deployModalTitle}</h2>
                <button onClick={() => setShowDeployModal(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary"><X size={16} /></button>
              </div>

              {!deployConnected ? (
                <>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {hasSupabaseBaseline
                      ? "Connect with a service role key to sync changes back to the imported Supabase project."
                      : "Connect to your Supabase project to deploy your schema directly."}
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground mb-1 block">Supabase Project URL</label>
                      <input value={deployUrl} onChange={e => setDeployUrl(e.target.value)} placeholder="https://your-project.supabase.co"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground mb-1 block">Service Role Key</label>
                      <input value={deployKey} onChange={e => setDeployKey(e.target.value)} type="password" placeholder="eyJhbGci..."
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                    <p className="text-xs text-muted-foreground">Find these in your Supabase dashboard → Settings → API. Your key is stored locally in this browser only.</p>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={() => setDeployResults(null)} className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold hover:bg-secondary/80">Cancel</button>
                    <button
                      onClick={handleFixDeployErrors}
                      className="flex items-center gap-2 rounded-lg bg-yellow-500/20 px-4 py-2 text-sm font-semibold text-yellow-500 hover:bg-yellow-500/30"
                    >
                      <Sparkles size={14} /> Auto-Fix Schema
                    </button>
                    <button onClick={handleTestConnection} disabled={isTesting || !deployUrl.trim() || !deployKey.trim()} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                      {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                      {isTesting ? "Connecting..." : "Test Connection"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-4 flex items-center gap-2 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2">
                    <CheckCircle2 size={16} className="text-accent" />
                    <span className="text-sm font-medium text-accent">Connected to {deployUrl.replace(/https?:\/\//, "").split(".")[0]}</span>
                    <button onClick={handleDisconnect} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Disconnect</button>
                  </div>

                  {canvasItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Add tables to your schema before deploying.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-background border border-border p-3">
                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                          {hasSupabaseBaseline ? "Linked Supabase schema" : "Schema to deploy"}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {canvasItems.map(t => (
                            <span key={t.id} className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">{t.name} ({t.columns.length} cols{t.dataRows && t.dataRows.length > 0 ? `, ${t.dataRows.length} rows` : ""})</span>
                          ))}
                        </div>
                      </div>
                      {hasSupabaseBaseline ? (
                        <p className={`text-xs ${hasSupabaseSyncChanges ? "text-muted-foreground" : "text-accent"}`}>
                          <AlertCircle size={12} className="inline mr-1" />
                          {hasSupabaseSyncChanges
                            ? `${supabaseSyncChangeCount} pending schema change${supabaseSyncChangeCount !== 1 ? "s" : ""} will be reviewed as migration SQL before execution.`
                            : hasPendingDdlPatches
                              ? `${pendingDdlPatchCount} pending DDL patch${pendingDdlPatchCount !== 1 ? "es" : ""} will be included in the reviewed SQL.`
                              : "No pending schema changes. The imported Supabase baseline matches the canvas."}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground"><AlertCircle size={12} className="inline mr-1" />This will run CREATE TABLE statements. Existing tables with the same name may cause errors.</p>
                      )}
                      {hasPendingDdlPatches && (
                        <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          <FileText size={13} />
                          {pendingDdlPatchCount} pending DDL patch{pendingDdlPatchCount !== 1 ? "es" : ""} will run after schema SQL (included automatically in the reviewed SQL).
                        </div>
                      )}
                    </div>
                  )}

                  {deploySetupNeeded && (
                    <div className="mt-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-4 space-y-2">
                      <div className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
                        <AlertCircle size={14} /> One-time setup required
                      </div>
                      <p className="text-xs text-muted-foreground">Run this SQL in your target Supabase project's <strong>SQL Editor</strong> first:</p>
                      <pre className="bg-background rounded-lg p-3 text-xs font-mono overflow-x-auto select-all">{`-- Required for deploying schemas
CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void AS $$
BEGIN
  EXECUTE query;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Required for live querying
CREATE OR REPLACE FUNCTION exec_sql_read(query text)
RETURNS json AS $$
DECLARE result json;
BEGIN
  EXECUTE 'SELECT json_agg(row_to_json(t)) FROM (' || query || ') t' INTO result;
  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`}</pre>
                      <p className="text-xs text-muted-foreground">Then click <strong>{hasSupabaseBaseline ? "Review Sync" : "Deploy Schema"}</strong> again.</p>
                    </div>
                  )}

                  {/* Deploy Results — Success State */}
                  {deployResults && !deployResults.some(r => !r.success) && !deployFixResult && (
                    <div className="mt-3 rounded-lg bg-accent/10 border border-accent/20 p-4 text-center space-y-3">
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle2 size={20} className="text-accent" />
                        <span className="text-sm font-semibold text-accent">{hasSupabaseBaseline ? "Supabase schema synced!" : "Everything deployed successfully!"}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {deployResults.filter(r => r.success).length} statement{deployResults.filter(r => r.success).length !== 1 ? "s" : ""} executed
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={handlePrimaryDeployAction}
                          disabled={isDeploying || isSyncing || (hasSupabaseBaseline && !hasSupabaseSyncWork)}
                          className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/80 transition"
                        >
                          {isDeploying || isSyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {hasSupabaseBaseline ? hasSupabaseSyncWork ? "Review Sync" : "Synced" : "Re-deploy"}
                        </button>
                        <button
                          onClick={handleImportRows}
                          disabled={isImportingRows}
                          className="flex items-center gap-2 rounded-lg bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-700 transition disabled:opacity-50"
                        >
                          {isImportingRows ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                          Import Rows from DB
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Deploy Results — Error State (only show failed statements) */}
                  {deployResults && deployResults.some(r => !r.success) && !deployFixResult && (
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center justify-between rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
                        <div className="text-xs text-destructive font-medium flex items-center gap-1.5">
                          <AlertCircle size={12} />
                          {deployResults.filter(r => !r.success).length} error{deployResults.filter(r => !r.success).length !== 1 ? "s" : ""} out of {deployResults.length} statements
                        </div>
                        <button
                          onClick={handleFixDeployErrors}
                          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
                        >
                          <Wand2 size={12} /> Fix All Issues
                        </button>
                      </div>
                      <div className="max-h-36 overflow-auto rounded-lg bg-background border border-border p-3 space-y-1">
                        {deployResults.filter(r => !r.success).map((r, i) => (
                          <div key={i} className="text-xs font-mono flex items-start gap-2 text-destructive">
                            <AlertCircle size={12} className="mt-0.5 shrink-0" />
                            <span className="break-all">{r.statement}{r.error ? ` — ${r.error}` : ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fix Summary — appears after fixes are applied */}
                  {deployFixResult && (
                    <div className="mt-3 rounded-lg bg-background border border-border p-3 space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                        <CheckCircle2 size={12} className="text-accent" />
                        {deployFixResult.actions.filter(a => a.type !== "unfixable" && a.type !== "skip_existing").length} issue{deployFixResult.actions.filter(a => a.type !== "unfixable" && a.type !== "skip_existing").length !== 1 ? "s" : ""} fixed
                      </div>
                      <div className="max-h-32 overflow-auto space-y-1">
                        {deployFixResult.actions.map((action, i) => (
                          <div key={i} className={`text-xs flex items-start gap-2 ${action.type === "unfixable" ? "text-destructive" :
                            action.type === "skip_existing" ? "text-muted-foreground" :
                              "text-accent"
                            }`}>
                            {action.type === "unfixable"
                              ? <AlertCircle size={12} className="mt-0.5 shrink-0" />
                              : action.type === "skip_existing"
                                ? <Eye size={12} className="mt-0.5 shrink-0" />
                                : <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                            }
                            <span className="break-all">
                              <span className="font-semibold font-mono">{action.tableName}</span> — {action.description}
                            </span>
                          </div>
                        ))}
                      </div>
                      {deployFixResult.hasUnfixable && (
                        <p className="text-[11px] text-destructive/80 mt-2">
                          Some errors could not be auto-fixed. Review and fix them manually before re-deploying.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={() => { setShowDeployModal(false); setDeployFixResult(null); }} className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold hover:bg-secondary/80">Close</button>
                    <button
                      onClick={handleImportRows}
                      disabled={isImportingRows || canvasItems.length === 0}
                      className="flex items-center gap-2 rounded-lg bg-violet-600 text-white px-4 py-2 text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition"
                    >
                      {isImportingRows ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      {isImportingRows ? "Importing..." : "Import Rows"}
                    </button>
                    <button
                      onClick={handlePrimaryDeployAction}
                      disabled={isDeploying || isSyncing || canvasItems.length === 0 || (hasSupabaseBaseline && !hasSupabaseSyncWork)}
                      className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                    >
                      {isDeploying || isSyncing ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
                      {deployPrimaryLabel}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Supabase Sync Review Modal */}
      <AnimatePresence>
        {showSyncReview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/20 backdrop-blur-sm" onClick={() => setShowSyncReview(false)}>
            <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }} className="mx-4 flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl border border-border" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
                    <DatabaseZap size={18} className="text-accent" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">Review Supabase Sync</h2>
                    <p className="text-[11px] text-muted-foreground">
                      {supabaseBaseline?.url.replace(/https?:\/\//, "").split(".")[0] || "Supabase"} · {syncReviewSummary.length > 0 ? syncReviewSummary.join(", ") : "No structural changes"}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowSyncReview(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary hover:bg-secondary/80">
                  <X size={16} />
                </button>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[320px_1fr]">
                <div className="overflow-y-auto border-b border-border bg-background/50 p-4 md:border-b-0 md:border-r">
                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Schema Diff</div>
                      {syncReviewSummary.length === 0 ? (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">No changes detected.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {syncReviewSummary.map((item) => (
                            <div key={item} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                              <GitCompare size={12} className="text-accent" />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {syncReviewPatches.length > 0 && (
                      <div>
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">DDL Patches</div>
                        <div className="space-y-1.5">
                          {syncReviewPatches.map((patch) => (
                            <div key={patch.id} className="rounded-lg border border-border bg-card px-3 py-2">
                              <div className="flex items-center gap-2 text-xs font-semibold">
                                <FileText size={12} className="text-amber-500" />
                                <span>{patch.title}</span>
                              </div>
                              {patch.warnings.length > 0 && (
                                <div className="mt-1 text-[10px] text-destructive">{patch.warnings.join(", ")}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {syncReviewRisks.length > 0 && (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-bold text-destructive">
                          <AlertCircle size={13} />
                          Review destructive or risky SQL
                        </div>
                        <div className="space-y-1">
                          {syncReviewRisks.map((risk) => (
                            <div key={risk} className="text-[11px] text-destructive/90">- {risk}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 text-xs font-bold">Execution Artifact</div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        This SQL editor is the exact migration that will run. Canvas diff generated it; your edits here are preserved for this sync.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <Code size={13} />
                      Migration SQL
                    </div>
                    <button onClick={() => handleCopy(syncSql)} className="flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-[10px] font-semibold hover:bg-secondary/80">
                      {copied ? <Check size={10} /> : <Copy size={10} />}
                      Copy SQL
                    </button>
                  </div>
                  <textarea
                    value={syncSql}
                    onChange={e => setSyncSql(e.target.value)}
                    spellCheck={false}
                    className="min-h-[420px] flex-1 resize-none bg-background p-4 font-mono text-xs leading-relaxed outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border px-5 py-3 shrink-0">
                <div className="text-[11px] text-muted-foreground">
                  {syncReviewRisks.length > 0 ? "Risky statements are allowed only after this review." : "Data-preserving migration review is ready."}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowSyncReview(false)} className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold hover:bg-secondary/80">Cancel</button>
                  <button onClick={handleRunSync} disabled={isSyncing || !syncSql.trim()} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">
                    {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <DatabaseZap size={14} />}
                    {isSyncing ? "Syncing..." : "Run Reviewed SQL"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audit Modal */}
      <SchemaAuditModal
        open={showAuditModal}
        onClose={() => setShowAuditModal(false)}
        isAuditing={isAuditing}
        auditPhase={auditPhase}
        report={auditReport}
        onApplySuggestion={handleApplySuggestion}
        onApplyAll={handleApplyAllSuggestions}
        onRerunAudit={handleAudit}
      />

      {/* Schema Compare Modal */}
      <SchemaCompareModal
        open={showSchemaCompare}
        onClose={() => setShowSchemaCompare(false)}
        currentSchema={canvasItems}
        previousSchema={diffBase || []}
      />

      {/* Generation History Panel */}
      <GenerationHistoryPanel open={showHistoryPanel} onClose={() => setShowHistoryPanel(false)} />

      {/* Database Manager Panel */}
      <DatabaseManagerPanel
        open={showDBManager}
        onClose={() => setShowDBManager(false)}
        onImportSchema={(tables) => {
          setCanvasItems(prev => [...prev, ...tables]);
          addToast(`Imported ${tables.length} tables from database`, "success");
        }}
      />

      {/* Query Builder Panel */}
      <QueryBuilderPanel
        open={showQueryBuilder}
        onClose={() => { setShowQueryBuilder(false); setPlaygroundInitialSql(""); }}
        canvasItems={canvasItems}
        callAI={callAI}
        deployConnected={deployConnected}
        initialSql={playgroundInitialSql}
      />

      {/* Supabase Panel */}
      <SupabasePanel
        open={showSupabasePanel}
        onClose={() => setShowSupabasePanel(false)}
        canvasItems={canvasItems}
        onImportSchema={(tables, projectUrl) => {
          const importedTables = cloneTables(tables);
          setCanvasItems(prev => [...prev, ...importedTables]);
          setSupabaseBaseline({
            url: projectUrl,
            importedAt: new Date().toISOString(),
            tables: cloneTables(importedTables),
          });
          if (!deployUrl || deployUrl !== projectUrl) {
            setDeployUrl(projectUrl);
            setDeployConnected(false);
          }
          addToast(`Imported ${tables.length} tables from Supabase`, "success");
        }}
      />

      {/* SRE Mode Panel */}
      <SREModePanel
        open={showSREMode}
        onClose={() => setShowSREMode(false)}
        callAI={callAI}
      />

      {/* Ask Data Panel */}
      <AskDataPanel
        open={showAskData}
        onClose={() => setShowAskData(false)}
        canvasItems={canvasItems}
        callAI={callAI}
      />

      {/* AI Chat Panel */}
      <AIChatPanel
        open={showChatPanel}
        onClose={() => setShowChatPanel(false)}
        canvasItems={canvasItems}
        setCanvasItems={setCanvasItems}
        addToast={addToast}
        view={view}
        projectId={currentProjectId}
        onAddEnum={(e) => setSchemaEnums(prev => prev.some(x => x.name === e.name) ? prev : [...prev, e])}
        onAddFunction={(f) => setSchemaFunctions(prev => prev.some(x => x.name === f.name) ? prev : [...prev, f])}
        onApplySuggestion={handleApplySuggestion}
        onCreateDdlPatch={(patch) => {
          const created = addDdlPatch({ ...patch, source: "ai-chat" });
          if (created) addToast(`Added "${created.title}" — included in exported SQL`, "success");
        }}
      />

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${t.type === "success" ? "bg-accent text-accent-foreground" :
                t.type === "error" ? "bg-destructive text-destructive-foreground" :
                  t.type === "warning" ? "bg-primary/20 text-primary border border-primary/30" :
                    "bg-card text-card-foreground border border-border"
                }`}>
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default VibeDBPage;
