// Feature: Cross-Database Query Builder Panel with NL Analysis
import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Play, Loader2, Copy, Check, Clock, Trash2, Database, Sparkles, ChevronDown, ChevronRight, MessageCircle, Zap } from "lucide-react";
import type { TableNode } from "@/lib/types";
import { DatabaseConnectionStore, type DatabaseConnection, executeQuery, executeSupabaseQuery } from "@/lib/database-connection";

// ─── Types ───────────────────────────────────────────────

interface QueryBuilderPanelProps {
  open: boolean;
  onClose: () => void;
  canvasItems: TableNode[];
  callAI: (type: string, prompt: string, context?: string) => Promise<string>;
  deployConnected?: boolean;
}

interface QueryHistoryEntry {
  id: string;
  query: string;
  timestamp: number;
  rowCount: number | null;
  connectionName: string | null;
  error?: string;
}

// ─── Constants ───────────────────────────────────────────

const HISTORY_KEY = "vibedb_query_history";
const MAX_HISTORY = 50;

// ─── History Helpers ─────────────────────────────────────

function readHistory(): QueryHistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: QueryHistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

function addHistoryEntry(entry: QueryHistoryEntry): void {
  const entries = readHistory();
  entries.unshift(entry);
  if (entries.length > MAX_HISTORY) entries.length = MAX_HISTORY;
  writeHistory(entries);
}

// ─── Formatting Helpers ──────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

