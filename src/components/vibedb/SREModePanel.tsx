import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { v4 as uuidv4 } from "uuid";
import {
  X, Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  Plus, Trash2, Loader2, Server, Database as DatabaseIcon, Globe,
  Zap, HardDrive, Radio, Shield, ChevronDown, ChevronRight,
  FileText, Play, Copy, Check
} from "lucide-react";
import type { ServiceNode, Incident, Runbook } from "@/lib/sre-types";

// ─── Props ───────────────────────────────────────────────

interface SREModePanelProps {
  open: boolean;
  onClose: () => void;
  callAI: (type: string, prompt: string, context?: string) => Promise<string>;
}

// ─── Constants ───────────────────────────────────────────

const SERVICE_TYPES: ServiceNode["type"][] = [
  "api", "database", "cache", "queue", "storage", "cdn", "gateway", "worker", "external",
];

const SERVICE_TYPE_ICONS: Record<ServiceNode["type"], React.ReactNode> = {
  api: <Server size={14} />,
  database: <DatabaseIcon size={14} />,
  cache: <Zap size={14} />,
  queue: <Radio size={14} />,
  storage: <HardDrive size={14} />,
  cdn: <Globe size={14} />,
  gateway: <Shield size={14} />,
  worker: <Play size={14} />,
  external: <Globe size={14} />,
};

const STATUS_COLORS: Record<ServiceNode["status"], string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-yellow-500",
  down: "bg-red-500",
  unknown: "bg-gray-500",
};

const SEVERITY_COLORS: Record<Incident["severity"], string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const SEVERITY_ORDER: Record<Incident["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type TabKey = "services" | "incidents" | "runbooks";

// ─── localStorage helpers ────────────────────────────────

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return fallback;
}

function saveToStorage<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ─── Robust JSON parse ───────────────────────────────────

