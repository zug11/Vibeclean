// ─── Shared Types for VibeDB ──────────────────────────

export interface Column {
  id: string;
  name: string;
  type: string;
  isForeignKey?: boolean;
  linkedTable?: string;
  linkedTableId?: string;
  linkedColumn?: string;
  fkStatus?: string;
  constraints?: { type: string; value?: string }[];
  description?: string;
}

export interface TableNode {
  id: string;
  name: string;
  columns: Column[];
  x: number;
  y: number;
  indexes?: { name: string; columns: string[]; type: string; unique: boolean; where?: string }[];
  checkConstraints?: { name: string; expression: string }[];
  description?: string;
  isReordering?: boolean;
  dataRows?: Record<string, string>[];
  importedData?: {
    headers: string[];
    rows: string[][];
  };
}

export interface SchemaEnum {
  name: string;
  values: string[];
}

export interface SchemaFunction {
  name: string;
  body: string;
}

export interface Project {
  id: string;
  name: string;
  definition: TableNode[];
  updated_at: string;
}

export interface AuditReport {
  score?: number;
  issues?: { severity: string; message: string }[];
  suggestions?: { type: string; target_table?: string; payload?: any; reason: string; description?: string }[];
  lintIssues?: { type: string; severity: string; message: string }[];
  fkIssues?: { type: string; severity: string; message: string }[];
  strengths?: string[];
  missing_elements?: string[];
  risks?: string[];
  confidence_score?: number;
}

export interface Toast {
  id: number;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

// ─── Compiler Pipeline Types ─────────────────────────

export interface CompilerAction {
  pass: string;           // "naming" | "check-constraint" | "fk-index" | "dedup" | "timestamp-default" | "semantic-constraint"
  table: string;
  description: string;    // Human-readable: "Renamed Users → users"
  before?: string;
  after?: string;
  severity?: "fix" | "warning";  // "warning" for non-auto-fixed issues (e.g. dual inventory)
}

export interface CompilerReport {
  actions: CompilerAction[];
  tablesProcessed: number;
  constraintsAdded: number;
  indexesAdded: number;
  namingFixes: number;
  constraintFixes: number;
  standardColumnFixes: number;
  durationMs: number;
}
