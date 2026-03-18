// ─── Private Equity / Venture Capital Domain Module ───────
import type { TableNode, DomainModule, DomainDetectionResult, TypeUpgrade, DomainTrigger, CompanionTableSuggestion, DomainRLSPolicy } from "@/lib/types";
import type { CheckRule, CrossColumnCheckRule } from "@/lib/compiler-pass";

// ─── Detection Signals ───────────────────────────────────

const TABLE_SIGNALS = new Set([
  "funds", "fund_structures", "cap_table", "stakeholders", "investors",
  "investment_rounds", "share_classes", "distributions", "commitments",
  "capital_calls", "carried_interest", "portfolio_companies", "valuations",
  "nav", "spv", "feeder_fund", "master_fund", "limited_partners",
  "general_partners", "waterfall", "tranches", "fund_vehicles", "rounds",
  "investments", "lps", "gps", "carry", "vintages",
]);

const COLUMN_SIGNALS = new Set([
  "equity_percentage", "share_count", "ownership_pct", "committed_capital",
  "called_capital", "distributed_capital", "unrealized_value", "moic",
  "tvpi", "dpi", "rvpi", "irr", "hurdle_rate", "carried_interest_pct",
  "management_fee", "catch_up", "clawback", "vintage_year", "fund_size",
  "dry_powder", "seniority_level", "preference_stack", "liquidation_preference",
  "pre_money", "post_money", "share_price", "dilution", "fair_value",
]);

function detect(tables: TableNode[]): DomainDetectionResult {
  const signals: string[] = [];
  for (const t of tables) {
    const tName = t.name.toLowerCase();
    if (TABLE_SIGNALS.has(tName)) signals.push(`table:${tName}`);
    for (const c of t.columns) {
      const cName = c.name.toLowerCase();
      if (COLUMN_SIGNALS.has(cName)) signals.push(`column:${tName}.${cName}`);
    }
  }
  const maxSignals = tables.length * 3;
  const confidence = maxSignals > 0 ? Math.min(signals.length / maxSignals, 1) : 0;
  return { domain: "pe-vc", confidence, matchedSignals: signals };
}

// ─── CHECK Rules ─────────────────────────────────────────

const checkRules: CheckRule[] = [
  { pattern: (n) => n === "equity_percentage" || n === "ownership_pct", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "ownership percentage [0,100]", category: "range" },
  { pattern: (n) => n === "committed_capital", expression: (c) => `${c} >= 0`, label: "non-negative committed capital", category: "range" },
  { pattern: (n) => n === "called_capital", expression: (c) => `${c} >= 0`, label: "non-negative called capital", category: "range" },
  { pattern: (n) => n === "distributed_capital", expression: (c) => `${c} >= 0`, label: "non-negative distributed capital", category: "range" },
  { pattern: (n) => n === "moic", expression: (c) => `${c} >= 0`, label: "non-negative MOIC", category: "range" },
  { pattern: (n) => n === "tvpi", expression: (c) => `${c} >= 0`, label: "non-negative TVPI", category: "range" },
  { pattern: (n) => n === "dpi", expression: (c) => `${c} >= 0`, label: "non-negative DPI", category: "range" },
  { pattern: (n) => n === "rvpi", expression: (c) => `${c} >= 0`, label: "non-negative RVPI", category: "range" },
  { pattern: (n) => n === "hurdle_rate", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "hurdle rate percentage", category: "range" },
  { pattern: (n) => n === "carried_interest_pct", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "carry percentage [0,100]", category: "range" },
  { pattern: (n) => n === "management_fee", expression: (c) => `${c} >= 0 AND ${c} <= 10`, label: "management fee [0,10]%", category: "range" },
  { pattern: (n) => n === "catch_up", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "catch-up percentage", category: "range" },
  { pattern: (n) => n === "vintage_year", expression: (c) => `${c} >= 1900 AND ${c} <= 2100`, label: "vintage year range", category: "range" },
  { pattern: (n) => n === "fund_size" || n === "dry_powder", expression: (c) => `${c} >= 0`, label: "non-negative fund metric", category: "range" },
  { pattern: (n) => n === "seniority_level" || n === "preference_stack", expression: (c) => `${c} >= 1`, label: "positive seniority", category: "range" },
  { pattern: (n) => n === "liquidation_preference", expression: (c) => `${c} >= 0`, label: "non-negative liquidation preference", category: "range" },
  { pattern: (n) => n === "share_count", expression: (c) => `${c} >= 0`, label: "non-negative share count", category: "range" },
  { pattern: (n) => n === "dilution", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "dilution percentage", category: "range" },
  { pattern: (n) => n === "fund_status", expression: (c) => `${c} IN ('fundraising', 'investing', 'harvesting', 'liquidating', 'closed')`, label: "fund status enum", category: "enum" },
  { pattern: (n) => n === "round_type", expression: (c) => `${c} IN ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d', 'bridge', 'growth', 'ipo')`, label: "round type enum", category: "enum" },
];

const crossColumnCheckRules: CrossColumnCheckRule[] = [
  {
    detect: (cols) => {
      const called = cols.find(c => c.name === "called_capital");
      const committed = cols.find(c => c.name === "committed_capital");
      return called && committed ? { col1: called.name, col2: committed.name } : null;
    },
    expression: (c1, c2) => `${c1} <= ${c2}`,
    constraintName: (t) => `chk_${t}_called_lte_committed`,
    label: "called capital <= committed capital",
  },
];

// ─── Type Upgrades ───────────────────────────────────────

