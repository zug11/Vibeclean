// Feature: Ask Data — Analyze Actual Row Data from Canvas Tables
import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  X, Loader2, MessageCircle, BarChart3, Send, Database,
} from "lucide-react";
import type { TableNode } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────

interface AskDataPanelProps {
  open: boolean;
  onClose: () => void;
  canvasItems: TableNode[];
  callAI: (type: string, prompt: string, context?: string) => Promise<string>;
}

interface ConversationEntry {
  id: string;
  question: string;
  timestamp: number;
  error: string | null;
  responseType: "show-data" | "analyze";
  // For show-data: the actual rows to render
  tableName: string | null;
  dataColumns: string[] | null;
  dataRows: Record<string, unknown>[] | null;
  // For analyze: AI natural language output
  answer: string | null;
}

// ─── Helpers ─────────────────────────────────────────────

function cellDisplay(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "\u2026";
}

// Detect "show me rows from X" intent and resolve the target table
function detectShowDataIntent(
  q: string,
  tables: TableNode[]
): { isShowData: boolean; matchedTable: TableNode | null } {
  const showPatterns = [
    /show\s+(?:me\s+)?(?:(?:the\s+)?rows?\s+)?(?:from|in|of)\s+["']?(\w+)["']?/i,
    /(?:display|list|view|get|see)\s+(?:(?:the\s+)?rows?\s+)?(?:from|in|of)\s+["']?(\w+)["']?/i,
    /show\s+(?:me\s+)?["']?(\w+)["']?\s+(?:data|rows?|table|records?)/i,
    /what(?:'s| is)\s+in\s+["']?(\w+)["']?/i,
    /["']?(\w+)["']?\s+(?:rows?|data|records?|table)$/i,
  ];

  for (const pattern of showPatterns) {
    const match = q.match(pattern);
    if (match) {
      const name = match[1].toLowerCase();
      const found = tables.find(
        (t) =>
          t.name.toLowerCase() === name ||
          t.name.toLowerCase() === name + "s" ||
          t.name.toLowerCase().replace(/_/g, "") === name.replace(/_/g, "")
      );
      if (found && found.dataRows && found.dataRows.length > 0) {
        return { isShowData: true, matchedTable: found };
      }
      // If table exists but has no data, still match (we'll show "no data")
      if (found) {
        return { isShowData: true, matchedTable: found };
      }
    }
  }
  return { isShowData: false, matchedTable: null };
}

// Build data context: schema + actual row data for AI analysis
function buildDataContext(canvasItems: TableNode[]): string {
  if (canvasItems.length === 0) return "";

  const MAX_ROWS_PER_TABLE = 500;
  const MAX_TOTAL_CHARS = 60000;

  let context = "";
  for (const t of canvasItems) {
    const cols = t.columns.map((c) => `${c.name}:${c.type}`).join(", ");
    let section = `\nTable: ${t.name} (${cols})\n`;

    if (t.dataRows && t.dataRows.length > 0) {
      const sample = t.dataRows.slice(0, MAX_ROWS_PER_TABLE);
      section += `Data (${t.dataRows.length} total rows, showing ${sample.length}):\n`;
      section += JSON.stringify(sample) + "\n";
    } else {
      section += "Data: (no rows)\n";
    }

    if (context.length + section.length > MAX_TOTAL_CHARS) {
      // Adaptive row reduction: fit as many rows as possible in remaining space
      const schemaLine = `\nTable: ${t.name} (${cols})\n`;

      if (t.dataRows && t.dataRows.length > 0 && MAX_TOTAL_CHARS - context.length > schemaLine.length + 200) {
        const rows = t.dataRows.slice(0, MAX_ROWS_PER_TABLE);
        let rowCount = Math.min(rows.length, 50);
        let fitted = false;
        while (rowCount > 0) {
          const truncatedSection = schemaLine +
            `Data (${t.dataRows.length} total rows, showing ${rowCount}):\n` +
            JSON.stringify(rows.slice(0, rowCount)) + "\n";
          if (context.length + truncatedSection.length <= MAX_TOTAL_CHARS) {
            context += truncatedSection;
            fitted = true;
            break;
          }
          rowCount = Math.floor(rowCount / 2);
        }
        if (!fitted) {
          context += schemaLine + `Data: (${t.dataRows.length} rows, too large to include)\n`;
        }
      } else {
        context += schemaLine + "Data: (no space remaining)\n";
      }
      break;
    }
    context += section;
  }
  return context;
}

// ─── Component ───────────────────────────────────────────

const AskDataPanel: React.FC<AskDataPanelProps> = ({
  open,
  onClose,
  canvasItems,
  callAI,
}) => {
  const [question, setQuestion] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasSchema = canvasItems.length > 0;
  const tablesWithData = canvasItems.filter((t) => t.dataRows && t.dataRows.length > 0);
  const totalDataRows = tablesWithData.reduce((sum, t) => sum + (t.dataRows?.length || 0), 0);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation, step]);

  // ─── Ask Handler: two-mode dispatch ────────────────────

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || isAnalyzing || !hasSchema) return;

    const entryId = crypto.randomUUID?.() || String(Date.now());
    setIsAnalyzing(true);
    setQuestion("");

    let entry: ConversationEntry;

    try {
      // Mode 1: Show data — user wants to see rows from a specific table
      const { isShowData, matchedTable } = detectShowDataIntent(q, canvasItems);

      if (isShowData && matchedTable) {
        const columns = matchedTable.columns.map((c) => c.name);
        entry = {
          id: entryId,
          question: q,
          timestamp: Date.now(),
          error: null,
          responseType: "show-data",
          tableName: matchedTable.name,
          dataColumns: columns,
          dataRows: matchedTable.dataRows || [],
          answer: null,
        };
      } else {
        // Mode 2: Analyze — pass actual row data to AI
        setStep(tablesWithData.length > 0 ? "Analyzing your data..." : "Analyzing schema...");
        const dataContext = buildDataContext(canvasItems);
        const answer = await callAI("analyze-data", q, dataContext);

        entry = {
          id: entryId,
          question: q,
          timestamp: Date.now(),
          error: null,
          responseType: "analyze",
          tableName: null,
          dataColumns: null,
          dataRows: null,
          answer,
        };
      }
    } catch (e: any) {
      entry = {
        id: entryId,
        question: q,
        timestamp: Date.now(),
        error: e.message || "Something went wrong",
        responseType: "analyze",
        tableName: null,
        dataColumns: null,
        dataRows: null,
        answer: null,
      };
    } finally {
      setIsAnalyzing(false);
      setStep(null);
    }

    setConversation((prev) => [...prev, entry]);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ x: 520 }}
      animate={{ x: 0 }}
      exit={{ x: 520 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed right-0 top-0 z-50 flex h-full w-[500px] flex-col border-l border-border bg-card shadow-2xl"
    >
      {/* ─── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10">
            <MessageCircle size={14} className="text-violet-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Ask Data</h3>
            <p className="text-[10px] text-muted-foreground">
              {tablesWithData.length > 0
                ? `${tablesWithData.length} table${tablesWithData.length !== 1 ? "s" : ""} with data (${totalDataRows} rows)`
                : hasSchema
                  ? "Import data or generate mock data first"
                  : "Add tables to your canvas first"}
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

      {/* ─── No Schema Warning ────────────────────────── */}
      {!hasSchema && (
        <div className="px-4 py-6 text-center">
          <Database size={32} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No tables on canvas</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Generate or import a schema first, then ask questions about your data here.
          </p>
        </div>
      )}

      {/* ─── Conversation ──────────────────────────────── */}
      {hasSchema && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-4">
          {conversation.length === 0 && !isAnalyzing && (
            <div className="py-12 text-center">
              <BarChart3 size={36} className="mx-auto mb-3 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">Ask questions about your data</p>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-[280px] mx-auto">
                {tablesWithData.length > 0
                  ? `e.g. "Show me rows from ${tablesWithData[0].name}" or "What patterns do you see in the data?"`
                  : "Import data or generate mock data first, then ask questions here"}
              </p>
              <p className="text-[10px] text-muted-foreground/40 mt-3">
                {tablesWithData.length} of {canvasItems.length} table{canvasItems.length !== 1 ? "s" : ""} have data
                {totalDataRows > 0 ? ` (${totalDataRows} total rows)` : ""}
              </p>
            </div>
          )}

          {conversation.map((entry) => (
            <div key={entry.id} className="space-y-2">
              {/* Question bubble */}
              <div className="flex justify-end">
                <div className="rounded-xl rounded-tr-sm bg-violet-500/10 border border-violet-500/20 px-3 py-2 max-w-[85%]">
                  <p className="text-xs text-foreground">{entry.question}</p>
                </div>
              </div>

              {/* Error */}
              {entry.error && (
                <div className="rounded-xl rounded-tl-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                  <p className="text-xs text-destructive">{entry.error}</p>
                </div>
              )}

              {/* Show Data response — render rows in a table */}
              {entry.responseType === "show-data" && entry.dataColumns && (
                <div className="rounded-xl rounded-tl-sm bg-secondary/50 border border-border overflow-hidden">
                  <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
                    <Database size={12} className="text-violet-500" />
                    <span className="text-[11px] font-semibold">{entry.tableName}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {entry.dataRows && entry.dataRows.length > 0
                        ? `${entry.dataRows.length} row${entry.dataRows.length !== 1 ? "s" : ""}`
                        : "No data rows"}
                    </span>
                  </div>
                  {entry.dataRows && entry.dataRows.length > 0 ? (
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-secondary/70">
                            {entry.dataColumns.map((col, i) => (
                              <th key={i} className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap border-b border-border">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {entry.dataRows.map((row, rowIdx) => (
                            <tr key={rowIdx} className={rowIdx % 2 === 0 ? "bg-background" : "bg-secondary/30"}>
                              {entry.dataColumns!.map((col, cellIdx) => {
                                const val = row[col];
                                return (
                                  <td key={cellIdx} className="px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate text-foreground" title={cellDisplay(val)}>
                                    {val === null || val === undefined ? (
                                      <span className="text-muted-foreground italic">NULL</span>
                                    ) : (
                                      truncate(cellDisplay(val), 40)
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-3 py-1.5 text-[9px] text-muted-foreground border-t border-border">
                        {entry.dataRows.length} row{entry.dataRows.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-center">
                      <p className="text-xs text-muted-foreground">No data rows in this table yet.</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">Import data or generate mock data first.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Analyze response — AI text */}
              {entry.responseType === "analyze" && entry.answer && (
                <div className="rounded-xl rounded-tl-sm bg-secondary/50 border border-border px-3 py-2.5">
                  <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                    {entry.answer}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading state */}
          {isAnalyzing && step && (
            <div className="rounded-xl rounded-tl-sm bg-secondary/30 border border-border px-3 py-3">
              <div className="flex items-center gap-2 text-xs text-violet-500">
                <Loader2 size={14} className="animate-spin" />
                <span>{step}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Input Bar ─────────────────────────────────── */}
      {hasSchema && (
        <div className="border-t border-border px-4 py-3 shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk();
                }
              }}
              placeholder="Ask about your data..."
              disabled={isAnalyzing}
              className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              onClick={handleAsk}
              disabled={!question.trim() || isAnalyzing}
              className="flex items-center justify-center rounded-xl bg-violet-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-violet-700 active:scale-95 transition disabled:opacity-40"
            >
              {isAnalyzing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground mt-1.5 px-1">
            {tablesWithData.length} table{tablesWithData.length !== 1 ? "s" : ""} with data
            ({totalDataRows} rows){tablesWithData.length === 0 ? " \u2022 Import or generate data first" : ""}
          </p>
        </div>
      )}
    </motion.div>
  );
};

export default AskDataPanel;
