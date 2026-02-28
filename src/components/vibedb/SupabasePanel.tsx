import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Database,
  Download,
  Shield,
  Code,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { TableNode } from "@/lib/types";
import {
  introspectSupabaseSchema,
  generateRLSPolicies,
  generateSupabaseTypes,
  type SupabaseProject,
} from "@/lib/supabase-integration";

interface SupabasePanelProps {
  open: boolean;
  onClose: () => void;
  canvasItems: TableNode[];
  onImportSchema: (tables: TableNode[]) => void;
}

const STORAGE_KEY = "vibedb_supabase_project";

function loadSavedProject(): { url: string; anonKey: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { url: parsed.url || "", anonKey: parsed.anonKey || "" };
    }
  } catch {
    // ignore
  }
  return { url: "", anonKey: "" };
}

function saveProject(url: string, anonKey: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, anonKey }));
}

const SupabasePanel: React.FC<SupabasePanelProps> = ({
  open,
  onClose,
  canvasItems,
  onImportSchema,
}) => {
  // Connection state
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [connected, setConnected] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // Section collapse state
  const [connectOpen, setConnectOpen] = useState(true);
  const [rlsOpen, setRlsOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);

  // RLS state
  const [rlsSql, setRlsSql] = useState("");
  const [rlsCopied, setRlsCopied] = useState(false);

  // Types state
  const [typesTs, setTypesTs] = useState("");
  const [typesCopied, setTypesCopied] = useState(false);

  // Load saved project on mount
  useEffect(() => {
    if (open) {
      const saved = loadSavedProject();
      if (saved.url) setUrl(saved.url);
      if (saved.anonKey) setAnonKey(saved.anonKey);
    }
  }, [open]);

  // Connect and import schema
  const handleConnect = async () => {
    if (!url.trim() || !anonKey.trim()) {
      setConnectError("Both URL and anon key are required.");
      return;
    }

    setConnecting(true);
    setConnectError("");
    setConnected(false);
    setImportedCount(0);

    try {
      const project: SupabaseProject = {
        url: url.trim().replace(/\/$/, ""),
        anonKey: anonKey.trim(),
      };

      const tables = await introspectSupabaseSchema(project);

      if (tables.length === 0) {
        setConnectError(
          "Connected successfully but no tables found. Make sure your schema has tables."
        );
        setConnecting(false);
        return;
      }

      saveProject(project.url, project.anonKey);
      onImportSchema(tables);
      setConnected(true);
      setImportedCount(tables.length);
    } catch (e: any) {
      setConnectError(e.message || "Failed to connect to Supabase project.");
    } finally {
      setConnecting(false);
    }
  };

  // Generate RLS policies
  const handleGenerateRLS = () => {
    const sql = generateRLSPolicies(canvasItems);
    setRlsSql(sql);
    setRlsCopied(false);
  };

  // Generate TypeScript types
  const handleGenerateTypes = () => {
    const ts = generateSupabaseTypes(canvasItems);
    setTypesTs(ts);
    setTypesCopied(false);
  };

  // Copy to clipboard helper
  const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed right-0 top-0 bottom-0 z-50 w-[420px] border-l border-border bg-card shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                <Database size={14} className="text-emerald-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Supabase Integration</h3>
                <p className="text-[10px] text-muted-foreground">
                  Import, RLS & type generation
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

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* ── Connect Section ── */}
            <div className="border-b border-border">
              <button
                onClick={() => setConnectOpen(!connectOpen)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-secondary/30 transition"
              >
                {connectOpen ? (
                  <ChevronDown size={14} className="text-muted-foreground" />
                ) : (
                  <ChevronRight size={14} className="text-muted-foreground" />
                )}
                <Download size={14} className="text-emerald-500" />
                <span className="text-xs font-semibold">
                  Connect & Import Schema
                </span>
                {connected && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-500">
                    <Check size={10} />
                    Connected
                  </span>
                )}
              </button>

              <AnimatePresence>
                {connectOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          Supabase Project URL
                        </label>
                        <input
                          type="url"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="https://your-project.supabase.co"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-emerald-500 transition placeholder:text-muted-foreground/50"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          Anon Key
                        </label>
                        <input
                          type="password"
                          value={anonKey}
                          onChange={(e) => setAnonKey(e.target.value)}
                          placeholder="eyJhbGciOiJIUzI1NiIs..."
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-emerald-500 transition placeholder:text-muted-foreground/50 font-mono"
                        />
                      </div>

                      {connectError && (
                        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                          <AlertCircle
                            size={12}
                            className="text-destructive mt-0.5 shrink-0"
                          />
                          <p className="text-[11px] text-destructive">
                            {connectError}
                          </p>
                        </div>
                      )}

                      {connected && importedCount > 0 && (
                        <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                          <Check
                            size={12}
                            className="text-emerald-500 mt-0.5 shrink-0"
                          />
                          <p className="text-[11px] text-emerald-500">
                            Imported {importedCount} table
                            {importedCount !== 1 ? "s" : ""} from your Supabase
                            project.
                          </p>
                        </div>
                      )}

                      <button
                        onClick={handleConnect}
                        disabled={connecting || !url.trim() || !anonKey.trim()}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold hover:bg-emerald-700 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {connecting ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <Database size={14} />
                            Connect & Import Schema
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── RLS Policies Section ── */}
            <div className="border-b border-border">
              <button
                onClick={() => setRlsOpen(!rlsOpen)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-secondary/30 transition"
              >
                {rlsOpen ? (
                  <ChevronDown size={14} className="text-muted-foreground" />
                ) : (
                  <ChevronRight size={14} className="text-muted-foreground" />
                )}
                <Shield size={14} className="text-amber-500" />
                <span className="text-xs font-semibold">RLS Policies</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {canvasItems.filter((t) =>
                    t.columns.some(
                      (c) => c.name === "user_id" && c.isForeignKey
                    )
                  ).length}{" "}
                  eligible tables
                </span>
              </button>

              <AnimatePresence>
                {rlsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Generate Row Level Security policies for tables with a{" "}
                        <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">
                          user_id
                        </code>{" "}
                        foreign key column. Each table gets SELECT, INSERT,
                        UPDATE, and DELETE policies scoped to{" "}
                        <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">
                          auth.uid()
                        </code>
                        .
                      </p>

                      <button
                        onClick={handleGenerateRLS}
                        disabled={canvasItems.length === 0}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-600 text-white px-4 py-2.5 text-xs font-bold hover:bg-amber-700 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Shield size={14} />
                        Generate RLS Policies
                      </button>

                      {rlsSql && (
                        <div className="relative">
                          <div className="absolute top-2 right-2 z-10">
                            <button
                              onClick={() =>
                                copyToClipboard(rlsSql, setRlsCopied)
                              }
                              className="flex items-center gap-1 rounded-md bg-secondary/80 backdrop-blur px-2 py-1 text-[10px] font-semibold hover:bg-secondary transition"
                            >
                              {rlsCopied ? (
                                <>
                                  <Check size={10} className="text-emerald-500" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy size={10} />
                                  Copy
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="rounded-lg border border-border bg-background p-3 pt-8 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar text-muted-foreground">
                            {rlsSql}
                          </pre>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── TypeScript Types Section ── */}
            <div className="border-b border-border">
              <button
                onClick={() => setTypesOpen(!typesOpen)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-secondary/30 transition"
              >
                {typesOpen ? (
                  <ChevronDown size={14} className="text-muted-foreground" />
                ) : (
                  <ChevronRight size={14} className="text-muted-foreground" />
                )}
                <Code size={14} className="text-blue-500" />
                <span className="text-xs font-semibold">TypeScript Types</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {canvasItems.length} table{canvasItems.length !== 1 ? "s" : ""}
                </span>
              </button>

              <AnimatePresence>
                {typesOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Generate a{" "}
                        <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">
                          Database
                        </code>{" "}
                        type interface compatible with the Supabase JS client.
                        Includes Row, Insert, and Update types for each table.
                      </p>

                      <button
                        onClick={handleGenerateTypes}
                        disabled={canvasItems.length === 0}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2.5 text-xs font-bold hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Code size={14} />
                        Generate TypeScript Types
                      </button>

                      {typesTs && (
                        <div className="relative">
                          <div className="absolute top-2 right-2 z-10">
                            <button
                              onClick={() =>
                                copyToClipboard(typesTs, setTypesCopied)
                              }
                              className="flex items-center gap-1 rounded-md bg-secondary/80 backdrop-blur px-2 py-1 text-[10px] font-semibold hover:bg-secondary transition"
                            >
                              {typesCopied ? (
                                <>
                                  <Check size={10} className="text-emerald-500" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy size={10} />
                                  Copy
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="rounded-lg border border-border bg-background p-3 pt-8 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar text-blue-400/80">
                            {typesTs}
                          </pre>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2.5 shrink-0">
            <p className="text-[9px] text-muted-foreground text-center">
              {canvasItems.length > 0
                ? `${canvasItems.length} table${canvasItems.length !== 1 ? "s" : ""} on canvas`
                : "Import a schema or add tables to get started"}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SupabasePanel;
