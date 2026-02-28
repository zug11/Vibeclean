import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, GitCompare, Plus, Minus, Edit3, Copy, Check, ChevronDown, ChevronRight, Database, Code } from "lucide-react";
import type { TableNode } from "@/lib/types";
import { computeSchemaDiff, generateMigrationSQL } from "@/lib/schema-diff";
import type { SchemaDiff } from "@/lib/schema-diff";

// ─── Props ──────────────────────────────────────────────────

interface SchemaCompareModalProps {
  open: boolean;
  onClose: () => void;
  currentSchema: TableNode[];
  previousSchema: TableNode[];
}

// ─── Sub-components ─────────────────────────────────────────

function DiffBadge({ type, count }: { type: "added" | "removed" | "modified"; count: number }) {
  const config = {
    added: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", label: "added" },
    removed: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", label: "removed" },
    modified: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", label: "modified" },
  };
  const c = config[type];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${c.bg} ${c.text} ${c.border}`}>
      {count} {c.label}
    </span>
  );
}

function ColumnDiffRow({ icon: Icon, iconClass, label, detail, bgClass }: {
  icon: typeof Plus;
  iconClass: string;
  label: string;
  detail: string;
  bgClass: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs ${bgClass}`}>
      <Icon size={13} className={`${iconClass} shrink-0`} />
      <span className="font-mono font-semibold">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
    </div>
  );
}

