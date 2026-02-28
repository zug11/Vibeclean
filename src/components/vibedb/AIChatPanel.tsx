import React, { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Send, X, Loader2, CheckCircle2, Sparkles, ChevronRight, AlertCircle } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { findDuplicateIndex } from "@/components/vibedb/ExportGenerators";

// ─── Types ───────────────────────────────────────────────

import type { Column, TableNode } from "@/lib/types";

interface ChatSuggestion {
  id: string;
  type: string;
  description: string;
  applied: boolean;
  payload: any;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: ChatSuggestion[];
  askToApply?: boolean;
  timestamp: number;
  isError?: boolean;
}

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
  canvasItems: TableNode[];
  setCanvasItems: (action: TableNode[] | ((prev: TableNode[]) => TableNode[])) => void;
  addToast: (message: string, type: "info" | "success" | "error" | "warning") => void;
  view: { x: number; y: number; zoom: number };
  projectId?: string | null;
  onAddEnum?: (e: { name: string; values: string[] }) => void;
  onAddFunction?: (f: { name: string; body: string }) => void;
}

// ─── Utilities ───────────────────────────────────────────

async function callAI(type: string, prompt: string, context?: string) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const res = await fetch(`${supabaseUrl}/functions/v1/vibedb-ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ type, prompt, context }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `AI service error (${res.status})`);
  if (data?.error) throw new Error(data.error);
  const result = data?.result || "";
  return result.replace(/```json\n?/g, "").replace(/```sql\n?/g, "").replace(/```\n?/g, "").trim();
}

function robustJsonParse(str: string): any {
  str = str.replace(/```json\n?/gi, "").replace(/```sql\n?/gi, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(str); } catch {}
  const firstBrace = str.search(/[{\[]/);
  const lastClose = Math.max(str.lastIndexOf("}"), str.lastIndexOf("]"));
  if (firstBrace !== -1 && lastClose > firstBrace) {
    str = str.substring(firstBrace, lastClose + 1);
  }
  try { return JSON.parse(str); } catch {}
  let cleaned = str;
  cleaned = cleaned.replace(/(?<="[^"]*")\s*\/\/[^\n]*/g, "");
  cleaned = cleaned.replace(/^\s*\/\/[^\n]*/gm, "");
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
  cleaned = cleaned.replace(/:\s*'([^']*)'/g, ': "$1"');
  cleaned = cleaned.replace(/[\x00-\x1f]/g, (ch) => ch === "\n" || ch === "\r" || ch === "\t" ? " " : "");
  try { return JSON.parse(cleaned); } catch {}
  let fixed = cleaned;
  let openBraces = 0, openBrackets = 0, inString = false, escape = false;
  for (const ch of fixed) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }
  fixed = fixed.replace(/,\s*$/, "");
  for (let i = 0; i < openBrackets; i++) fixed += "]";
  for (let i = 0; i < openBraces; i++) fixed += "}";
  try { return JSON.parse(fixed); } catch {}
  throw new Error("Failed to parse AI response as JSON");
}

// ─── Suggestion Action Labels ────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  add_table: "Add Table",
  add_column: "Add Column",
  rename_table: "Rename Table",
  rename_column: "Rename Column",
  change_type: "Change Type",
  add_index: "Add Index",
  add_fk: "Add FK",
  remove_column: "Remove Column",
  remove_table: "Remove Table",
};

const ACTION_COLORS: Record<string, string> = {
  add_table: "text-emerald-400",
  add_column: "text-emerald-400",
  rename_table: "text-blue-400",
  rename_column: "text-blue-400",
  change_type: "text-amber-400",
  add_index: "text-violet-400",
  add_fk: "text-violet-400",
  remove_column: "text-red-400",
  remove_table: "text-red-400",
};

// ─── Component ───────────────────────────────────────────