function typeUpgrades(tables: TableNode[]): TypeUpgrade[] {
  const upgrades: TypeUpgrade[] = [];
  const financialCols = new Set(["committed_capital", "called_capital", "distributed_capital", "fund_size", "dry_powder", "fair_value", "pre_money", "post_money", "share_price", "liquidation_preference", "unrealized_value"]);
  for (const t of tables) {
    for (const col of t.columns) {
      const lower = col.type.toLowerCase();
      const cName = col.name.toLowerCase();
      if ((lower === "float" || lower === "real" || lower === "double precision") && financialCols.has(cName)) {
        upgrades.push({ tableName: t.name, columnName: col.name, fromType: col.type, toType: "numeric", reason: "financial precision for fund metrics" });
      }
    }
  }
  return upgrades;
}

// ─── Triggers ────────────────────────────────────────────

function triggers(tables: TableNode[]): DomainTrigger[] {
  const result: DomainTrigger[] = [];
  // Cap table integrity: SUM(equity_percentage) <= 100 per entity
  for (const t of tables) {
    const ownershipCol = t.columns.find(c => c.name.toLowerCase() === "equity_percentage" || c.name.toLowerCase() === "ownership_pct");
    const entityCol = t.columns.find(c => c.isForeignKey && c.name.toLowerCase().includes("fund") || c.name.toLowerCase().includes("company") || c.name.toLowerCase().includes("entity"));
    if (ownershipCol && entityCol) {
      const fnName = `fn_check_cap_table_${t.name}`;
      const trgName = `trg_check_cap_table_${t.name}`;
      result.push({
        functionName: fnName, triggerName: trgName, tableName: t.name,
        description: `Validates total ${ownershipCol.name} per ${entityCol.name} does not exceed 100%`,
        body: `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS TRIGGER AS $$\nDECLARE\n  total numeric;\nBEGIN\n  SELECT COALESCE(SUM(${ownershipCol.name}), 0) INTO total\n  FROM ${t.name}\n  WHERE ${entityCol.name} = NEW.${entityCol.name};\n  IF total > 100.00 THEN\n    RAISE EXCEPTION 'Cap table integrity violation: total ownership for % is %%, exceeds 100%%', NEW.${entityCol.name}, total;\n  END IF;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nDO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${trgName}') THEN\n    CREATE TRIGGER ${trgName} AFTER INSERT OR UPDATE ON ${t.name} FOR EACH ROW EXECUTE FUNCTION ${fnName}();\n  END IF;\nEND $$;`,
      });
    }
  }
  return result;
}

// ─── Companion Tables ────────────────────────────────────

function companionTables(tables: TableNode[]): CompanionTableSuggestion[] {
  const result: CompanionTableSuggestion[] = [];
  const names = new Set(tables.map(t => t.name.toLowerCase()));
  // Suggest fund_performance_history if valuations exist
  if (names.has("valuations") && !names.has("fund_performance_history")) {
    result.push({
      name: "fund_performance_history",
      columns: [
        { name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "default", value: "gen_random_uuid()" }] },
        { name: "fund_id", type: "uuid", constraints: [{ type: "notNull" }] },
        { name: "snapshot_date", type: "date", constraints: [{ type: "notNull" }] },
        { name: "nav", type: "numeric", constraints: [{ type: "notNull" }] },
        { name: "irr", type: "numeric" },
        { name: "tvpi", type: "numeric" },
        { name: "dpi", type: "numeric" },
        { name: "rvpi", type: "numeric" },
        { name: "created_at", type: "timestamptz", constraints: [{ type: "notNull" }, { type: "default", value: "now()" }] },
      ],
      reason: "Time-series fund performance tracking (IRR/TVPI snapshots)",
    });
  }
  return result;
}

// ─── RLS Policies ────────────────────────────────────────

function rlsPolicies(tables: TableNode[]): DomainRLSPolicy[] {
  const result: DomainRLSPolicy[] = [];
  const names = new Set(tables.map(t => t.name.toLowerCase()));
  // LP-scoped access to commitments and distributions
  for (const t of tables) {
    const tName = t.name.toLowerCase();
    if ((tName === "commitments" || tName === "distributions" || tName === "capital_calls") && t.columns.some(c => c.name.toLowerCase() === "investor_id" || c.name.toLowerCase() === "lp_id")) {
      const idCol = t.columns.find(c => c.name.toLowerCase() === "investor_id" || c.name.toLowerCase() === "lp_id")!;
      result.push({
        tableName: t.name, policyName: `lp_scope_${t.name}`,
        description: `LPs see only their own ${t.name}; GP staff see fund-level`,
        sql: `ALTER TABLE ${t.name} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "lp_scope_${t.name}" ON ${t.name}\n  FOR SELECT\n  USING (\n    ${idCol.name} = auth.uid()\n    OR auth.jwt() ->> 'role' IN ('gp', 'fund_admin', 'admin')\n  );`,
      });
    }
    // Carry tables restricted to fund admins
    if (tName === "carried_interest" || tName === "carry") {
      result.push({
        tableName: t.name, policyName: `admin_only_${t.name}`,
        description: `${t.name} restricted to fund administrators`,
        sql: `ALTER TABLE ${t.name} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "admin_only_${t.name}" ON ${t.name}\n  FOR ALL\n  USING (auth.jwt() ->> 'role' IN ('fund_admin', 'admin'));`,
      });
    }
  }
  return result;
}

// ─── Export ──────────────────────────────────────────────

export const peVcModule: DomainModule = {
  id: "pe-vc",
  label: "Private Equity / VC",
  detect,
  checkRules,
  crossColumnCheckRules,
  typeUpgrades,
  triggers,
  companionTables,
  rlsPolicies,
};
