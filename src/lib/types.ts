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
  onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
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

export interface SupabaseBaseline {
  url: string;
  importedAt: string;
  tables: TableNode[];
}

export interface DDLPatch {
  id: string;
  title: string;
  description?: string;
  sql: string;
  source: "ai-chat" | "batch-edit" | "manual";
  status: "pending" | "applied";
  warnings: string[];
  createdAt: string;
  appliedAt?: string;
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
  supabaseBaseline?: SupabaseBaseline;
  ddlPatches?: DDLPatch[];
  updated_at: string;
}

// Payload carried by an AI audit suggestion. All fields optional — which ones
// are present depends on the suggestion `type` (add_enum, add_function,
// ddl_patch/sql_patch, …). Narrow before access.
export interface SuggestionPayload {
  name?: string;
  values?: string[];
  body?: string;
  sql?: string;
  ddl?: string;
  title?: string;
  description?: string;
}

export interface AuditReport {
  score?: number;
  issues?: { severity: string; message: string }[];
  suggestions?: { type: string; target_table?: string; payload?: SuggestionPayload; reason: string; description?: string }[];
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
  detectedDomains?: DomainDetectionResult[];
  typeUpgrades?: number;
  companionTableSuggestions?: CompanionTableSuggestion[];
  domainTriggers?: DomainTrigger[];
  domainRLSPolicies?: DomainRLSPolicy[];
}

// ─── Domain Module Types ──────────────────────────────

export type DomainId = "quant-finance" | "pe-vc" | "healthcare" | "none";

export interface DomainDetectionResult {
  domain: DomainId;
  confidence: number;
  matchedSignals: string[];
}

export interface TypeUpgrade {
  tableName: string;
  columnName: string;
  fromType: string;
  toType: string;
  reason: string;
}

export interface CompanionTableSuggestion {
  name: string;
  columns: { name: string; type: string; constraints?: { type: string; value?: string }[] }[];
  reason: string;
}

export interface DomainTrigger {
  functionName: string;
  triggerName: string;
  tableName: string;
  body: string;
  description: string;
}

export interface DomainRLSPolicy {
  tableName: string;
  policyName: string;
  sql: string;
  description: string;
}

// DomainModule interface — CheckRule/CrossColumnCheckRule are imported from compiler-pass.ts
// at the call site, not here (avoids circular dependency)
export interface DomainModule {
  id: DomainId;
  label: string;
  detect: (tables: TableNode[]) => DomainDetectionResult;
  checkRules: { pattern: (name: string, type: string) => boolean; expression: (colName: string) => string; label: string; category: "enum" | "range" | "format" | "length" }[];
  crossColumnCheckRules: { detect: (columns: { name: string; type: string }[]) => { col1: string; col2: string } | null; expression: (col1: string, col2: string) => string; constraintName: (tableName: string, col1: string, col2: string) => string; label: string }[];
  typeUpgrades: (tables: TableNode[]) => TypeUpgrade[];
  triggers: (tables: TableNode[]) => DomainTrigger[];
  companionTables: (tables: TableNode[]) => CompanionTableSuggestion[];
  rlsPolicies: (tables: TableNode[]) => DomainRLSPolicy[];
}
