import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, X, Check, AlertTriangle, AlertCircle, Info, Zap, CheckCircle2, Loader2, ChevronDown, ChevronRight, Sparkles, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";

interface AuditReport {
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

interface SchemaAuditModalProps {
  open: boolean;
  onClose: () => void;
  isAuditing: boolean;
  report: AuditReport | null;
  onApplySuggestion: (suggestion: any) => void;
  onApplyAll: () => void;
  onRerunAudit: () => void;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "hsl(var(--accent))" : score >= 50 ? "hsl(var(--primary))" : "hsl(var(--destructive))";

  return (
    <div className="relative flex items-center justify-center">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
        <motion.circle
          cx="64" cy="64" r={radius} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          className="text-3xl font-black"
          style={{ color }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
        >
          {score}
        </motion.span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Score</span>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const config: Record<string, { icon: typeof AlertCircle; className: string; label: string }> = {
    error: { icon: AlertCircle, className: "bg-destructive/10 text-destructive border-destructive/20", label: "Error" },
    warning: { icon: AlertTriangle, className: "bg-primary/10 text-primary border-primary/20", label: "Warning" },
    info: { icon: Info, className: "bg-accent/10 text-accent border-accent/20", label: "Info" },
  };
  const c = config[severity] || config.info;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${c.className}`}>
      <Icon size={10} /> {c.label}
    </span>
  );
}

function CollapsibleSection({ title, icon: Icon, count, children, defaultOpen = true }: {
  title: string; icon: typeof AlertCircle; count: number; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 bg-secondary/30 hover:bg-secondary/50 transition"
      >
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-muted-foreground" />
          <span className="text-sm font-bold">{title}</span>
          <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground min-w-[20px]">
            {count}
          </span>
        </div>
        {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-1.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AuditingAnimation() {
  const steps = ["Analyzing table structure…", "Checking naming conventions…", "Validating foreign keys…", "Running AI inspection…"];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setStep(s => (s + 1) % steps.length), 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6">
      <div className="relative">
        <motion.div
          className="h-20 w-20 rounded-2xl bg-accent/10 flex items-center justify-center"
          animate={{ rotate: [0, 5, -5, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <ShieldCheck size={36} className="text-accent" />
        </motion.div>
        <motion.div
          className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-accent flex items-center justify-center"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <Loader2 size={12} className="animate-spin text-accent-foreground" />
        </motion.div>
      </div>
      <motion.p
        key={step}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-sm text-muted-foreground font-medium"
      >
        {steps[step]}
      </motion.p>
    </div>
  );
}

export default function SchemaAuditModal({ open, onClose, isAuditing, report, onApplySuggestion, onApplyAll, onRerunAudit }: SchemaAuditModalProps) {
  if (!open) return null;

  const score = report?.score || report?.confidence_score || 0;
  const allIssues = [
    ...(report?.issues || []),
  ];
  const errorCount = allIssues.filter(i => i.severity === "error").length + (report?.fkIssues?.length || 0);
  const warningCount = allIssues.filter(i => i.severity === "warning").length + (report?.lintIssues?.length || 0);
  const totalSuggestions = report?.suggestions?.length || 0;
  const isClean = report && !isAuditing && errorCount === 0 && warningCount === 0 && totalSuggestions === 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="mx-4 w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl bg-card shadow-2xl border border-border/50 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-secondary/20">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-accent/10 flex items-center justify-center">
                  <ShieldCheck size={18} className="text-accent" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Schema Audit</h2>
                  <p className="text-[11px] text-muted-foreground">AI-powered analysis of your database design</p>
                </div>
              </div>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-secondary transition">
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {isAuditing ? (
                <AuditingAnimation />
              ) : report ? (
                <div className="space-y-5">
                  {/* Clean state — everything looks good */}
                  {isClean ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-5">
                      <div className="flex items-center gap-6">
                        {score > 0 && <ScoreRing score={score} />}
                      </div>
                      <div className="text-center space-y-2">
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 size={20} className="text-accent" />
                          <span className="text-base font-bold text-accent">Everything looks good!</span>
                        </div>
                        <p className="text-xs text-muted-foreground max-w-xs">
                          Your schema passed all checks — no errors, warnings, or suggestions.
                          {report.strengths && report.strengths.length > 0 && ` ${report.strengths.length} strength${report.strengths.length !== 1 ? "s" : ""} identified.`}
                        </p>
                      </div>
                      {/* Strengths inline for clean state */}
                      {report.strengths && report.strengths.length > 0 && (
                        <div className="w-full max-w-sm space-y-1.5 mt-2">
                          {report.strengths.map((s, i) => (
                            <div key={i} className="flex items-start gap-2 rounded-lg bg-accent/5 px-3 py-2 text-xs">
                              <CheckCircle2 size={12} className="text-accent mt-0.5 shrink-0" />
                              <span>{s}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Score + Summary Bar */}
                      <div className="flex items-center gap-6">
                        {score > 0 && <ScoreRing score={score} />}
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {errorCount > 0 && (
                              <div className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-bold text-destructive">
                                <AlertCircle size={12} /> {errorCount} error{errorCount !== 1 ? "s" : ""}
                              </div>
                            )}
                            {warningCount > 0 && (
                              <div className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
                                <AlertTriangle size={12} /> {warningCount} warning{warningCount !== 1 ? "s" : ""}
                              </div>
                            )}
                            {totalSuggestions > 0 && (
                              <div className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent">
                                <Sparkles size={12} /> {totalSuggestions} suggestion{totalSuggestions !== 1 ? "s" : ""}
                              </div>
                            )}
                          </div>
                          {score > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {score >= 80 ? "Your schema looks solid. Minor improvements available." :
                               score >= 50 ? "Decent structure with room for improvement." :
                               "Several issues need attention for a production-ready schema."}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Strengths */}
                      {report.strengths && report.strengths.length > 0 && (
                        <CollapsibleSection title="Strengths" icon={CheckCircle2} count={report.strengths.length}>
                          {report.strengths.map((s, i) => (
                            <div key={i} className="flex items-start gap-2.5 rounded-lg bg-accent/5 px-3 py-2 text-xs">
                              <CheckCircle2 size={13} className="text-accent mt-0.5 shrink-0" />
                              <span>{s}</span>
                            </div>
                          ))}
                        </CollapsibleSection>
                      )}

                      {/* FK Issues */}
                      {report.fkIssues && report.fkIssues.length > 0 && (
                        <CollapsibleSection title="Foreign Key Issues" icon={AlertCircle} count={report.fkIssues.length}>
                          {report.fkIssues.map((issue, i) => (
                            <div key={i} className="flex items-start gap-2.5 rounded-lg bg-destructive/5 px-3 py-2 text-xs">
                              <AlertCircle size={13} className="text-destructive mt-0.5 shrink-0" />
                              <span className="flex-1">{issue.message}</span>
                              <SeverityBadge severity={issue.severity} />
                            </div>
                          ))}
                        </CollapsibleSection>
                      )}

                      {/* Naming / Lint Issues */}
                      {report.lintIssues && report.lintIssues.length > 0 && (
                        <CollapsibleSection title="Naming Conventions" icon={AlertTriangle} count={report.lintIssues.length} defaultOpen={false}>
                          {report.lintIssues.map((issue, i) => (
                            <div key={i} className="flex items-start gap-2.5 rounded-lg bg-primary/5 px-3 py-2 text-xs">
                              <AlertTriangle size={13} className="text-primary mt-0.5 shrink-0" />
                              <span className="flex-1">{issue.message}</span>
                              <SeverityBadge severity={issue.severity} />
                            </div>
                          ))}
                        </CollapsibleSection>
                      )}

                      {/* AI Issues */}
                      {allIssues.length > 0 && (
                        <CollapsibleSection title="AI Analysis" icon={Zap} count={allIssues.length}>
                          {allIssues.map((issue, i) => (
                            <div key={i} className="flex items-start gap-2.5 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
                              {issue.severity === "error" ? <AlertCircle size={13} className="text-destructive mt-0.5 shrink-0" /> :
                               issue.severity === "warning" ? <AlertTriangle size={13} className="text-primary mt-0.5 shrink-0" /> :
                               <Info size={13} className="text-accent mt-0.5 shrink-0" />}
                              <span className="flex-1">{issue.message}</span>
                              <SeverityBadge severity={issue.severity} />
                            </div>
                          ))}
                        </CollapsibleSection>
                      )}

                      {/* Risks */}
                      {report.risks && report.risks.length > 0 && (
                        <CollapsibleSection title="Risks" icon={Zap} count={report.risks.length}>
                          {report.risks.map((r, i) => (
                            <div key={i} className="flex items-start gap-2.5 rounded-lg bg-destructive/5 px-3 py-2 text-xs">
                              <Zap size={13} className="text-destructive mt-0.5 shrink-0" />
                              <span>{r}</span>
                            </div>
                          ))}
                        </CollapsibleSection>
                      )}

                      {/* Suggestions */}
                      {report.suggestions && report.suggestions.length > 0 && (
                        <CollapsibleSection title="Suggestions" icon={Sparkles} count={report.suggestions.length}>
                          <div className="space-y-2">
                            {report.suggestions.map((s, i) => (
                              <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                                <div className="text-xs flex-1 space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent uppercase tracking-wider">
                                      {s.type?.replace(/_/g, " ")}
                                    </span>
                                    {s.target_table && (
                                      <span className="text-muted-foreground font-mono text-[10px]">→ {s.target_table}</span>
                                    )}
                                  </div>
                                  <p className="text-muted-foreground leading-relaxed">{s.description || s.reason}</p>
                                </div>
                                <button
                                  onClick={() => onApplySuggestion(s)}
                                  className="ml-3 flex items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 py-1.5 text-[11px] font-bold hover:bg-accent/90 transition shrink-0"
                                >
                                  <Check size={11} /> Apply
                                </button>
                              </div>
                            ))}
                          </div>
                        </CollapsibleSection>
                      )}

                      {/* Missing elements */}
                      {report.missing_elements && report.missing_elements.length > 0 && (
                        <CollapsibleSection title="Missing Elements" icon={Info} count={report.missing_elements.length} defaultOpen={false}>
                          {report.missing_elements.map((el, i) => (
                            <div key={i} className="flex items-start gap-2.5 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
                              <Info size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                              <span>{el}</span>
                            </div>
                          ))}
                        </CollapsibleSection>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {/* Footer */}
            {report && !isAuditing && (
              <div className="border-t border-border/50 px-6 py-3 bg-secondary/20 flex items-center justify-between">
                <button
                  onClick={onRerunAudit}
                  className="flex items-center gap-2 rounded-xl bg-secondary text-secondary-foreground px-4 py-2 text-xs font-bold hover:bg-secondary/80 transition"
                >
                  <RefreshCw size={13} /> Re-run Audit
                </button>
                {totalSuggestions > 1 && (
                  <button
                    onClick={onApplyAll}
                    className="flex items-center gap-2 rounded-xl bg-accent text-accent-foreground px-4 py-2 text-xs font-bold hover:bg-accent/90 transition"
                  >
                    <Sparkles size={13} /> Apply All {totalSuggestions} Suggestions
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
