import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, Search, Code, AlertTriangle, CheckCircle2, Database, Wand2 } from "lucide-react";
import React, { useState, useMemo, useRef, useEffect } from "react";

import type { TableNode } from "@/lib/types";

interface SQLViewerModalProps {
  open: boolean;
  onClose: () => void;
  sql: string;
  tables: TableNode[];
  onCopy: (text: string) => void;
  copied: boolean;
  onFixIssues?: () => void;
}

// Parse SQL string into per-table blocks
function splitSqlByTable(sql: string): { tableName: string; sql: string; columnCount: number }[] {
  const blocks: { tableName: string; sql: string; columnCount: number }[] = [];
  const parts = sql.split(/(?=CREATE\s+TABLE)/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const nameMatch = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/i);
    if (nameMatch) {
      // Count columns by counting lines that start with whitespace and contain a type keyword
      const columnLines = trimmed.split("\n").filter(l => /^\s+\w+\s+(UUID|VARCHAR|INT|TIMESTAMP|BOOLEAN|NUMERIC|TEXT|JSONB|DECIMAL|FLOAT|SERIAL|BIGINT|SMALLINT|REAL|DOUBLE|CHAR|DATE|TIME|INTERVAL)/i.test(l));
      blocks.push({ tableName: nameMatch[1], sql: trimmed, columnCount: columnLines.length });
    } else if (blocks.length === 0) {
      blocks.push({ tableName: "__header__", sql: trimmed, columnCount: 0 });
    } else {
      blocks[blocks.length - 1].sql += "\n\n" + trimmed;
    }
  }
  return blocks;
}

// Validate FK references
function validateFKs(tables: TableNode[]): { table: string; column: string; ref: string; valid: boolean }[] {
  const tableNames = new Set(tables.map(t => t.name.toLowerCase()));
  const issues: { table: string; column: string; ref: string; valid: boolean }[] = [];

  for (const t of tables) {
    for (const c of t.columns) {
      if (c.isForeignKey && c.linkedTable) {
        const valid = tableNames.has(c.linkedTable.toLowerCase());
        issues.push({ table: t.name, column: c.name, ref: `${c.linkedTable}.${c.linkedColumn || "id"}`, valid });
      }
    }
  }
  return issues;
}

