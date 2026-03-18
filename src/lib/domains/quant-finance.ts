// ─── Quant Finance Domain Module ──────────────────────────
import type { TableNode, DomainModule, DomainDetectionResult, TypeUpgrade, DomainTrigger, CompanionTableSuggestion, DomainRLSPolicy } from "@/lib/types";
import type { CheckRule, CrossColumnCheckRule } from "@/lib/compiler-pass";

// ─── Detection Signals ───────────────────────────────────

const TABLE_SIGNALS = new Set([
  "trades", "orders", "order_book", "positions", "portfolios", "instruments",
  "securities", "tickers", "market_data", "fx_rates", "options", "futures",
  "swaps", "risk_metrics", "greeks", "option_greeks", "option_contracts",
  "option_market_data", "volatility_surfaces", "spot_prices", "quotes",
  "bars", "ohlcv", "yield_curves", "risk_limits", "exercise_events",
  "option_strategies", "strategy_legs", "counterparties",
]);

const COLUMN_SIGNALS = new Set([
  "bid_price", "ask_price", "bid", "ask", "strike_price", "strike",
  "notional", "notional_value", "ticker", "isin", "cusip", "settlement_date",
  "trade_date", "nav", "aum", "pnl", "unrealized_pnl", "realized_pnl",
  "delta", "gamma", "vega", "theta", "rho", "vanna", "charm", "volga",
  "implied_volatility", "historical_volatility", "volatility",
  "sharpe_ratio", "sharpe", "max_drawdown", "drawdown",
  "open_interest", "lot_size", "tick_size", "premium", "premium_per_unit",
  "underlying_price", "spot_price", "moneyness", "days_to_expiry",
  "risk_free_rate", "calibration_error", "leverage", "margin_requirement",
  "open_price", "high_price", "low_price", "close_price", "settlement_price",
  "mid_price", "intrinsic_value", "time_value",
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
  return { domain: "quant-finance", confidence, matchedSignals: signals };
}

// ─── CHECK Rules ─────────────────────────────────────────

const checkRules: CheckRule[] = [
  { pattern: (n) => n === "strike_price" || n === "strike", expression: (c) => `${c} >= 0`, label: "non-negative strike", category: "range" },
  { pattern: (n) => n === "delta", expression: (c) => `${c} >= -1 AND ${c} <= 1`, label: "delta range [-1,1]", category: "range" },
  { pattern: (n) => n === "gamma", expression: (c) => `${c} >= 0`, label: "non-negative gamma", category: "range" },
  { pattern: (n) => n === "vega", expression: (c) => `${c} >= 0`, label: "non-negative vega", category: "range" },
  { pattern: (n) => n === "implied_volatility" || n === "implied_vol", expression: (c) => `${c} >= 0 AND ${c} <= 10`, label: "implied vol range [0,10]", category: "range" },
  { pattern: (n) => n === "historical_volatility", expression: (c) => `${c} >= 0`, label: "non-negative historical vol", category: "range" },
  { pattern: (n) => n === "notional" || n === "notional_value", expression: (c) => `${c} >= 0`, label: "non-negative notional", category: "range" },
  { pattern: (n) => n === "premium" || n === "premium_per_unit" || n === "total_premium", expression: (c) => `${c} >= 0`, label: "non-negative premium", category: "range" },
  { pattern: (n) => n === "open_interest", expression: (c) => `${c} >= 0`, label: "non-negative open interest", category: "range" },
  { pattern: (n) => n === "lot_size", expression: (c) => `${c} >= 1`, label: "positive lot size", category: "range" },
  { pattern: (n) => n === "tick_size", expression: (c) => `${c} > 0`, label: "positive tick size", category: "range" },
  { pattern: (n) => n === "leverage", expression: (c) => `${c} >= 0`, label: "non-negative leverage", category: "range" },
  { pattern: (n) => n === "margin_requirement", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "margin requirement %", category: "range" },
  { pattern: (n) => n === "risk_free_rate", expression: (c) => `${c} >= -0.1 AND ${c} <= 0.5`, label: "risk-free rate range", category: "range" },
  { pattern: (n) => n === "calibration_error", expression: (c) => `${c} >= 0`, label: "non-negative calibration error", category: "range" },
  { pattern: (n) => n === "drawdown" || n === "max_drawdown", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "drawdown percentage", category: "range" },
  { pattern: (n) => n === "days_to_expiry", expression: (c) => `${c} >= 0`, label: "non-negative days to expiry", category: "range" },
  { pattern: (n) => n === "moneyness", expression: (c) => `${c} IN ('ITM', 'ATM', 'OTM', 'DITM', 'DOTM')`, label: "moneyness enum", category: "enum" },
  { pattern: (n) => n === "side", expression: (c) => `${c} IN ('BUY', 'SELL')`, label: "trade side enum", category: "enum" },
  { pattern: (n) => n === "trade_type", expression: (c) => `${c} IN ('OUTRIGHT', 'SPREAD', 'STRATEGY', 'BLOCK', 'EXCHANGE')`, label: "trade type enum", category: "enum" },
  { pattern: (n) => n === "exercise_style", expression: (c) => `${c} IN ('AMERICAN', 'EUROPEAN', 'ASIAN', 'BERMUDAN')`, label: "exercise style enum", category: "enum" },
  { pattern: (n) => n === "option_type", expression: (c) => `${c} IN ('CALL', 'PUT')`, label: "option type enum", category: "enum" },
  { pattern: (n) => n === "settlement_type", expression: (c) => `${c} IN ('PHYSICAL', 'CASH', 'FUTURES')`, label: "settlement type enum", category: "enum" },
  { pattern: (n) => n === "pricing_model", expression: (c) => `${c} IN ('BLACK_SCHOLES', 'BLACK76', 'BINOMIAL', 'MONTE_CARLO', 'HESTON', 'SABR')`, label: "pricing model enum", category: "enum" },
];

const crossColumnCheckRules: CrossColumnCheckRule[] = [
  {
    detect: (cols) => {
      const bid = cols.find(c => c.name === "bid_price" || c.name === "bid");
      const ask = cols.find(c => c.name === "ask_price" || c.name === "ask");
      return bid && ask ? { col1: bid.name, col2: ask.name } : null;
    },
    expression: (c1, c2) => `${c2} >= ${c1}`,
    constraintName: (t, c1, c2) => `chk_${t}_${c1}_lte_${c2}`,
    label: "bid <= ask spread validity",
  },
  {
    detect: (cols) => {
      const high = cols.find(c => c.name === "high_price");
      const low = cols.find(c => c.name === "low_price");
      return high && low ? { col1: low.name, col2: high.name } : null;
    },
    expression: (c1, c2) => `${c2} >= ${c1}`,
    constraintName: (t, c1, c2) => `chk_${t}_${c1}_lte_${c2}`,
    label: "high >= low price",
  },
];

// ─── Type Upgrades ───────────────────────────────────────

function typeUpgrades(tables: TableNode[]): TypeUpgrade[] {
  const upgrades: TypeUpgrade[] = [];
  const monetaryPatterns = ["_price", "_amount", "_notional", "_pnl", "_nav", "_premium", "_value"];
  for (const t of tables) {
    for (const col of t.columns) {
      const lower = col.type.toLowerCase();
      const cName = col.name.toLowerCase();
      // timestamp → timestamptz for cross-timezone trading
      if (lower === "timestamp" && (cName.endsWith("_at") || cName.endsWith("_time") || cName.endsWith("_date") || cName === "quote_timestamp")) {
        upgrades.push({ tableName: t.name, columnName: col.name, fromType: col.type, toType: "timestamptz", reason: "cross-timezone trading precision" });
      }
      // float → numeric for financial precision
      if ((lower === "float" || lower === "real" || lower === "double precision") && monetaryPatterns.some(p => cName.includes(p))) {
        upgrades.push({ tableName: t.name, columnName: col.name, fromType: col.type, toType: "numeric", reason: "financial precision (avoid floating-point rounding)" });
      }
    }
  }
  return upgrades;
}

// ─── Triggers ────────────────────────────────────────────

function triggers(tables: TableNode[]): DomainTrigger[] {
  const result: DomainTrigger[] = [];
  // Bid ≤ Ask defense-in-depth trigger on any table with both columns
  for (const t of tables) {
    const bid = t.columns.find(c => c.name.toLowerCase() === "bid_price" || c.name.toLowerCase() === "bid");
    const ask = t.columns.find(c => c.name.toLowerCase() === "ask_price" || c.name.toLowerCase() === "ask");
    if (bid && ask) {
      const fnName = `fn_check_bid_ask_${t.name}`;
      const trgName = `trg_check_bid_ask_${t.name}`;
      result.push({
        functionName: fnName, triggerName: trgName, tableName: t.name,
        description: `Validates ${bid.name} <= ${ask.name} on ${t.name}`,
        body: `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS TRIGGER AS $$\nBEGIN\n  IF NEW.${bid.name} > NEW.${ask.name} THEN\n    RAISE EXCEPTION 'Bid-ask spread violation on ${t.name}: bid (%) > ask (%)', NEW.${bid.name}, NEW.${ask.name};\n  END IF;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nDO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${trgName}') THEN\n    CREATE TRIGGER ${trgName} BEFORE INSERT OR UPDATE ON ${t.name} FOR EACH ROW EXECUTE FUNCTION ${fnName}();\n  END IF;\nEND $$;`,
      });
    }
  }
  return result;
}

// ─── Companion Tables ────────────────────────────────────

function companionTables(tables: TableNode[]): CompanionTableSuggestion[] {
  const result: CompanionTableSuggestion[] = [];
  const names = new Set(tables.map(t => t.name.toLowerCase()));
  // Suggest audit_trail if trades exist without audit
  if (names.has("trades") && !names.has("audit_logs") && !names.has("audit_trail")) {
    result.push({
      name: "audit_trail",
      columns: [
        { name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "default", value: "gen_random_uuid()" }] },
        { name: "trader_id", type: "uuid", constraints: [{ type: "notNull" }] },
        { name: "action", type: "varchar", constraints: [{ type: "notNull" }] },
        { name: "entity_type", type: "varchar", constraints: [{ type: "notNull" }] },
        { name: "entity_id", type: "uuid", constraints: [{ type: "notNull" }] },
        { name: "old_values", type: "jsonb" },
        { name: "new_values", type: "jsonb" },
        { name: "created_at", type: "timestamptz", constraints: [{ type: "notNull" }, { type: "default", value: "now()" }] },
      ],
      reason: "Trade audit trail for regulatory compliance",
    });
  }
  return result;
}

