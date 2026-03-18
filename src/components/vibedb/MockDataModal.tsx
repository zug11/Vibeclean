import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, Search, ChevronDown, ChevronRight, DatabaseZap, Loader2 } from "lucide-react";
import React, { useState, useMemo, useEffect } from "react";

interface MockDataModalProps {
  open: boolean;
  onClose: () => void;
  sql: string;
  isGenerating: boolean;
  tableCount: number;
  onCopy: (text: string) => void;
  copied: boolean;
  onCancel?: () => void;
  onLoadInPlayground?: (sql: string) => void;
}

// Split INSERT statements by table
function splitInsertsByTable(sql: string): { tableName: string; sql: string; rowCount: number }[] {
  if (!sql.trim()) return [];
  const blocks = new Map<string, { lines: string[]; rows: number }>();
  const lines = sql.split("\n");
  let currentTable = "";
  let buffer: string[] = [];
  let comment = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // Track comments
    if (trimmed.startsWith("--")) {
      if (!currentTable && !comment) comment = trimmed;
      continue;
    }
    if (!trimmed) continue;

    // Match INSERT INTO tablename
    const match = trimmed.match(/^INSERT\s+INTO\s+["'`]?(\w+)["'`]?\s/i);
    if (match) {
      currentTable = match[1];
      if (!blocks.has(currentTable)) {
        blocks.set(currentTable, { lines: [], rows: 0 });
      }
      blocks.get(currentTable)!.lines.push(line);
      blocks.get(currentTable)!.rows++;
    } else if (currentTable) {
      // Continuation of previous INSERT (multi-line VALUES)
      blocks.get(currentTable)!.lines.push(line);
      // Count additional value rows
      if (trimmed.startsWith("(") && trimmed.endsWith(");")) {
        blocks.get(currentTable)!.rows++;
      }
    }
  }

  return Array.from(blocks.entries()).map(([tableName, data]) => ({
    tableName,
    sql: data.lines.join("\n"),
    rowCount: data.rows,
  }));
}

function LoadingTimer({ tableCount }: { tableCount: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const messages = [
    "Building INSERT statements...",
    "Generating realistic data...",
    "Resolving foreign key order...",
    "Creating UUIDs & timestamps...",
  ];
  const msg = messages[Math.floor(elapsed / 4) % messages.length];
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Loader2 size={32} className="animate-spin text-accent" />
      <span className="text-sm text-muted-foreground">{msg}</span>
      <span className="text-xs text-muted-foreground/60">
        {tableCount} table{tableCount !== 1 ? "s" : ""} · {elapsed}s
      </span>
    </div>
  );
}

export default function MockDataModal({ open, onClose, sql, isGenerating, tableCount, onCopy, copied, onCancel, onLoadInPlayground }: MockDataModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedTables, setCollapsedTables] = useState<Set<string>>(new Set());
  const [copiedTable, setCopiedTable] = useState<string | null>(null);

  const tableBlocks = useMemo(() => splitInsertsByTable(sql), [sql]);

  const filteredBlocks = useMemo(() => {
    if (!searchTerm.trim()) return tableBlocks;
    const term = searchTerm.toLowerCase();
    return tableBlocks.filter(b => b.tableName.toLowerCase().includes(term));
  }, [tableBlocks, searchTerm]);

  const toggleCollapse = (name: string) => {
    setCollapsedTables(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const copyTable = async (tableName: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTable(tableName);
      setTimeout(() => setCopiedTable(null), 2000);
    } catch {}
  };

  if (!open) return null;

  const totalRows = tableBlocks.reduce((sum, b) => sum + b.rowCount, 0);
  const totalChars = sql.length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="mx-4 w-full max-w-3xl max-h-[85vh] rounded-2xl bg-card shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <DatabaseZap size={16} className="text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Seed Data</h2>
                  {!isGenerating && sql && (
                    <p className="text-[10px] text-muted-foreground">
                      {tableBlocks.length} table{tableBlocks.length !== 1 ? "s" : ""} · {totalRows} row{totalRows !== 1 ? "s" : ""} · {totalChars.toLocaleString()} chars
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isGenerating && onCancel && (
                  <button onClick={onCancel} className="flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition">
                    Cancel
                  </button>
                )}
                {!isGenerating && sql && (<>
                  <button onClick={() => onCopy(sql)} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/80 transition">
                    {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy All"}
                  </button>
                  {onLoadInPlayground && (
                    <button onClick={() => onLoadInPlayground(sql)} className="flex items-center gap-1.5 rounded-lg bg-accent/20 text-accent px-3 py-1.5 text-xs font-semibold hover:bg-accent/30 transition">
                      <DatabaseZap size={12} /> Query Lab
                    </button>
                  )}
                </>)}
                <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary transition">
                  <X size={16} />
                </button>
              </div>
            </div>

            {isGenerating ? (
              <LoadingTimer tableCount={tableCount} />
            ) : !sql ? (
              <div className="py-12 text-center text-sm text-muted-foreground">-- No data generated --</div>
            ) : (
              <>
                {/* Search */}
                {tableBlocks.length > 1 && (
                  <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border/30 shrink-0">
                    <div className="flex-1 relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Filter tables..."
                        className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:border-accent transition"
                      />
                    </div>
                  </div>
                )}

                {/* Table Blocks */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 custom-scrollbar">
                  {filteredBlocks.map((block, idx) => {
                    const isCollapsed = collapsedTables.has(block.tableName);
                    const isCopied = copiedTable === block.tableName;

                    return (
                      <div key={block.tableName + idx} className="rounded-xl border border-border/50 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-secondary/30 hover:bg-secondary/50 transition cursor-pointer" onClick={() => toggleCollapse(block.tableName)}>
                          <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
                            <span className="text-xs font-bold font-mono">{block.tableName}</span>
                            <span className="text-[10px] text-muted-foreground">{block.rowCount} row{block.rowCount !== 1 ? "s" : ""}</span>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); copyTable(block.tableName, block.sql); }}
                            className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[10px] font-semibold hover:bg-secondary/80 transition"
                          >
                            {isCopied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                          </button>
                        </div>
                        <AnimatePresence>
                          {!isCollapsed && (
                            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                              <pre className="px-3 py-2.5 font-mono text-[11px] leading-relaxed bg-background overflow-x-auto">{block.sql}</pre>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                  {filteredBlocks.length === 0 && searchTerm && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No tables match "{searchTerm}"
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