function robustJsonParse(str: string): any {
  str = str.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(str); } catch {}
  const firstBrace = str.search(/[{\[]/);
  const lastClose = Math.max(str.lastIndexOf("}"), str.lastIndexOf("]"));
  if (firstBrace !== -1 && lastClose > firstBrace) {
    str = str.substring(firstBrace, lastClose + 1);
  }
  try { return JSON.parse(str); } catch {}
  let cleaned = str;
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
  cleaned = cleaned.replace(/[\x00-\x1f]/g, (ch) => ch === "\n" || ch === "\r" || ch === "\t" ? " " : "");
  try { return JSON.parse(cleaned); } catch {}
  throw new Error("Failed to parse AI response as JSON");
}

// ─── Build service context ───────────────────────────────

function buildServiceContext(services: ServiceNode[]): string {
  if (services.length === 0) return "No services defined yet.";
  const svcList = services.map(s => `${s.name} (${s.type}, ${s.status})`).join(", ");
  const deps = services
    .filter(s => s.dependencies.length > 0)
    .map(s => {
      const depNames = s.dependencies
        .map(dId => services.find(x => x.id === dId)?.name || dId)
        .join(", ");
      return `${s.name} -> ${depNames}`;
    })
    .join("; ");
  return `Services: [${svcList}]\nDependencies: ${deps || "none"}`;
}

// ─── Component ───────────────────────────────────────────

const SREModePanel: React.FC<SREModePanelProps> = ({ open, onClose, callAI }) => {
  const [activeTab, setActiveTab] = useState<TabKey>("services");

  // ── Services state ──
  const [services, setServices] = useState<ServiceNode[]>(() =>
    loadFromStorage<ServiceNode[]>("vibedb_sre_services", [])
  );
  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceType, setNewServiceType] = useState<ServiceNode["type"]>("api");
  const [newServiceUrl, setNewServiceUrl] = useState("");
  const [newServiceDesc, setNewServiceDesc] = useState("");
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);

  // ── Incidents state ──
  const [incidents, setIncidents] = useState<Incident[]>(() =>
    loadFromStorage<Incident[]>("vibedb_sre_incidents", [])
  );
  const [showAddIncident, setShowAddIncident] = useState(false);
  const [newIncidentTitle, setNewIncidentTitle] = useState("");
  const [newIncidentSeverity, setNewIncidentSeverity] = useState<Incident["severity"]>("medium");
  const [newIncidentAffected, setNewIncidentAffected] = useState<string[]>([]);
  const [newIncidentDesc, setNewIncidentDesc] = useState("");
  const [expandedIncidentId, setExpandedIncidentId] = useState<string | null>(null);
  const [newTimelineMsg, setNewTimelineMsg] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, string>>({});
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState<Record<string, boolean>>({});
  const [showAnalysis, setShowAnalysis] = useState<Record<string, boolean>>({});

  // ── Runbooks state ──
  const [runbooks, setRunbooks] = useState<Runbook[]>(() =>
    loadFromStorage<Runbook[]>("vibedb_sre_runbooks", [])
  );
  const [showGenRunbook, setShowGenRunbook] = useState(false);
  const [runbookServiceId, setRunbookServiceId] = useState("");
  const [runbookLoading, setRunbookLoading] = useState(false);
  const [copiedRunbookId, setCopiedRunbookId] = useState<string | null>(null);
  const [expandedRunbookId, setExpandedRunbookId] = useState<string | null>(null);

  // ── Persist to localStorage ──
  useEffect(() => { saveToStorage("vibedb_sre_services", services); }, [services]);
  useEffect(() => { saveToStorage("vibedb_sre_incidents", incidents); }, [incidents]);
  useEffect(() => { saveToStorage("vibedb_sre_runbooks", runbooks); }, [runbooks]);

  // ── Service helpers ──
  const getServiceName = useCallback((id: string) => {
    return services.find(s => s.id === id)?.name || id;
  }, [services]);

  const addService = () => {
    if (!newServiceName.trim()) return;
    const svc: ServiceNode = {
      id: uuidv4(),
      name: newServiceName.trim(),
      type: newServiceType,
      status: "unknown",
      url: newServiceUrl.trim() || undefined,
      description: newServiceDesc.trim() || undefined,
      x: 0,
      y: 0,
      dependencies: [],
    };
    setServices(prev => [...prev, svc]);
    setNewServiceName("");
    setNewServiceType("api");
    setNewServiceUrl("");
    setNewServiceDesc("");
    setShowAddService(false);
  };

  const deleteService = (id: string) => {
    setServices(prev => prev.filter(s => s.id !== id));
    // Also remove from dependencies of other services
    setServices(prev => prev.map(s => ({
      ...s,
      dependencies: s.dependencies.filter(d => d !== id),
    })));
  };

  const toggleServiceStatus = (id: string) => {
    const cycle: ServiceNode["status"][] = ["healthy", "degraded", "down", "unknown"];
    setServices(prev => prev.map(s => {
      if (s.id !== id) return s;
      const idx = cycle.indexOf(s.status);
      return { ...s, status: cycle[(idx + 1) % cycle.length] };
    }));
  };

  const updateServiceMetric = (id: string, key: string, value: string) => {
    const num = value === "" ? undefined : Number(value);
    setServices(prev => prev.map(s => {
      if (s.id !== id) return s;
      return { ...s, metrics: { ...s.metrics, [key]: num } };
    }));
  };

  const toggleDependency = (serviceId: string, depId: string) => {
    setServices(prev => prev.map(s => {
      if (s.id !== serviceId) return s;
      const has = s.dependencies.includes(depId);
      return {
        ...s,
        dependencies: has
          ? s.dependencies.filter(d => d !== depId)
          : [...s.dependencies, depId],
      };
    }));
  };

  // ── Incident helpers ──
  const addIncident = () => {
    if (!newIncidentTitle.trim()) return;
    const inc: Incident = {
      id: uuidv4(),
      title: newIncidentTitle.trim(),
      severity: newIncidentSeverity,
      status: "active",
      affectedServices: newIncidentAffected,
      description: newIncidentDesc.trim(),
      timeline: [{ timestamp: Date.now(), message: "Incident created" }],
      createdAt: Date.now(),
    };
    setIncidents(prev => [...prev, inc]);
    setNewIncidentTitle("");
    setNewIncidentSeverity("medium");
    setNewIncidentAffected([]);
    setNewIncidentDesc("");
    setShowAddIncident(false);
  };

  const addTimelineEntry = (incidentId: string) => {
    if (!newTimelineMsg.trim()) return;
    setIncidents(prev => prev.map(inc => {
      if (inc.id !== incidentId) return inc;
      return {
        ...inc,
        timeline: [...inc.timeline, { timestamp: Date.now(), message: newTimelineMsg.trim() }],
      };
    }));
    setNewTimelineMsg("");
  };

  const resolveIncident = (id: string) => {
    setIncidents(prev => prev.map(inc => {
      if (inc.id !== id) return inc;
      return {
        ...inc,
        status: "resolved" as const,
        resolvedAt: Date.now(),
        timeline: [...inc.timeline, { timestamp: Date.now(), message: "Incident resolved" }],
      };
    }));
  };

  const analyzeIncident = async (incident: Incident) => {
    setAiAnalysisLoading(prev => ({ ...prev, [incident.id]: true }));
    try {
      const prompt = `Analyze this incident and provide root cause analysis, impact assessment, and recommended actions:\n\nTitle: ${incident.title}\nSeverity: ${incident.severity}\nStatus: ${incident.status}\nDescription: ${incident.description}\nAffected Services: ${incident.affectedServices.map(id => getServiceName(id)).join(", ")}\nTimeline:\n${incident.timeline.map(t => `- ${new Date(t.timestamp).toLocaleString()}: ${t.message}`).join("\n")}`;
      const ctx = buildServiceContext(services);
      const result = await callAI("sre-analyze-incident", prompt, ctx);
      setAiAnalysis(prev => ({ ...prev, [incident.id]: result }));
      setShowAnalysis(prev => ({ ...prev, [incident.id]: true }));
    } catch (e: any) {
      setAiAnalysis(prev => ({ ...prev, [incident.id]: `Error: ${e.message}` }));
      setShowAnalysis(prev => ({ ...prev, [incident.id]: true }));
    } finally {
      setAiAnalysisLoading(prev => ({ ...prev, [incident.id]: false }));
    }
  };

  // ── Runbook helpers ──
  const generateRunbook = async () => {
    if (!runbookServiceId) return;
    const svc = services.find(s => s.id === runbookServiceId);
    if (!svc) return;
    setRunbookLoading(true);
    try {
      const prompt = `Generate a detailed operational runbook for the "${svc.name}" service (type: ${svc.type}, status: ${svc.status}). Include troubleshooting steps, health check commands, and recovery procedures. Return JSON in this format: { "title": "...", "steps": [{ "order": 1, "action": "...", "command": "...", "expected": "..." }] }`;
      const ctx = buildServiceContext(services);
      const result = await callAI("sre-generate-runbook", prompt, ctx);
      const parsed = robustJsonParse(result);
      const rb: Runbook = {
        id: uuidv4(),
        title: parsed.title || `Runbook: ${svc.name}`,
        serviceId: svc.id,
        steps: Array.isArray(parsed.steps) ? parsed.steps.map((s: any, i: number) => ({
          order: s.order || i + 1,
          action: s.action || "",
          command: s.command || undefined,
          expected: s.expected || undefined,
        })) : [],
        createdAt: Date.now(),
      };
      setRunbooks(prev => [...prev, rb]);
      setShowGenRunbook(false);
      setRunbookServiceId("");
    } catch (e: any) {
      // Show error inline -- could use toast in real integration
      console.error("Runbook generation failed:", e);
    } finally {
      setRunbookLoading(false);
    }
  };

  const copyRunbookAsMarkdown = (rb: Runbook) => {
    const svcName = getServiceName(rb.serviceId);
    let md = `# ${rb.title}\n\n**Service:** ${svcName}\n**Created:** ${new Date(rb.createdAt).toLocaleString()}\n\n`;
    rb.steps.forEach(step => {
      md += `## Step ${step.order}: ${step.action}\n\n`;
      if (step.command) md += `\`\`\`\n${step.command}\n\`\`\`\n\n`;
      if (step.expected) md += `**Expected:** ${step.expected}\n\n`;
    });
    navigator.clipboard.writeText(md);
    setCopiedRunbookId(rb.id);
    setTimeout(() => setCopiedRunbookId(null), 2000);
  };

  const deleteRunbook = (id: string) => {
    setRunbooks(prev => prev.filter(r => r.id !== id));
  };

  // ── Sorted incidents ──
  const sortedIncidents = [...incidents].sort((a, b) => {
    if (a.status === "resolved" && b.status !== "resolved") return 1;
    if (a.status !== "resolved" && b.status === "resolved") return -1;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });

  // ── Render ──
  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed right-0 top-0 bottom-0 z-50 w-[500px] border-l border-border bg-card shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10">
                <Activity size={14} className="text-orange-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold">SRE Mode</h3>
                <p className="text-[10px] text-muted-foreground">Services, Incidents & Runbooks</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-secondary transition"
            >
              <X size={14} />
            </button>
          </div>

          {/* Tab Bar */}
          <div className="flex border-b border-border shrink-0">
            {([
              { key: "services" as TabKey, label: "Services", icon: <Server size={12} /> },
              { key: "incidents" as TabKey, label: "Incidents", icon: <AlertTriangle size={12} /> },
              { key: "runbooks" as TabKey, label: "Runbooks", icon: <FileText size={12} /> },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition border-b-2 ${
                  activeTab === tab.key
                    ? "border-orange-500 text-orange-500"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.key === "services" && services.length > 0 && (
                  <span className="ml-1 text-[10px] bg-secondary rounded-full px-1.5">{services.length}</span>
                )}
                {tab.key === "incidents" && incidents.filter(i => i.status !== "resolved").length > 0 && (
                  <span className="ml-1 text-[10px] bg-red-500/20 text-red-400 rounded-full px-1.5">
                    {incidents.filter(i => i.status !== "resolved").length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {/* ═══════════ Services Tab ═══════════ */}
            {activeTab === "services" && (
              <>
                <button
                  onClick={() => setShowAddService(!showAddService)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-orange-500/40 hover:bg-secondary/50 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
                >
                  <Plus size={12} />
                  Add Service
                </button>

                {/* Add Service Form */}
                <AnimatePresence>
                  {showAddService && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                        <input
                          value={newServiceName}
                          onChange={e => setNewServiceName(e.target.value)}
                          placeholder="Service name"
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition"
                        />
                        <select
                          value={newServiceType}
                          onChange={e => setNewServiceType(e.target.value as ServiceNode["type"])}
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition"
                        >
                          {SERVICE_TYPES.map(t => (
                            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                          ))}
                        </select>
                        <input
                          value={newServiceUrl}
                          onChange={e => setNewServiceUrl(e.target.value)}
                          placeholder="URL (optional)"
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition"
                        />
                        <input
                          value={newServiceDesc}
                          onChange={e => setNewServiceDesc(e.target.value)}
                          placeholder="Description (optional)"
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={addService}
                            disabled={!newServiceName.trim()}
                            className="flex-1 rounded-md bg-orange-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-orange-600 disabled:opacity-40 transition"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => setShowAddService(false)}
                            className="rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/80 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Service List */}
                {services.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                    <Server size={32} className="mb-3 opacity-30" />
                    No services defined yet.
                    <br />Add your first service to get started.
                  </div>
                ) : (
                  services.map(svc => (
                    <div key={svc.id} className="rounded-lg border border-border bg-background">
                      <button
                        onClick={() => setExpandedServiceId(expandedServiceId === svc.id ? null : svc.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary shrink-0">
                          {SERVICE_TYPE_ICONS[svc.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold truncate">{svc.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{svc.type}</span>
                          </div>
                          {svc.url && (
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">{svc.url}</div>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); toggleServiceStatus(svc.id); }}
                          className="flex items-center gap-1.5 shrink-0"
                          title="Click to cycle status"
                        >
                          <div className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[svc.status]}`} />
                          <span className="text-[10px] text-muted-foreground capitalize">{svc.status}</span>
                        </button>
                        {expandedServiceId === svc.id ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                      </button>

                      <AnimatePresence>
                        {expandedServiceId === svc.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                              {svc.description && (
                                <p className="text-[11px] text-muted-foreground">{svc.description}</p>
                              )}

                              {/* Metrics */}
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Metrics</p>
                                <div className="grid grid-cols-2 gap-1.5">
                                  {(["uptime", "latency", "errorRate", "requestsPerMin"] as const).map(key => (
                                    <div key={key} className="flex items-center gap-1.5">
                                      <label className="text-[10px] text-muted-foreground w-16 shrink-0 capitalize">
                                        {key === "requestsPerMin" ? "req/min" : key === "errorRate" ? "err %" : key === "uptime" ? "uptime %" : "latency ms"}
                                      </label>
                                      <input
                                        type="number"
                                        value={svc.metrics?.[key] ?? ""}
                                        onChange={e => updateServiceMetric(svc.id, key, e.target.value)}
                                        className="w-full rounded border border-border bg-card px-1.5 py-1 text-[10px] outline-none focus:border-orange-500/50 transition"
                                        placeholder="--"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Dependencies */}
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Dependencies</p>
                                <div className="flex flex-wrap gap-1">
                                  {services.filter(s => s.id !== svc.id).map(dep => {
                                    const isSelected = svc.dependencies.includes(dep.id);
                                    return (
                                      <button
                                        key={dep.id}
                                        onClick={() => toggleDependency(svc.id, dep.id)}
                                        className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                                          isSelected
                                            ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                                            : "border-border text-muted-foreground hover:border-orange-500/20"
                                        }`}
                                      >
                                        {dep.name}
                                      </button>
                                    );
                                  })}
                                  {services.length <= 1 && (
                                    <span className="text-[10px] text-muted-foreground">Add more services to set dependencies</span>
                                  )}
                                </div>
                              </div>

                              {/* Delete */}
                              <button
                                onClick={() => deleteService(svc.id)}
                                className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition"
                              >
                                <Trash2 size={10} />
                                Delete Service
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))
                )}
              </>
            )}

            {/* ═══════════ Incidents Tab ═══════════ */}
            {activeTab === "incidents" && (
              <>
                <button
                  onClick={() => setShowAddIncident(!showAddIncident)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-orange-500/40 hover:bg-secondary/50 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
                >
                  <Plus size={12} />
                  Log Incident
                </button>

                {/* Add Incident Form */}
                <AnimatePresence>
                  {showAddIncident && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                        <input
                          value={newIncidentTitle}
                          onChange={e => setNewIncidentTitle(e.target.value)}
                          placeholder="Incident title"
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition"
                        />
                        <select
                          value={newIncidentSeverity}
                          onChange={e => setNewIncidentSeverity(e.target.value as Incident["severity"])}
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition"
                        >
                          <option value="critical">Critical</option>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>

                        {/* Multi-select affected services */}
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Affected Services</p>
                          <div className="flex flex-wrap gap-1">
                            {services.length === 0 ? (
                              <span className="text-[10px] text-muted-foreground">No services defined</span>
                            ) : (
                              services.map(svc => {
                                const isSelected = newIncidentAffected.includes(svc.id);
                                return (
                                  <button
                                    key={svc.id}
                                    onClick={() => {
                                      setNewIncidentAffected(prev =>
                                        isSelected ? prev.filter(id => id !== svc.id) : [...prev, svc.id]
                                      );
                                    }}
                                    className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                                      isSelected
                                        ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                                        : "border-border text-muted-foreground hover:border-orange-500/20"
                                    }`}
                                  >
                                    {svc.name}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <textarea
                          value={newIncidentDesc}
                          onChange={e => setNewIncidentDesc(e.target.value)}
                          placeholder="Description"
                          rows={2}
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={addIncident}
                            disabled={!newIncidentTitle.trim()}
                            className="flex-1 rounded-md bg-orange-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-orange-600 disabled:opacity-40 transition"
                          >
                            Log
                          </button>
                          <button
                            onClick={() => setShowAddIncident(false)}
                            className="rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/80 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Incident List */}
                {sortedIncidents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                    <CheckCircle2 size={32} className="mb-3 opacity-30" />
                    No incidents recorded.
                    <br />All systems operational.
                  </div>
                ) : (
                  sortedIncidents.map(inc => (
                    <div
                      key={inc.id}
                      className={`rounded-lg border bg-background ${
                        inc.status === "resolved" ? "border-border opacity-60" : "border-border"
                      }`}
                    >
                      <button
                        onClick={() => setExpandedIncidentId(expandedIncidentId === inc.id ? null : inc.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        {inc.status === "resolved" ? (
                          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        ) : inc.severity === "critical" ? (
                          <XCircle size={14} className="text-red-500 shrink-0" />
                        ) : (
                          <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold truncate">{inc.title}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[inc.severity]}`}>
                              {inc.severity}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground capitalize">{inc.status}</span>
                            {inc.affectedServices.length > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {inc.affectedServices.map(id => getServiceName(id)).join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                        {expandedIncidentId === inc.id ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                      </button>

                      <AnimatePresence>
                        {expandedIncidentId === inc.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                              {inc.description && (
                                <p className="text-[11px] text-muted-foreground">{inc.description}</p>
                              )}

                              {/* Timeline */}
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Timeline</p>
                                <div className="space-y-1">
                                  {inc.timeline.map((entry, i) => (
                                    <div key={i} className="flex items-start gap-2 text-[10px]">
                                      <Clock size={10} className="mt-0.5 shrink-0 text-muted-foreground" />
                                      <span className="text-muted-foreground shrink-0">
                                        {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                      <span className="text-foreground">{entry.message}</span>
                                    </div>
                                  ))}
                                </div>

                                {/* Add timeline entry */}
                                {inc.status !== "resolved" && (
                                  <div className="flex gap-1.5 mt-2">
                                    <input
                                      value={newTimelineMsg}
                                      onChange={e => setNewTimelineMsg(e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter") { addTimelineEntry(inc.id); } }}
                                      placeholder="Add timeline entry..."
                                      className="flex-1 rounded border border-border bg-card px-2 py-1 text-[10px] outline-none focus:border-orange-500/50 transition"
                                    />
                                    <button
                                      onClick={() => addTimelineEntry(inc.id)}
                                      disabled={!newTimelineMsg.trim()}
                                      className="rounded bg-secondary px-2 py-1 text-[10px] font-semibold hover:bg-secondary/80 disabled:opacity-40 transition"
                                    >
                                      Add
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* AI Analysis */}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => analyzeIncident(inc)}
                                  disabled={aiAnalysisLoading[inc.id]}
                                  className="flex items-center gap-1.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-400 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-orange-500/20 disabled:opacity-40 transition"
                                >
                                  {aiAnalysisLoading[inc.id] ? (
                                    <Loader2 size={10} className="animate-spin" />
                                  ) : (
                                    <Activity size={10} />
                                  )}
                                  Analyze with AI
                                </button>
                                {inc.status !== "resolved" && (
                                  <button
                                    onClick={() => resolveIncident(inc.id)}
                                    className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-emerald-500/20 transition"
                                  >
                                    <CheckCircle2 size={10} />
                                    Resolve
                                  </button>
                                )}
                              </div>

                              {/* AI Analysis Result */}
                              {aiAnalysis[inc.id] && (
                                <div>
                                  <button
                                    onClick={() => setShowAnalysis(prev => ({ ...prev, [inc.id]: !prev[inc.id] }))}
                                    className="flex items-center gap-1 text-[10px] font-semibold text-orange-400 mb-1"
                                  >
                                    {showAnalysis[inc.id] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                    AI Analysis
                                  </button>
                                  <AnimatePresence>
                                    {showAnalysis[inc.id] && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="rounded-md border border-orange-500/20 bg-orange-500/5 p-2.5 text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
                                          {aiAnalysis[inc.id]}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))
                )}
              </>
            )}

            {/* ═══════════ Runbooks Tab ═══════════ */}
            {activeTab === "runbooks" && (
              <>
                <button
                  onClick={() => setShowGenRunbook(!showGenRunbook)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-orange-500/40 hover:bg-secondary/50 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
                >
                  <Plus size={12} />
                  Generate Runbook
                </button>

                {/* Generate Runbook Form */}
                <AnimatePresence>
                  {showGenRunbook && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                        <p className="text-[10px] text-muted-foreground">Select a service to generate a runbook for:</p>
                        <select
                          value={runbookServiceId}
                          onChange={e => setRunbookServiceId(e.target.value)}
                          className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-orange-500/50 transition"
                        >
                          <option value="">-- Select service --</option>
                          {services.map(svc => (
                            <option key={svc.id} value={svc.id}>{svc.name} ({svc.type})</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={generateRunbook}
                            disabled={!runbookServiceId || runbookLoading}
                            className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-orange-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-orange-600 disabled:opacity-40 transition"
                          >
                            {runbookLoading ? (
                              <>
                                <Loader2 size={10} className="animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Activity size={10} />
                                Generate
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => { setShowGenRunbook(false); setRunbookServiceId(""); }}
                            className="rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/80 transition"
                          >
                            Cancel
                          </button>
                        </div>
                        {services.length === 0 && (
                          <p className="text-[10px] text-yellow-400">Add services in the Services tab first.</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Runbook List */}
                {runbooks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                    <FileText size={32} className="mb-3 opacity-30" />
                    No runbooks yet.
                    <br />Generate one from your services.
                  </div>
                ) : (
                  runbooks.map(rb => (
                    <div key={rb.id} className="rounded-lg border border-border bg-background">
                      <button
                        onClick={() => setExpandedRunbookId(expandedRunbookId === rb.id ? null : rb.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        <FileText size={14} className="text-orange-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{rb.title}</div>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                            <span>{getServiceName(rb.serviceId)}</span>
                            <span>{rb.steps.length} steps</span>
                            <span>{new Date(rb.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={e => { e.stopPropagation(); copyRunbookAsMarkdown(rb); }}
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-secondary transition"
                            title="Copy as Markdown"
                          >
                            {copiedRunbookId === rb.id ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); deleteRunbook(rb.id); }}
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-secondary transition text-red-400"
                            title="Delete runbook"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                        {expandedRunbookId === rb.id ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                      </button>

                      <AnimatePresence>
                        {expandedRunbookId === rb.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-3 space-y-2 border-t border-border pt-3">
                              {rb.steps.map(step => (
                                <div key={step.order} className="rounded-md border border-border bg-card p-2.5">
                                  <div className="flex items-start gap-2">
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500/10 text-orange-400 text-[10px] font-bold shrink-0">
                                      {step.order}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] font-semibold">{step.action}</p>
                                      {step.command && (
                                        <pre className="mt-1.5 rounded bg-background border border-border px-2 py-1.5 text-[10px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                                          {step.command}
                                        </pre>
                                      )}
                                      {step.expected && (
                                        <p className="mt-1 text-[10px] text-muted-foreground">
                                          <span className="font-semibold text-emerald-400">Expected:</span> {step.expected}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2 shrink-0">
            <p className="text-[9px] text-muted-foreground text-center">
              {services.length} service{services.length !== 1 ? "s" : ""} &middot;{" "}
              {incidents.filter(i => i.status !== "resolved").length} active incident{incidents.filter(i => i.status !== "resolved").length !== 1 ? "s" : ""} &middot;{" "}
              {runbooks.length} runbook{runbooks.length !== 1 ? "s" : ""}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SREModePanel;