export default function SQLViewerModal({ open, onClose, sql, tables, onCopy, copied, onFixIssues }: SQLViewerModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("__all__");
  const [copiedTable, setCopiedTable] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  const tableBlocks = useMemo(() => splitSqlByTable(sql), [sql]);
  const fkIssues = useMemo(() => validateFKs(tables), [tables]);
  const invalidFKs = fkIssues.filter(f => !f.valid);

  // Filter table blocks based on search
  const filteredBlocks = useMemo(() => {
    const actualTables = tableBlocks.filter(b => b.tableName !== "__header__");
    if (!searchTerm.trim()) return actualTables;
    const term = searchTerm.toLowerCase();
    return actualTables.filter(b =>
      b.tableName.toLowerCase().includes(term) || b.sql.toLowerCase().includes(term)
    );
  }, [tableBlocks, searchTerm]);

  // Reset active tab when search changes
  useEffect(() => {
    if (searchTerm.trim() && filteredBlocks.length > 0 && activeTab !== "__all__") {
      const stillVisible = filteredBlocks.some(b => b.tableName === activeTab);
      if (!stillVisible) setActiveTab("__all__");
    }
  }, [searchTerm, filteredBlocks, activeTab]);

  // Scroll active tab into view
  useEffect(() => {
    if (activeTabRef.current && tabsRef.current) {
      activeTabRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeTab]);

  // Get the SQL content to display based on active tab
  const displaySql = useMemo(() => {
    if (activeTab === "__all__") {
      // Show header + all filtered tables
      const header = tableBlocks.find(b => b.tableName === "__header__");
      const headerSql = header ? header.sql + "\n\n" : "";
      return headerSql + filteredBlocks.map(b => b.sql).join("\n\n");
    }
    const block = filteredBlocks.find(b => b.tableName === activeTab);
    return block?.sql || "";
  }, [activeTab, filteredBlocks, tableBlocks]);

  const copyTable = async (tableName: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTable(tableName);
      setTimeout(() => setCopiedTable(null), 2000);
    } catch {}
  };

  if (!open) return null;

  const totalChars = sql.length;
  const tableCount = tableBlocks.filter(b => b.tableName !== "__header__").length;
  const activeBlock = filteredBlocks.find(b => b.tableName === activeTab);
  const activeHasInvalidFK = activeTab !== "__all__" && invalidFKs.some(f => f.table === activeTab);

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="mx-4 w-full max-w-3xl max-h-[85vh] rounded-2xl bg-card shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-foreground/5 flex items-center justify-center">
                  <Code size={16} />
                </div>
                <div>
                  <h2 className="text-base font-bold">Generated SQL</h2>
                  <p className="text-[10px] text-muted-foreground">
                    {tableCount} table{tableCount !== 1 ? "s" : ""} · {totalChars.toLocaleString()} chars
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {invalidFKs.length > 0 && (
                  <button
                    onClick={() => setShowValidation(!showValidation)}
                    className="flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-2.5 py-1.5 text-[10px] font-bold text-destructive hover:bg-destructive/20 transition"
                  >
                    <AlertTriangle size={11} />
                    {invalidFKs.length} FK issue{invalidFKs.length !== 1 ? "s" : ""}
                  </button>
                )}
                {invalidFKs.length === 0 && fkIssues.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-accent">
                    <CheckCircle2 size={11} /> FKs valid
                  </span>
                )}
                <button onClick={() => onCopy(sql)} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/80 transition">
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy All"}
                </button>
                <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary transition">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* FK Validation Panel */}
            <AnimatePresence>
              {showValidation && invalidFKs.length > 0 && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-b border-border/50">
                  <div className="px-6 py-3 bg-destructive/5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-destructive uppercase tracking-wider">Invalid FK References</p>
                      {onFixIssues && (
                        <button
                          onClick={onFixIssues}
                          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[10px] font-bold text-accent-foreground hover:bg-accent/90 transition"
                        >
                          <Wand2 size={11} /> Fix Issues
                        </button>
                      )}
                    </div>
                    {invalidFKs.map((fk, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-destructive/80">
                        <AlertTriangle size={11} />
                        <span className="font-mono">{fk.table}.{fk.column}</span>
                        <span>&rarr;</span>
                        <span className="font-mono line-through">{fk.ref}</span>
                        <span className="text-[10px] text-muted-foreground">(table not found)</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Search Bar */}
            {tableCount > 1 && (
              <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border/30 shrink-0">
                <div className="flex-1 relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search tables..."
                    className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:border-accent transition"
                  />
                </div>
              </div>
            )}

            {/* Tab Bar */}
            <div className="shrink-0 border-b border-border/30">
              <div ref={tabsRef} className="flex items-center gap-0.5 px-4 py-1.5 overflow-x-auto custom-scrollbar">
                {/* "All" tab */}
                <button
                  ref={activeTab === "__all__" ? activeTabRef : undefined}
                  onClick={() => setActiveTab("__all__")}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === "__all__"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <Database size={11} />
                  All ({filteredBlocks.length})
                </button>

                <div className="w-px h-4 bg-border/50 mx-1 shrink-0" />

                {/* Per-table tabs */}
                {filteredBlocks.map((block) => {
                  const hasInvalidFK = invalidFKs.some(f => f.table === block.tableName);
                  const isActive = activeTab === block.tableName;
                  return (
                    <button
                      key={block.tableName}
                      ref={isActive ? activeTabRef : undefined}
                      onClick={() => setActiveTab(block.tableName)}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                        isActive
                          ? "bg-accent text-accent-foreground font-bold"
                          : hasInvalidFK
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      {block.tableName}
                      {hasInvalidFK && <AlertTriangle size={10} />}
                      <span className={`text-[9px] ${isActive ? "text-accent-foreground/70" : "text-muted-foreground/60"}`}>
                        {block.columnCount}col
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SQL Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {/* Active tab info bar */}
              {activeTab !== "__all__" && activeBlock && (
                <div className="flex items-center justify-between px-5 py-2 bg-secondary/20 border-b border-border/20 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold font-mono">{activeBlock.tableName}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {activeBlock.columnCount} column{activeBlock.columnCount !== 1 ? "s" : ""} · {activeBlock.sql.length.toLocaleString()} chars
                    </span>
                    {activeHasInvalidFK && (
                      <span className="flex items-center gap-1 text-[10px] text-destructive">
                        <AlertTriangle size={10} /> FK issues
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => copyTable(activeBlock.tableName, activeBlock.sql)}
                    className="flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 text-[10px] font-semibold hover:bg-secondary/80 transition"
                  >
                    {copiedTable === activeBlock.tableName ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy Table</>}
                  </button>
                </div>
              )}

              {/* SQL code */}
              <div className="flex-1 overflow-auto custom-scrollbar">
                {displaySql ? (
                  <pre className="px-5 py-4 font-mono text-[11px] leading-relaxed bg-background overflow-x-auto whitespace-pre min-h-full">
                    {displaySql}
                  </pre>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-12">
                    {searchTerm ? `No tables match "${searchTerm}"` : "No SQL generated"}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