const AIChatPanel: React.FC<AIChatPanelProps> = ({
  open,
  onClose,
  canvasItems,
  setCanvasItems,
  addToast,
  view,
  projectId,
  onAddEnum,
  onAddFunction,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevProjectIdRef = useRef<string | null | undefined>(projectId);

  // Clear chat when project changes
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      setMessages([]);
      setInputValue("");
      prevProjectIdRef.current = projectId;
    }
  }, [projectId]);

  // Auto-scroll to bottom only when a NEW message is added (not on suggestion apply)
  const messageCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > messageCountRef.current) {
      // A new message was added — scroll to bottom
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
    }
    messageCountRef.current = messages.length;
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  // Build conversation transcript (last 10 messages for context window)
  const buildTranscript = useCallback((newInput: string) => {
    const recent = messages.slice(-10);
    let transcript = "";
    for (const msg of recent) {
      if (msg.role === "user") {
        transcript += `User: ${msg.content}\n`;
      } else {
        transcript += `Assistant: ${msg.content}\n`;
      }
    }
    transcript += `User: ${newInput}\nAssistant:`;
    return transcript;
  }, [messages]);

  // Build schema context — compact format to avoid hitting token limits
  const buildSchemaContext = useCallback(() => {
    if (canvasItems.length === 0) return "";
    // Use compact format: table(col:type, col:type FK->table)
    const compact = canvasItems.map(t => {
      const cols = t.columns.map(c => {
        let s = `${c.name}:${c.type}`;
        if (c.constraints?.some(x => x.type === "primary")) s += " PK";
        if (c.constraints?.some(x => x.type === "notNull")) s += " NN";
        if (c.constraints?.some(x => x.type === "unique")) s += " UQ";
        if (c.isForeignKey && c.linkedTable) s += ` FK->${c.linkedTable}.${c.linkedColumn || "id"}`;
        return s;
      }).join(", ");
      return `${t.name}(${cols})`;
    }).join("\n");
    return compact;
  }, [canvasItems]);

  // Parse suggestions from AI response
  const parseSuggestions = (raw: any[]): ChatSuggestion[] => {
    return raw.map((s: any) => {
      const payload = s.payload || s;
      const action = s.type || s.payload?.action || payload?.action || "unknown";

      let description = s.description || "";
      if (!description) {
        if (action === "add_table" && (payload.table?.name || payload.targetTable)) {
          description = `Add ${payload.table?.name || payload.targetTable} table`;
        } else if (action === "add_column" && payload.targetTable) {
          description = `Add ${payload.column?.name || "column"} to ${payload.targetTable}`;
        } else if (action === "remove_table" && payload.targetTable) {
          description = `Remove ${payload.targetTable} table`;
        } else if (action === "remove_column" && payload.targetTable) {
          description = `Remove ${payload.column || "column"} from ${payload.targetTable}`;
        } else if (action === "rename_table" && payload.targetTable) {
          description = `Rename ${payload.targetTable} to ${payload.newName}`;
        } else if (action === "rename_column" && payload.targetTable) {
          description = `Rename ${payload.targetColumn} to ${payload.newName} in ${payload.targetTable}`;
        } else if (action === "change_type" && payload.targetTable) {
          description = `Change ${payload.targetColumn} to ${payload.newType} in ${payload.targetTable}`;
        } else if (action === "add_index" && payload.targetTable) {
          description = `Add index on ${payload.targetTable}(${(payload.columns || []).join(", ")})`;
        } else if (action === "add_fk" && payload.targetTable) {
          description = `Add FK ${payload.column} → ${payload.referencesTable}`;
        } else {
          description = s.reason || s.message || "Apply change";
        }
      }

      return { id: uuidv4(), type: action, description, applied: false, payload };
    });
  };

  // Send message
  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);

    try {
      const transcript = buildTranscript(text);
      const schemaContext = buildSchemaContext();
      const result = await callAI("schema-chat", transcript, schemaContext || undefined);

      let parsed: any;
      try {
        parsed = robustJsonParse(result);
      } catch {
        // JSON parse failed — show raw response as plain text message (no suggestions)
        const assistantMsg: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: result || "I couldn't generate a proper response.",
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        return;
      }

      const suggestions = parseSuggestions(parsed.suggestions || []);

      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: parsed.message || "I couldn't generate a proper response.",
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        askToApply: parsed.ask_to_apply === true && suggestions.length === 0,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: e.message?.includes("Rate limit")
          ? "I'm being rate limited. Please wait a moment and try again."
          : `Sorry, I encountered an error: ${e.message}`,
        timestamp: Date.now(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // Apply suggestion (silent=true skips individual toast, used by Apply All)
  const handleApplySuggestion = (suggestion: ChatSuggestion, silent = false) => {
    const p = suggestion.payload;
    try {
      switch (p.action) {
        case "add_table": {
          const newTable: TableNode = {
            id: uuidv4(),
            name: p.table.name,
            x: (-view.x / view.zoom) + 200 + Math.random() * 200,
            y: (-view.y / view.zoom) + 200 + Math.random() * 200,
            columns: (p.table.columns || []).map((c: any) => ({
              id: uuidv4(),
              name: c.name,
              type: c.type || "varchar",
              isForeignKey: c.isForeignKey || false,
              linkedTable: c.linkedTable || "",
              linkedColumn: c.linkedColumn || "",
              fkStatus: "resolved",
              constraints: c.constraints || [],
            })),
          };
          setCanvasItems((prev: TableNode[]) => [...prev, newTable]);
          break;
        }
        case "add_column": {
          const col = p.column;
          setCanvasItems((prev: TableNode[]) => prev.map(t => {
            if (t.name.toLowerCase() !== p.targetTable.toLowerCase()) return t;
            return {
              ...t,
              columns: [...t.columns, {
                id: uuidv4(),
                name: col.name,
                type: col.type || "varchar",
                isForeignKey: col.isForeignKey || false,
                linkedTable: col.linkedTable || "",
                linkedColumn: col.linkedColumn || "",
                fkStatus: "resolved",
                constraints: col.constraints || [],
              }],
            };
          }));
          break;
        }
        case "rename_table": {
          setCanvasItems((prev: TableNode[]) => prev.map(t => ({
            ...t,
            name: t.name.toLowerCase() === p.targetTable.toLowerCase() ? p.newName : t.name,
            columns: t.columns.map(c =>
              c.linkedTable?.toLowerCase() === p.targetTable.toLowerCase()
                ? { ...c, linkedTable: p.newName }
                : c
            ),
          })));
          break;
        }
        case "rename_column": {
          setCanvasItems((prev: TableNode[]) => prev.map(t => {
            if (t.name.toLowerCase() !== p.targetTable.toLowerCase()) return t;
            return {
              ...t,
              columns: t.columns.map(c =>
                c.name.toLowerCase() === p.targetColumn.toLowerCase()
                  ? { ...c, name: p.newName }
                  : c
              ),
            };
          }));
          break;
        }
        case "change_type": {
          setCanvasItems((prev: TableNode[]) => prev.map(t => {
            if (t.name.toLowerCase() !== p.targetTable.toLowerCase()) return t;
            return {
              ...t,
              columns: t.columns.map(c =>
                c.name.toLowerCase() === p.targetColumn.toLowerCase()
                  ? { ...c, type: p.newType }
                  : c
              ),
            };
          }));
          break;
        }
        case "add_fk": {
          setCanvasItems((prev: TableNode[]) => {
            const refTable = prev.find(t => t.name.toLowerCase() === p.referencesTable.toLowerCase());
            return prev.map(t => {
              if (t.name.toLowerCase() !== p.targetTable.toLowerCase()) return t;
              return {
                ...t,
                columns: t.columns.map(c =>
                  c.name.toLowerCase() === p.column.toLowerCase()
                    ? {
                        ...c,
                        isForeignKey: true,
                        linkedTable: p.referencesTable,
                        linkedTableId: refTable?.id,
                        linkedColumn: p.referencesColumn || "id",
                        fkStatus: refTable ? "resolved" : "unresolved",
                      }
                    : c
                ),
              };
            });
          });
          break;
        }
        case "remove_column": {
          setCanvasItems((prev: TableNode[]) => prev.map(t => {
            if (t.name.toLowerCase() !== p.targetTable.toLowerCase()) return t;
            return {
              ...t,
              columns: t.columns.filter(c => c.name.toLowerCase() !== p.column.toLowerCase()),
            };
          }));
          break;
        }
        case "remove_table": {
          setCanvasItems((prev: TableNode[]) => prev.filter(t => t.name.toLowerCase() !== p.targetTable.toLowerCase()));
          break;
        }
        case "add_index": {
          const chatTargetT = canvasItems.find(t => t.name.toLowerCase() === p.targetTable.toLowerCase());
          if (findDuplicateIndex(chatTargetT?.indexes, p.columns)) break;
          setCanvasItems((prev: TableNode[]) => prev.map(t => {
            if (t.name.toLowerCase() !== p.targetTable.toLowerCase()) return t;
            const newIdx = {
              name: p.name || `idx_${t.name}_${p.columns.join("_")}`,
              columns: p.columns,
              type: "btree",
              unique: p.unique || false,
            };
            return { ...t, indexes: [...(t.indexes || []), newIdx] };
          }));
          break;
        }
        case "add_constraint": {
          const chkName = p.name || `chk_${p.targetTable}`;
          const chkExpr = p.expression || "";
          if (!chkExpr) break;
          setCanvasItems((prev: TableNode[]) => prev.map(t => {
            if (t.name.toLowerCase() !== p.targetTable.toLowerCase()) return t;
            return { ...t, checkConstraints: [...(t.checkConstraints || []), { name: chkName, expression: chkExpr }] };
          }));
          break;
        }
        case "add_enum": {
          if (onAddEnum && p.name && p.values?.length) {
            onAddEnum({ name: p.name, values: p.values });
          }
          break;
        }
        case "add_function": {
          if (onAddFunction && p.body) {
            onAddFunction({ name: p.name || "", body: p.body });
          }
          break;
        }
        default:
          if (!silent) addToast(`Unknown action: ${p.action}`, "warning");
          return;
      }

      // Mark as applied
      setMessages(prev =>
        prev.map(msg => ({
          ...msg,
          suggestions: msg.suggestions?.map(s =>
            s.id === suggestion.id ? { ...s, applied: true } : s
          ),
        }))
      );
      if (!silent) addToast(`Applied: ${suggestion.description}`, "success");
    } catch (e: any) {
      if (!silent) addToast(`Failed to apply: ${e.message}`, "error");
    }
  };

  // Apply all unapplied suggestions in a message
  const handleApplyAll = (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.suggestions) return;
    const unapplied = msg.suggestions.filter(s => !s.applied);
    let appliedCount = 0;
    for (const s of unapplied) {
      try {
        handleApplySuggestion(s, true); // silent — no individual toasts
        appliedCount++;
      } catch {
        // continue applying the rest
      }
    }
    addToast(`Applied all ${appliedCount} changes`, "success");
  };

  // Quick reply (from suggestion prompt buttons)
  const handleQuickReply = (text: string) => {
    setInputValue(text);
    // Use a short timeout so the state updates before sending
    setTimeout(() => {
      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMsg]);
      setInputValue("");
      setIsLoading(true);

      const transcript = buildTranscript(text);
      const schemaContext = buildSchemaContext();
      callAI("schema-chat", transcript, schemaContext || undefined)
        .then(result => {
          let parsed: any;
          try {
            parsed = robustJsonParse(result);
          } catch {
            // JSON parse failed — show raw response as plain text
            setMessages(prev => [...prev, {
              id: uuidv4(),
              role: "assistant" as const,
              content: result || "I couldn't generate a proper response.",
              timestamp: Date.now(),
            }]);
            return;
          }
          const suggestions = parseSuggestions(parsed.suggestions || []);
          const assistantMsg: ChatMessage = {
            id: uuidv4(),
            role: "assistant",
            content: parsed.message || "Here are my suggestions.",
            suggestions: suggestions.length > 0 ? suggestions : undefined,
            askToApply: parsed.ask_to_apply === true && suggestions.length === 0,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, assistantMsg]);
        })
        .catch((e: any) => {
          setMessages(prev => [...prev, {
            id: uuidv4(),
            role: "assistant" as const,
            content: `Sorry, I encountered an error: ${e.message}`,
            timestamp: Date.now(),
            isError: true,
          }]);
        })
        .finally(() => setIsLoading(false));
    }, 50);
  };

  // Handle key press (Enter to send, Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Clear chat
  const handleClear = () => {
    setMessages([]);
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
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
                <Sparkles size={14} className="text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-bold">AI Chat</h3>
                <p className="text-[10px] text-muted-foreground">Discuss & improve your schema</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={handleClear}
                  className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary transition"
                >
                  Clear
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-secondary transition"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 mb-3">
                  <MessageCircle size={20} className="text-accent" />
                </div>
                <p className="text-sm font-semibold mb-2">AI Schema Assistant</p>

                {/* Two mode buttons */}
                <div className="flex gap-2 w-full mb-4">
                  <button
                    onClick={() => handleQuickReply("Hey! Tell me about my current schema — what's it designed for and how does it look?")}
                    disabled={isLoading}
                    className="flex-1 flex flex-col items-center gap-1.5 rounded-xl border border-border hover:border-accent/40 hover:bg-secondary/50 p-3 transition group disabled:opacity-40"
                  >
                    <MessageCircle size={16} className="text-muted-foreground group-hover:text-accent transition" />
                    <span className="text-xs font-semibold group-hover:text-foreground transition">Chat</span>
                    <span className="text-[10px] text-muted-foreground">Discuss your schema</span>
                  </button>
                  <button
                    onClick={() => handleQuickReply("Give me your top suggestions to improve my schema. Include actionable changes I can apply.")}
                    disabled={isLoading}
                    className="flex-1 flex flex-col items-center gap-1.5 rounded-xl border border-border hover:border-accent/40 hover:bg-secondary/50 p-3 transition group disabled:opacity-40"
                  >
                    <Sparkles size={16} className="text-muted-foreground group-hover:text-accent transition" />
                    <span className="text-xs font-semibold group-hover:text-foreground transition">Suggest</span>
                    <span className="text-[10px] text-muted-foreground">Get improvements</span>
                  </button>
                </div>

                {/* Quick starters */}
                <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Or ask anything</p>
                <div className="space-y-1.5 w-full">
                  {[
                    "I'm building a SaaS app, what tables do I need?",
                    "How should I handle user roles and permissions?",
                    "Are there any issues with my current schema?",
                  ].map(q => (
                    <button
                      key={q}
                      onClick={() => { setInputValue(q); inputRef.current?.focus(); }}
                      className="w-full text-left text-xs px-3 py-2 rounded-lg border border-border hover:border-accent/40 hover:bg-secondary/50 transition flex items-center gap-2 group"
                    >
                      <ChevronRight size={12} className="text-muted-foreground group-hover:text-accent transition" />
                      <span className="text-muted-foreground group-hover:text-foreground transition">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[90%] ${
                    msg.role === "user"
                      ? "bg-accent text-accent-foreground rounded-2xl rounded-br-md px-3.5 py-2.5"
                      : msg.isError
                        ? "bg-destructive/10 border border-destructive/20 rounded-2xl rounded-bl-md px-3.5 py-2.5"
                        : "bg-secondary/50 rounded-2xl rounded-bl-md px-3.5 py-2.5"
                  }`}
                >
                  {/* Message text */}
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">
                    {msg.isError && <AlertCircle size={12} className="inline mr-1 text-destructive" />}
                    {msg.content}
                  </p>

                  {/* Suggestions */}
                  {/* Suggestion cards */}
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.suggestions.map(s => (
                        <div
                          key={s.id}
                          className={`rounded-xl border p-2.5 transition ${
                            s.applied
                              ? "border-accent/20 bg-accent/5"
                              : "border-border bg-card hover:border-accent/30"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <span className={`text-[10px] font-bold uppercase tracking-wider ${ACTION_COLORS[s.type] || "text-muted-foreground"}`}>
                                {ACTION_LABELS[s.type] || s.type}
                              </span>
                              <p className="text-[11px] text-foreground mt-0.5 leading-relaxed">{s.description}</p>
                            </div>
                            <button
                              onClick={() => !s.applied && handleApplySuggestion(s)}
                              disabled={s.applied}
                              className={`shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold transition ${
                                s.applied
                                  ? "bg-accent/10 text-accent cursor-default"
                                  : "bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95"
                              }`}
                            >
                              {s.applied ? (
                                <>
                                  <CheckCircle2 size={10} />
                                  Applied
                                </>
                              ) : (
                                "Apply"
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                      {/* Apply All button — show when 2+ unapplied suggestions */}
                      {msg.suggestions.filter(s => !s.applied).length >= 2 && (
                        <button
                          onClick={() => handleApplyAll(msg.id)}
                          className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-accent/10 border border-accent/20 text-accent px-3 py-2 text-[11px] font-bold hover:bg-accent/20 active:scale-[0.98] transition"
                        >
                          <Sparkles size={12} />
                          Apply All {msg.suggestions.filter(s => !s.applied).length} Changes
                        </button>
                      )}
                    </div>
                  )}

                  {/* "Want suggestions?" prompt */}
                  {msg.askToApply && !msg.suggestions?.length && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleQuickReply("Yes, suggest the changes!")}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 py-1.5 text-[11px] font-bold hover:bg-accent/90 active:scale-95 transition disabled:opacity-40"
                      >
                        <Sparkles size={11} /> Yes, suggest changes
                      </button>
                      <button
                        onClick={() => handleQuickReply("No thanks, let's keep discussing.")}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 rounded-lg bg-secondary text-secondary-foreground px-3 py-1.5 text-[11px] font-semibold hover:bg-secondary/80 active:scale-95 transition disabled:opacity-40"
                      >
                        Not yet
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-secondary/50 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-accent" />
                    <span className="text-xs text-muted-foreground">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 shrink-0">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your schema..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-xs outline-none focus:border-accent transition max-h-24 custom-scrollbar"
                style={{ minHeight: "38px" }}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground disabled:opacity-40 hover:bg-accent/90 active:scale-95 transition"
              >
                {isLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </button>
            </div>
            <p className="text-[9px] text-muted-foreground mt-1.5 text-center">
              {canvasItems.length > 0
                ? `${canvasItems.length} table${canvasItems.length === 1 ? "" : "s"} in context`
                : "No tables yet — the AI can help you start"}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AIChatPanel;