function cellDisplay(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ─── Component ───────────────────────────────────────────

const QueryBuilderPanel: React.FC<QueryBuilderPanelProps> = ({
  open,
  onClose,
  canvasItems,
  callAI,
  deployConnected,
}) => {
  // Editor state
  const [query, setQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Connection state
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [connectionType, setConnectionType] = useState<"none" | "supabase" | "external">("none");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [password, setPassword] = useState("");
  const [showConnectionDropdown, setShowConnectionDropdown] = useState(false);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [resultColumns, setResultColumns] = useState<string[]>([]);
  const [resultRows, setResultRows] = useState<any[]>([]);
  const [resultRowCount, setResultRowCount] = useState<number | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultDurationMs, setResultDurationMs] = useState<number | null>(null);

  // AI generate state
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // NL Analysis state ("Ask Data")
  const [nlQuestion, setNlQuestion] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisSQL, setAnalysisSQL] = useState<string | null>(null);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const [showAnalysisSQL, setShowAnalysisSQL] = useState(false);

  // Copy state
  const [copied, setCopied] = useState(false);

  // History state
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Dropdown ref for outside click
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check if Supabase deploy is available
  const hasSupabaseCredentials =
    !!localStorage.getItem("vibedb_deploy_url") && !!localStorage.getItem("vibedb_deploy_key");

  const canExecute =
    connectionType === "supabase" ||
    (connectionType === "external" && !!connections.find((c) => c.id === selectedConnectionId));

  // Load connections and history when panel opens
  useEffect(() => {
    if (open) {
      setConnections(DatabaseConnectionStore.list());
      setHistory(readHistory());
      // Auto-select Supabase if deploy is configured
      if (hasSupabaseCredentials && connectionType === "none") {
        setConnectionType("supabase");
      }
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowConnectionDropdown(false);
      }
    }
    if (showConnectionDropdown) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showConnectionDropdown]);

  // Build schema context from canvas items
  const buildSchemaContext = (): string => {
    if (canvasItems.length === 0) return "";
    return canvasItems
      .map((t) => {
        const cols = t.columns
          .map((c) => {
            let s = `${c.name}:${c.type}`;
            if (c.constraints?.some((x) => x.type === "primary")) s += " PK";
            if (c.isForeignKey && c.linkedTable) s += ` FK->${c.linkedTable}`;
            return s;
          })
          .join(", ");
        return `${t.name}(${cols})`;
      })
      .join("\n");
  };

  // Get selected connection object
  const selectedConnection = connections.find((c) => c.id === selectedConnectionId) || null;

  // Connection display name
  const connectionDisplayName = (): string => {
    if (connectionType === "supabase") {
      const url = localStorage.getItem("vibedb_deploy_url") || "";
      // Extract project name from URL
      const match = url.match(/https?:\/\/([^.]+)/);
      return `Supabase (${match ? match[1] : "Connected"})`;
    }
    if (connectionType === "external" && selectedConnection) {
      return selectedConnection.name;
    }
    return "(No connection)";
  };

  // ─── Execute Query ──────────────────────────────────────

  const handleExecute = async () => {
    const sql = query.trim();
    if (!sql || isExecuting || !canExecute) return;

    setIsExecuting(true);
    setResultError(null);
    setResultColumns([]);
    setResultRows([]);
    setResultRowCount(null);
    setResultDurationMs(null);

    const start = performance.now();

    try {
      let result: { columns: string[]; rows: any[]; rowCount: number };

      if (connectionType === "supabase") {
        result = await executeSupabaseQuery(sql);
      } else {
        result = await executeQuery(selectedConnection!, password, sql);
      }

      const durationMs = Math.round(performance.now() - start);
      setResultColumns(result.columns);
      setResultRows(result.rows);
      setResultRowCount(result.rowCount);
      setResultDurationMs(durationMs);

      // Add to history
      const entry: QueryHistoryEntry = {
        id: crypto.randomUUID?.() || String(Date.now()),
        query: sql,
        timestamp: Date.now(),
        rowCount: result.rowCount,
        connectionName: connectionDisplayName(),
      };
      addHistoryEntry(entry);
      setHistory(readHistory());
    } catch (e: any) {
      const durationMs = Math.round(performance.now() - start);
      setResultDurationMs(durationMs);
      setResultError(e.message || "Query execution failed");

      // Add error to history
      const entry: QueryHistoryEntry = {
        id: crypto.randomUUID?.() || String(Date.now()),
        query: sql,
        timestamp: Date.now(),
        rowCount: null,
        connectionName: connectionDisplayName(),
        error: e.message,
      };
      addHistoryEntry(entry);
      setHistory(readHistory());
    } finally {
      setIsExecuting(false);
    }
  };

  // ─── AI Generate ────────────────────────────────────────

  const handleAIGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || isGenerating) return;

    setIsGenerating(true);
    try {
      const schemaContext = buildSchemaContext();
      const result = await callAI("generate-query", prompt, schemaContext || undefined);
      // Strip markdown code fences if present
      const cleaned = result
        .replace(/```sql\n?/gi, "")
        .replace(/```\n?/g, "")
        .trim();
      setQuery(cleaned);
      setAiPrompt("");
      textareaRef.current?.focus();
    } catch (e: any) {
      setResultError(`AI generation failed: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Ask Data (NL Analysis Pipeline) ────────────────────

  const handleAskData = async () => {
    const question = nlQuestion.trim();
    if (!question || isAnalyzing || !canExecute) return;

    setIsAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisSQL(null);
    setAnalysisStep("Generating SQL from your question...");
    setShowAnalysisSQL(false);

    try {
      // Step 1: Generate SQL from NL question
      const schemaContext = buildSchemaContext();
      const generatedSQL = await callAI("generate-query", question, schemaContext || undefined);
      const cleanedSQL = generatedSQL
        .replace(/```sql\n?/gi, "")
        .replace(/```\n?/g, "")
        .trim();
      setAnalysisSQL(cleanedSQL);
      setAnalysisStep("Executing query against database...");

      // Step 2: Execute the SQL
      let resultData: { columns: string[]; rows: any[]; rowCount: number };
      if (connectionType === "supabase") {
        resultData = await executeSupabaseQuery(cleanedSQL);
      } else {
        resultData = await executeQuery(selectedConnection!, password, cleanedSQL);
      }

      setAnalysisStep(`Analyzing ${resultData.rowCount} rows with AI...`);

      // Step 3: Send question + results to AI for natural language analysis
      // Truncate results to avoid token overflow
      const truncatedResults = JSON.stringify(resultData.rows.slice(0, 500)).substring(0, 60000);
      const analysisContext = [
        schemaContext ? `Schema:\n${schemaContext}` : "",
        `\nSQL Executed:\n${cleanedSQL}`,
        `\nResults (${resultData.rowCount} row${resultData.rowCount === 1 ? "" : "s"}):\n${truncatedResults}`,
        resultData.rowCount > 500 ? `\n(showing first 500 of ${resultData.rowCount} rows)` : "",
      ].join("");

      const analysis = await callAI("analyze-data", question, analysisContext);
      setAnalysisResult(analysis);
      setAnalysisStep(null);

      // Also show raw results in the results section
      setResultColumns(resultData.columns);
      setResultRows(resultData.rows);
      setResultRowCount(resultData.rowCount);
    } catch (e: any) {
      setAnalysisResult(`Analysis failed: ${e.message}`);
      setAnalysisStep(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── Copy Query ─────────────────────────────────────────

  const handleCopy = async () => {
    if (!query.trim()) return;
    try {
      await navigator.clipboard.writeText(query);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  // ─── Restore from History ───────────────────────────────

  const handleRestoreFromHistory = (entry: QueryHistoryEntry) => {
    setQuery(entry.query);
    setShowHistory(false);
    textareaRef.current?.focus();
  };

  // ─── Clear History ──────────────────────────────────────

  const handleClearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  };

  // ─── Handle keyboard shortcut in textarea ───────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter to execute
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleExecute();
    }
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ x: 500 }}
      animate={{ x: 0 }}
      exit={{ x: 500 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed right-0 top-0 z-50 flex h-full w-[500px] flex-col border-l border-border bg-card shadow-2xl"
    >
      {/* ─── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
            <Database size={14} className="text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Query Builder</h3>
            <p className="text-[10px] text-muted-foreground">
              {canExecute ? connectionDisplayName() : "Write & execute SQL queries"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-secondary transition"
        >
          <X size={14} />
        </button>
      </div>

      {/* ─── Scrollable Body ────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* ─── Connection Selector ─────────────────────── */}
        <div className="px-4 pt-3 pb-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Connection
          </label>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowConnectionDropdown(!showConnectionDropdown)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-xs hover:border-accent/40 transition"
            >
              <span className={canExecute ? "text-foreground flex items-center gap-1.5" : "text-muted-foreground"}>
                {connectionType === "supabase" && (
                  <Zap size={10} className="text-emerald-500" />
                )}
                {canExecute ? connectionDisplayName() : "(No connection - preview only)"}
              </span>
              <ChevronDown size={12} className="text-muted-foreground" />
            </button>

            {showConnectionDropdown && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                <button
                  onClick={() => {
                    setConnectionType("none");
                    setSelectedConnectionId("");
                    setPassword("");
                    setShowConnectionDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-secondary transition ${
                    connectionType === "none" ? "bg-secondary text-foreground" : "text-muted-foreground"
                  }`}
                >
                  (No connection - preview only)
                </button>

                {/* Supabase option */}
                {hasSupabaseCredentials && (
                  <button
                    onClick={() => {
                      setConnectionType("supabase");
                      setSelectedConnectionId("");
                      setPassword("");
                      setShowConnectionDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-secondary transition flex items-center gap-2 ${
                      connectionType === "supabase" ? "bg-secondary text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Zap size={10} className="shrink-0 text-emerald-500" />
                    <span>Supabase (Deploy Connection)</span>
                    <span className="ml-auto text-[10px] text-emerald-500">Ready</span>
                  </button>
                )}

                {/* External connections */}
                {connections.map((conn) => (
                  <button
                    key={conn.id}
                    onClick={() => {
                      setConnectionType("external");
                      setSelectedConnectionId(conn.id);
                      setPassword("");
                      setShowConnectionDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-secondary transition flex items-center gap-2 ${
                      connectionType === "external" && selectedConnectionId === conn.id ? "bg-secondary text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Database size={10} className="shrink-0" />
                    <span className="truncate">{conn.name}</span>
                    <span className="ml-auto text-[10px] opacity-60">
                      {conn.host}:{conn.port}
                    </span>
                  </button>
                ))}
                {connections.length === 0 && !hasSupabaseCredentials && (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">
                    No connections available. Set up Supabase deploy or add a connection in DB Manager.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Password field when external connection selected */}
          {connectionType === "external" && selectedConnection && (
            <div className="mt-2">
              <input
                type="password"
                placeholder="Password for this session..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-accent transition placeholder:text-muted-foreground"
              />
            </div>
          )}

          {/* Supabase info */}
          {connectionType === "supabase" && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              <Zap size={10} />
              Connected via Supabase deploy — no password needed
            </div>
          )}
        </div>

        {/* ─── Ask Data (NL Analysis) ───────────────────── */}
        <div className="px-4 pt-2 pb-3 border-t border-border">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <MessageCircle size={10} />
            Ask Data
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ask about your data in plain English..."
              value={nlQuestion}
              onChange={(e) => setNlQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAskData();
                }
              }}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-accent transition placeholder:text-muted-foreground"
            />
            <button
              onClick={handleAskData}
              disabled={!nlQuestion.trim() || isAnalyzing || !canExecute}
              className="flex items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 py-2 text-[11px] font-bold hover:bg-accent/90 active:scale-95 transition disabled:opacity-40"
              title={!canExecute ? "Connect to a database first" : "Ask"}
            >
              {isAnalyzing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              Ask
            </button>
          </div>
          {!canExecute && (
            <p className="text-[9px] text-muted-foreground mt-1.5">
              Connect to a database to ask questions about your data
            </p>
          )}

          {/* Analysis Step Indicator */}
          {analysisStep && (
            <div className="mt-2 flex items-center gap-2 text-xs text-accent">
              <Loader2 size={12} className="animate-spin" />
              {analysisStep}
            </div>
          )}

          {/* Analysis Result */}
          {analysisResult && (
            <div className="mt-3 space-y-2">
              {/* Show generated SQL (collapsible) */}
              {analysisSQL && (
                <button
                  onClick={() => setShowAnalysisSQL(!showAnalysisSQL)}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition"
                >
                  {showAnalysisSQL ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  Generated SQL
                </button>
              )}
              {showAnalysisSQL && analysisSQL && (
                <pre className="rounded-lg bg-background border border-border p-2.5 text-[10px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                  {analysisSQL}
                </pre>
              )}

              {/* NL Analysis */}
              <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                {analysisResult}
              </div>
            </div>
          )}
        </div>

        {/* ─── SQL Editor ──────────────────────────────── */}
        <div className="px-4 pt-2 pb-2 border-t border-border">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              SQL Query
            </label>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                disabled={!query.trim()}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground transition disabled:opacity-30"
                title="Copy query"
              >
                {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="SELECT * FROM users WHERE ..."
            rows={6}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-xs outline-none focus:border-accent transition font-mono leading-relaxed placeholder:text-muted-foreground custom-scrollbar"
            spellCheck={false}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleExecute}
              disabled={!query.trim() || isExecuting || !canExecute}
              className="flex items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 py-1.5 text-[11px] font-bold hover:bg-accent/90 active:scale-95 transition disabled:opacity-40"
              title={!canExecute ? "Connect to a database to execute queries" : "Execute (Cmd+Enter)"}
            >
              {isExecuting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              Execute
            </button>
            {!canExecute && (
              <span className="text-[10px] text-muted-foreground">
                Select a connection above to execute
              </span>
            )}
            {resultDurationMs !== null && !isExecuting && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                {resultDurationMs}ms
              </span>
            )}
          </div>
        </div>

        {/* ─── AI Generate ─────────────────────────────── */}
        <div className="px-4 pt-2 pb-3 border-t border-border">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
            AI Generate SQL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Describe the query in plain English..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAIGenerate();
                }
              }}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-accent transition placeholder:text-muted-foreground"
            />
            <button
              onClick={handleAIGenerate}
              disabled={!aiPrompt.trim() || isGenerating}
              className="flex items-center gap-1.5 rounded-lg bg-secondary text-secondary-foreground px-3 py-2 text-[11px] font-bold hover:bg-secondary/80 active:scale-95 transition disabled:opacity-40"
            >
              {isGenerating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              Generate
            </button>
          </div>
          {canvasItems.length > 0 && (
            <p className="text-[9px] text-muted-foreground mt-1.5">
              {canvasItems.length} table{canvasItems.length === 1 ? "" : "s"} available as context
            </p>
          )}
        </div>

        {/* ─── Results ─────────────────────────────────── */}
        {(resultError || resultColumns.length > 0) && (
          <div className="px-4 pt-2 pb-3 border-t border-border">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Results
            </label>

            {resultError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {resultError}
              </div>
            )}

            {resultColumns.length > 0 && (
              <>
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-secondary/70">
                          {resultColumns.map((col, i) => (
                            <th
                              key={i}
                              className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap border-b border-border"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {resultRows.map((row, rowIdx) => (
                          <tr
                            key={rowIdx}
                            className={rowIdx % 2 === 0 ? "bg-background" : "bg-secondary/30"}
                          >
                            {Array.isArray(row)
                              ? row.map((cell, cellIdx) => (
                                  <td
                                    key={cellIdx}
                                    className="px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate text-foreground"
                                    title={cellDisplay(cell)}
                                  >
                                    {cell === null ? (
                                      <span className="text-muted-foreground italic">NULL</span>
                                    ) : (
                                      truncate(cellDisplay(cell), 50)
                                    )}
                                  </td>
                                ))
                              : resultColumns.map((col, cellIdx) => {
                                  const cell = (row as Record<string, unknown>)[col];
                                  return (
                                    <td
                                      key={cellIdx}
                                      className="px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate text-foreground"
                                      title={cellDisplay(cell)}
                                    >
                                      {cell === null || cell === undefined ? (
                                        <span className="text-muted-foreground italic">NULL</span>
                                      ) : (
                                        truncate(cellDisplay(cell), 50)
                                      )}
                                    </td>
                                  );
                                })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {resultRowCount !== null && (
                  <div className="mt-1.5 text-[10px] text-muted-foreground">
                    {resultRowCount} row{resultRowCount === 1 ? "" : "s"} returned
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── Query History ───────────────────────────── */}
        <div className="px-4 pt-2 pb-4 border-t border-border">
          <div className="flex items-center justify-between mb-1.5">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition"
            >
              <Clock size={10} />
              Query History ({history.length})
              <ChevronDown
                size={10}
                className={`transition-transform ${showHistory ? "rotate-180" : ""}`}
              />
            </button>
            {history.length > 0 && showHistory && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground transition"
                title="Clear history"
              >
                <Trash2 size={10} />
                Clear
              </button>
            )}
          </div>

          {showHistory && (
            <div className="space-y-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
              {history.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-muted-foreground">
                  <Clock size={20} className="mx-auto mb-2 opacity-30" />
                  No queries yet.
                </div>
              ) : (
                history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => handleRestoreFromHistory(entry)}
                    className="w-full text-left rounded-lg border border-border bg-background p-2.5 hover:border-accent/40 hover:bg-secondary/30 transition group"
                  >
                    <div className="text-[11px] font-mono text-foreground truncate group-hover:text-accent transition">
                      {truncate(entry.query, 80)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{formatTime(entry.timestamp)}</span>
                      {entry.connectionName && (
                        <span className="rounded bg-secondary px-1">{entry.connectionName}</span>
                      )}
                      {entry.rowCount !== null && (
                        <span>
                          {entry.rowCount} row{entry.rowCount === 1 ? "" : "s"}
                        </span>
                      )}
                      {entry.error && (
                        <span className="text-destructive">Error</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default QueryBuilderPanel;
