// Feature: Network Database Manager Panel
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  X,
  Database,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plug,
  Download,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { TableNode, Column } from "@/lib/types";
import {
  DatabaseConnectionStore,
  testConnection,
  introspectDatabase,
  type DatabaseConnection,
  type IntrospectedSchema,
} from "@/lib/database-connection";

interface DatabaseManagerPanelProps {
  open: boolean;
  onClose: () => void;
  onImportSchema: (tables: TableNode[]) => void;
}

const DEFAULT_PORT = 5432;

function mapIntrospectedType(pgType: string): string {
  const t = pgType.toLowerCase();
  if (t.includes("int")) return "INTEGER";
  if (t.includes("serial")) return "SERIAL";
  if (t.includes("varchar") || t.includes("character varying")) return "VARCHAR(255)";
  if (t === "text") return "TEXT";
  if (t === "boolean" || t === "bool") return "BOOLEAN";
  if (t === "uuid") return "UUID";
  if (t.includes("timestamp")) return "TIMESTAMPTZ";
  if (t === "date") return "DATE";
  if (t === "jsonb") return "JSONB";
  if (t === "json") return "JSON";
  if (t.includes("numeric") || t.includes("decimal")) return "DECIMAL";
  if (t.includes("float") || t.includes("double") || t === "real") return "FLOAT";
  return pgType.toUpperCase();
}

function introspectedToTableNodes(schema: IntrospectedSchema): TableNode[] {
  const GRID_COLS = 3;
  const X_SPACING = 320;
  const Y_SPACING = 300;

  return schema.tables.map((table, i) => {
    const columns: Column[] = table.columns.map((col) => {
      const constraints: { type: string; value?: string }[] = [];
      if (col.isPrimaryKey) constraints.push({ type: "PRIMARY KEY" });
      if (!col.nullable) constraints.push({ type: "NOT NULL" });
      if (col.defaultValue) constraints.push({ type: "DEFAULT", value: col.defaultValue });

      return {
        id: uuidv4(),
        name: col.name,
        type: mapIntrospectedType(col.type),
        constraints,
      };
    });

    return {
      id: uuidv4(),
      name: table.name,
      columns,
      x: 60 + (i % GRID_COLS) * X_SPACING,
      y: 60 + Math.floor(i / GRID_COLS) * Y_SPACING,
    };
  });
}

