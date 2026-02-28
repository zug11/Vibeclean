// Feature 4: Generation History Panel
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { GenerationHistoryStore, type GenerationRecord } from "@/lib/generation-history";

interface GenerationHistoryPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const GenerationHistoryPanel: React.FC<GenerationHistoryPanelProps> = ({ open, onClose }) => {
  const [records, setRecords] = useState<GenerationRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setRecords(GenerationHistoryStore.getRecords());
  }, [open]);

  const handleClear = () => {
    GenerationHistoryStore.clearHistory();
    setRecords([]);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ x: 360 }}
      animate={{ x: 0 }}
      exit={{ x: 360 }}
      className="fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-border bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Clock size={16} className="text-primary" />
          Generation History
        </div>
        <div className="flex items-center gap-1">
          {records.length > 0 && (
            <button onClick={handleClear} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" title="Clear history">
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
            <Clock size={32} className="mb-3 opacity-30" />
            No generation history yet.
            <br />Generate a schema to see it here.
          </div>
        ) : (
          records.map(record => (
            <div key={record.id} className="rounded-lg border border-border bg-background p-3">
              <button
                onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                className="flex w-full items-start gap-2 text-left"
              >
                {record.success ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{record.prompt}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{formatTime(record.startedAt)}</span>
                    <span>{formatDuration(record.durationMs)}</span>
                    <span>{record.resultTableCount} tables</span>
                    <span className="rounded bg-secondary px-1">{record.strategy}</span>
                  </div>
                </div>
                {expandedId === record.id ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
              </button>

              <AnimatePresence>
                {expandedId === record.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                      {record.steps.map((step, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          {step.status === "completed" ? (
                            <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                          ) : step.status === "error" ? (
                            <AlertCircle size={12} className="text-red-500 shrink-0" />
                          ) : (
                            <div className="h-3 w-3 shrink-0 rounded-full border border-muted-foreground/30" />
                          )}
                          <span className="text-muted-foreground">{step.label}</span>
                          {step.startedAt && step.completedAt && (
                            <span className="ml-auto text-[10px] text-muted-foreground/60">
                              {formatDuration(step.completedAt - step.startedAt)}
                            </span>
                          )}
                        </div>
                      ))}
                      {record.resultTableNames.length > 0 && (
                        <div className="mt-2 text-[10px] text-muted-foreground">
                          Tables: {record.resultTableNames.join(", ")}
                        </div>
                      )}
                      {record.error && (
                        <div className="mt-2 text-[10px] text-red-400">{record.error}</div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
};

export default GenerationHistoryPanel;