// ─── RLS Policies ────────────────────────────────────────

function rlsPolicies(tables: TableNode[]): DomainRLSPolicy[] {
  const result: DomainRLSPolicy[] = [];
  for (const t of tables) {
    const tName = t.name.toLowerCase();
    const hasTrader = t.columns.some(c => c.name.toLowerCase() === "trader_id");
    // Trader-scoped access for positions and trades
    if (hasTrader && (tName === "trades" || tName === "positions")) {
      result.push({
        tableName: t.name, policyName: `trader_scope_${t.name}`,
        description: `Traders see only their own ${t.name}; desk heads see desk; admins see all`,
        sql: `ALTER TABLE ${t.name} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "trader_scope_${t.name}" ON ${t.name}\n  FOR ALL\n  USING (\n    trader_id = auth.uid()\n    OR auth.jwt() ->> 'role' IN ('desk_head', 'risk_manager', 'compliance', 'admin')\n  );`,
      });
    }
    // Market data is read-only for all authenticated
    if (tName === "market_data" || tName === "spot_prices" || tName === "option_market_data") {
      result.push({
        tableName: t.name, policyName: `readonly_${t.name}`,
        description: `${t.name} is read-only for all authenticated users`,
        sql: `ALTER TABLE ${t.name} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "readonly_${t.name}" ON ${t.name}\n  FOR SELECT\n  USING (auth.role() = 'authenticated');`,
      });
    }
  }
  return result;
}

// ─── Export ──────────────────────────────────────────────

export const quantFinanceModule: DomainModule = {
  id: "quant-finance",
  label: "Quant Finance",
  detect,
  checkRules,
  crossColumnCheckRules: crossColumnCheckRules,
  typeUpgrades,
  triggers,
  companionTables,
  rlsPolicies,
};