const DatabaseManagerPanel: React.FC<DatabaseManagerPanelProps> = ({
  open,
  onClose,
  onImportSchema,
}) => {
  // Connection list
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState(DEFAULT_PORT);
  const [formDatabase, setFormDatabase] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formSsl, setFormSsl] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Per-connection password (session only, keyed by id)
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  // Status per connection
  const [testingId, setTestingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  useEffect(() => {
    if (open) {
      setConnections(DatabaseConnectionStore.list());
    }
  }, [open]);

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormPort(DEFAULT_PORT);
    setFormDatabase("");
    setFormUsername("");
    setFormSsl(true);
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = () => {
    if (!formName.trim() || !formHost.trim() || !formDatabase.trim() || !formUsername.trim()) return;

    const conn: DatabaseConnection = {
      id: editingId || uuidv4(),
      name: formName.trim(),
      host: formHost.trim(),
      port: formPort,
      database: formDatabase.trim(),
      username: formUsername.trim(),
      ssl: formSsl,
      createdAt: editingId
        ? DatabaseConnectionStore.get(editingId)?.createdAt || Date.now()
        : Date.now(),
    };

    DatabaseConnectionStore.save(conn);
    setConnections(DatabaseConnectionStore.list());
    resetForm();
  };

  const handleDelete = (id: string) => {
    DatabaseConnectionStore.delete(id);
    setConnections(DatabaseConnectionStore.list());
    setStatusMap((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const handleTest = async (conn: DatabaseConnection) => {
    const pw = passwords[conn.id];
    if (!pw) {
      setStatusMap((prev) => ({
        ...prev,
        [conn.id]: { ok: false, message: "Enter password first" },
      }));
      return;
    }

    setTestingId(conn.id);
    setStatusMap((prev) => ({ ...prev, [conn.id]: { ok: false, message: "Testing..." } }));

    try {
      const result = await testConnection(conn, pw);
      setStatusMap((prev) => ({
        ...prev,
        [conn.id]: {
          ok: result.success,
          message: result.success
            ? `Connected${result.version ? ` (${result.version})` : ""}`
            : result.message,
        },
      }));

      if (result.success) {
        conn.lastConnectedAt = Date.now();
        DatabaseConnectionStore.save(conn);
        setConnections(DatabaseConnectionStore.list());
      }
    } catch (err: any) {
      setStatusMap((prev) => ({
        ...prev,
        [conn.id]: { ok: false, message: err.message || "Connection failed" },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleImport = async (conn: DatabaseConnection) => {
    const pw = passwords[conn.id];
    if (!pw) {
      setStatusMap((prev) => ({
        ...prev,
        [conn.id]: { ok: false, message: "Enter password first" },
      }));
      return;
    }

    setImportingId(conn.id);
    setStatusMap((prev) => ({
      ...prev,
      [conn.id]: { ok: false, message: "Introspecting schema..." },
    }));

    try {
      const schema = await introspectDatabase(conn, pw);
      if (!schema.tables || schema.tables.length === 0) {
        setStatusMap((prev) => ({
          ...prev,
          [conn.id]: { ok: false, message: "No tables found in database" },
        }));
        return;
      }

      const tableNodes = introspectedToTableNodes(schema);
      onImportSchema(tableNodes);

      setStatusMap((prev) => ({
        ...prev,
        [conn.id]: { ok: true, message: `Imported ${tableNodes.length} tables` },
      }));
    } catch (err: any) {
      setStatusMap((prev) => ({
        ...prev,
        [conn.id]: { ok: false, message: err.message || "Introspection failed" },
      }));
    } finally {
      setImportingId(null);
    }
  };

  const handleEdit = (conn: DatabaseConnection) => {
    setEditingId(conn.id);
    setFormName(conn.name);
    setFormHost(conn.host);
    setFormPort(conn.port);
    setFormDatabase(conn.database);
    setFormUsername(conn.username);
    setFormSsl(conn.ssl);
    setShowForm(true);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ x: 400 }}
      animate={{ x: 0 }}
      exit={{ x: 400 }}
      className="fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col border-l border-border bg-card shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Database size={16} className="text-primary" />
          Database Connections
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
            title="Add connection"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Add / Edit Connection Form */}
        {showForm && (
          <div className="rounded-lg border border-border bg-background p-3 space-y-2.5">
            <div className="text-xs font-semibold text-foreground">
              {editingId ? "Edit Connection" : "New Connection"}
            </div>

            <div>
              <label className="block text-[11px] text-muted-foreground mb-0.5">Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My Database"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] text-muted-foreground mb-0.5">Host</label>
                <input
                  type="text"
                  value={formHost}
                  onChange={(e) => setFormHost(e.target.value)}
                  placeholder="db.example.com"
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-0.5">Port</label>
                <input
                  type="number"
                  value={formPort}
                  onChange={(e) => setFormPort(Number(e.target.value) || DEFAULT_PORT)}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-muted-foreground mb-0.5">Database</label>
              <input
                type="text"
                value={formDatabase}
                onChange={(e) => setFormDatabase(e.target.value)}
                placeholder="postgres"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-[11px] text-muted-foreground mb-0.5">Username</label>
              <input
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="postgres"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setFormSsl(!formSsl)}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  formSsl ? "bg-primary" : "bg-secondary"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                    formSsl ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-[11px] text-muted-foreground">SSL</span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={!formName.trim() || !formHost.trim() || !formDatabase.trim() || !formUsername.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {editingId ? "Update" : "Save"}
              </button>
              <button
                onClick={resetForm}
                className="rounded-md bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/80"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Connection List */}
        {connections.length === 0 && !showForm ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
            <Database size={32} className="mb-3 opacity-30" />
            No saved connections.
            <br />
            Add a database connection to get started.
          </div>
        ) : (
          connections.map((conn) => {
            const status = statusMap[conn.id];
            const isTesting = testingId === conn.id;
            const isImporting = importingId === conn.id;
            const isBusy = isTesting || isImporting;

            return (
              <div
                key={conn.id}
                className="rounded-lg border border-border bg-background p-3 space-y-2"
              >
                {/* Connection header */}
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => handleEdit(conn)}
                    title="Click to edit"
                  >
                    <div className="flex items-center gap-1.5">
                      {status?.ok ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
                      )}
                      <span className="text-xs font-medium truncate">{conn.name}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                      {conn.host}:{conn.port} / {conn.database}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(conn.id)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-red-500"
                    title="Delete connection"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Password input */}
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5">
                    Password (session only)
                  </label>
                  <input
                    type="password"
                    value={passwords[conn.id] || ""}
                    onChange={(e) =>
                      setPasswords((prev) => ({ ...prev, [conn.id]: e.target.value }))
                    }
                    placeholder="Enter password..."
                    className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTest(conn)}
                    disabled={isBusy}
                    className="flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1.5 text-[11px] text-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isTesting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Plug size={12} />
                    )}
                    Test
                  </button>
                  <button
                    onClick={() => handleImport(conn)}
                    disabled={isBusy}
                    className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isImporting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    Import Schema
                  </button>
                </div>

                {/* Status message */}
                {status && (
                  <div
                    className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                      status.ok
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {status.ok ? (
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    )}
                    <span className="break-all">{status.message}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
};

export default DatabaseManagerPanel;