function ModifiedTableSection({ mod }: { mod: SchemaDiff["modifiedTables"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const totalChanges = mod.addedColumns.length + mod.removedColumns.length + mod.modifiedColumns.length + mod.addedIndexes.length + mod.removedIndexes.length;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 bg-amber-500/5 hover:bg-amber-500/10 transition"
      >
        <div className="flex items-center gap-2">
          <Edit3 size={13} className="text-amber-400" />
          <span className="text-sm font-bold font-mono">{mod.name}</span>
          <span className="inline-flex items-center justify-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 min-w-[20px]">
            {totalChanges} change{totalChanges !== 1 ? "s" : ""}
          </span>
        </div>
        {expanded
          ? <ChevronDown size={14} className="text-muted-foreground" />
          : <ChevronRight size={14} className="text-muted-foreground" />
        }
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-1.5">
              {mod.addedColumns.map((col) => (
                <ColumnDiffRow
                  key={`add-${col.name}`}
                  icon={Plus}
                  iconClass="text-emerald-400"
                  label={col.name}
                  detail={`${col.type.toUpperCase()}${col.constraints?.map(c => c.type === "notNull" ? " NOT NULL" : c.type === "primary" ? " PK" : c.type === "unique" ? " UNIQUE" : "").join("") || ""}`}
                  bgClass="bg-emerald-500/5"
                />
              ))}
              {mod.removedColumns.map((col) => (
                <ColumnDiffRow
                  key={`rem-${col.name}`}
                  icon={Minus}
                  iconClass="text-red-400"
                  label={col.name}
                  detail={col.type.toUpperCase()}
                  bgClass="bg-red-500/5"
                />
              ))}
              {mod.modifiedColumns.map(({ before, after }) => (
                <div key={`mod-${after.name}`} className="flex items-center gap-2.5 rounded-lg bg-amber-500/5 px-3 py-2 text-xs">
                  <Edit3 size={13} className="text-amber-400 shrink-0" />
                  <span className="font-mono font-semibold">{after.name}</span>
                  <span className="text-red-400 line-through">{before.type.toUpperCase()}</span>
                  <span className="text-muted-foreground">&rarr;</span>
                  <span className="text-emerald-400">{after.type.toUpperCase()}</span>
                  {constraintsDiffer(before, after) && (
                    <span className="text-amber-400 text-[10px]">(constraints changed)</span>
                  )}
                </div>
              ))}
              {mod.addedIndexes.map((idx: any, i: number) => (
                <ColumnDiffRow
                  key={`idx-add-${i}`}
                  icon={Plus}
                  iconClass="text-emerald-400"
                  label={idx.name}
                  detail={`INDEX on (${idx.columns.join(", ")})${idx.unique ? " UNIQUE" : ""}`}
                  bgClass="bg-emerald-500/5"
                />
              ))}
              {mod.removedIndexes.map((idx: any, i: number) => (
                <ColumnDiffRow
                  key={`idx-rem-${i}`}
                  icon={Minus}
                  iconClass="text-red-400"
                  label={idx.name}
                  detail={`INDEX on (${idx.columns.join(", ")})`}
                  bgClass="bg-red-500/5"
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Quick check if constraints differ (for display purposes) */
function constraintsDiffer(a: { constraints?: { type: string; value?: string }[] }, b: { constraints?: { type: string; value?: string }[] }): boolean {
  const keyA = (a.constraints || []).map(c => c.value ? `${c.type}:${c.value}` : c.type).sort().join("|");
  const keyB = (b.constraints || []).map(c => c.value ? `${c.type}:${c.value}` : c.type).sort().join("|");
  return keyA !== keyB;
}

// ─── Main Modal ─────────────────────────────────────────────

export default function SchemaCompareModal({ open, onClose, currentSchema, previousSchema }: SchemaCompareModalProps) {
  const [showMigration, setShowMigration] = useState(false);
  const [copied, setCopied] = useState(false);

  const diff = useMemo(
    () => computeSchemaDiff(previousSchema, currentSchema),
    [previousSchema, currentSchema]
  );

  const migrationSQL = useMemo(() => generateMigrationSQL(diff), [diff]);

  const totalAdded = diff.addedTables.length;
  const totalRemoved = diff.removedTables.length;
  const totalModified = diff.modifiedTables.length;
  const hasChanges = totalAdded > 0 || totalRemoved > 0 || totalModified > 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(migrationSQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="mx-4 w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl bg-card shadow-2xl border border-border/50 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-secondary/20 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-accent/10 flex items-center justify-center">
                  <GitCompare size={18} className="text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Schema Comparison</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {hasChanges
                      ? `${previousSchema.length} table${previousSchema.length !== 1 ? "s" : ""} before, ${currentSchema.length} table${currentSchema.length !== 1 ? "s" : ""} after`
                      : "No differences detected"
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Summary Badges */}
            {hasChanges && (
              <div className="flex items-center gap-2 px-6 py-3 border-b border-border/30 bg-secondary/10 shrink-0">
                {totalAdded > 0 && <DiffBadge type="added" count={totalAdded} />}
                {totalRemoved > 0 && <DiffBadge type="removed" count={totalRemoved} />}
                {totalModified > 0 && <DiffBadge type="modified" count={totalModified} />}
                <span className="text-[10px] text-muted-foreground ml-1">
                  {totalAdded + totalRemoved + totalModified} table{(totalAdded + totalRemoved + totalModified) !== 1 ? "s" : ""} changed
                </span>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {!hasChanges ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-accent/10 flex items-center justify-center">
                    <Check size={28} className="text-accent" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-bold">Schemas are identical</p>
                    <p className="text-xs text-muted-foreground">No structural differences were found between the two schema versions.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Added Tables */}
                  {diff.addedTables.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider px-1">
                        Added Tables
                      </p>
                      {diff.addedTables.map(table => (
                        <div key={table.id} className="rounded-xl border border-emerald-500/20 overflow-hidden">
                          <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-500/5">
                            <Plus size={14} className="text-emerald-400" />
                            <span className="text-sm font-bold font-mono">{table.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {table.columns.length} column{table.columns.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="px-4 py-2 space-y-1">
                            {table.columns.map(col => (
                              <div key={col.id} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-emerald-400/80">+</span>
                                <span className="font-mono font-semibold">{col.name}</span>
                                <span className="text-muted-foreground">{col.type.toUpperCase()}</span>
                                {col.constraints?.some(c => c.type === "primary") && (
                                  <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] font-bold text-accent">PK</span>
                                )}
                                {col.isForeignKey && col.linkedTable && (
                                  <span className="text-[10px] text-muted-foreground">
                                    &rarr; {col.linkedTable}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Removed Tables */}
                  {diff.removedTables.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider px-1">
                        Removed Tables
                      </p>
                      {diff.removedTables.map(table => (
                        <div key={table.id} className="rounded-xl border border-red-500/20 overflow-hidden">
                          <div className="flex items-center gap-2.5 px-4 py-3 bg-red-500/5">
                            <Minus size={14} className="text-red-400" />
                            <span className="text-sm font-bold font-mono line-through">{table.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {table.columns.length} column{table.columns.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="px-4 py-2 space-y-1">
                            {table.columns.map(col => (
                              <div key={col.id} className="flex items-center gap-2 text-xs text-red-400/60">
                                <span className="font-mono">-</span>
                                <span className="font-mono font-semibold line-through">{col.name}</span>
                                <span>{col.type.toUpperCase()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Modified Tables */}
                  {diff.modifiedTables.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider px-1">
                        Modified Tables
                      </p>
                      {diff.modifiedTables.map(mod => (
                        <ModifiedTableSection key={mod.name} mod={mod} />
                      ))}
                    </div>
                  )}

                  {/* Migration SQL Panel */}
                  {showMigration && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="rounded-xl border border-border overflow-hidden"
                    >
                      <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/30 border-b border-border/50">
                        <div className="flex items-center gap-2">
                          <Code size={13} className="text-muted-foreground" />
                          <span className="text-xs font-bold">Migration SQL</span>
                        </div>
                        <button
                          onClick={handleCopy}
                          className="flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1 text-[10px] font-semibold hover:bg-secondary/80 transition"
                        >
                          {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                        </button>
                      </div>
                      <div className="max-h-[300px] overflow-auto">
                        <pre className="px-4 py-3 font-mono text-[11px] leading-relaxed bg-background whitespace-pre overflow-x-auto">
                          {migrationSQL}
                        </pre>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {hasChanges && (
              <div className="border-t border-border/50 px-6 py-3 bg-secondary/20 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Database size={12} />
                  <span>
                    {previousSchema.length} &rarr; {currentSchema.length} table{currentSchema.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => setShowMigration(!showMigration)}
                  className="flex items-center gap-2 rounded-xl bg-accent text-accent-foreground px-4 py-2 text-xs font-bold hover:bg-accent/90 transition"
                >
                  <Code size={13} />
                  {showMigration ? "Hide Migration" : "Generate Migration"}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
