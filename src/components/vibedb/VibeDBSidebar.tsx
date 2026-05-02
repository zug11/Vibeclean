import React, { useState } from "react";
import { Plus, Search, Sparkles, Loader2, Trash2, X, GripVertical, Settings } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { AnimatePresence, motion } from "framer-motion";

import type { Column, TableNode } from "@/lib/types";

const COLUMN_TYPES = ["uuid", "varchar", "int", "timestamp", "boolean", "numeric", "text", "jsonb", "decimal", "float"];

interface VibeDBSidebarProps {
  sidebarItems: Omit<TableNode, "x" | "y">[];
  setSidebarItems: React.Dispatch<React.SetStateAction<Omit<TableNode, "x" | "y">[]>>;
  expertMode: boolean;
  onAddToCanvas: (tableId: string, clientX?: number, clientY?: number) => void;
  onGenerateMore: (prompt: string) => Promise<void>;
  isGeneratingMore: boolean;
}

const VibeDBSidebar: React.FC<VibeDBSidebarProps> = ({
  sidebarItems,
  setSidebarItems,
  expertMode,
  onAddToCanvas,
  onGenerateMore,
  isGeneratingMore,
}) => {
  const [sidebarPrompt, setSidebarPrompt] = useState("");
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editingTableName, setEditingTableName] = useState("");

  const renameSidebarTable = (tableId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setEditingTableId(null);
      return;
    }
    setSidebarItems(prev =>
      prev.map(t => (t.id === tableId ? { ...t, name: trimmed } : t))
    );
    setEditingTableId(null);
  };

  const addSidebarColumn = (tableId: string) => {
    setSidebarItems(prev =>
      prev.map(t =>
        t.id === tableId
          ? { ...t, columns: [...(t.columns || []), { id: uuidv4(), name: "new_col", type: "varchar", fkStatus: "resolved", constraints: [] }] }
          : t
      )
    );
  };

  const updateSidebarColumn = (tableId: string, columnId: string, updates: Partial<Column>) => {
    setSidebarItems(prev =>
      prev.map(t =>
        t.id === tableId
          ? { ...t, columns: t.columns.map(c => (c.id === columnId ? { ...c, ...updates } : c)) }
          : t
      )
    );
  };

  const deleteSidebarColumn = (tableId: string, columnId: string) => {
    setSidebarItems(prev =>
      prev.map(t =>
        t.id === tableId ? { ...t, columns: t.columns.filter(c => c.id !== columnId) } : t
      )
    );
  };

  const deleteSidebarTable = (tableId: string) => {
    setSidebarItems(prev => prev.filter(t => t.id !== tableId));
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, tableId: string) => {
    e.dataTransfer.setData("tableId", tableId);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-72 flex-shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tables</span>
          <button
            onClick={() => {
              const id = uuidv4();
              setSidebarItems(prev => [
                ...prev,
                { id, name: "new_table", columns: [] },
              ]);
              setEditingTableId(id);
              setEditingTableName("new_table");
            }}
            className="p-1 hover:bg-secondary rounded text-accent"
            title="Add table"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex gap-1.5">
          <input
            value={sidebarPrompt}
            onChange={e => setSidebarPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && sidebarPrompt.trim()) {
                onGenerateMore(sidebarPrompt);
                setSidebarPrompt("");
              }
            }}
            placeholder="Generate some tables…"
            className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          />
          <button
            onClick={() => {
              if (sidebarPrompt.trim()) {
                onGenerateMore(sidebarPrompt);
                setSidebarPrompt("");
              }
            }}
            disabled={isGeneratingMore || !sidebarPrompt.trim()}
            className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50"
          >
            {isGeneratingMore ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          </button>
        </div>
      </div>

      {/* Table List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {sidebarItems.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles size={20} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">No tables yet.</p>
            <p className="text-[10px] opacity-70 mt-1">Generate or create one manually.</p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {sidebarItems.map(table => {
            const isEditingThisTable = editingTableId === table.id;
            return (
              <motion.div
                key={table.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                layout
                className="rounded-lg border border-border bg-background p-2 hover:border-accent/50 transition-colors group"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      draggable={!isEditingThisTable}
                      onDragStart={(e) => {
                        if (isEditingThisTable) { e.preventDefault(); return; }
                        e.dataTransfer.setData("tableId", table.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className={`flex-shrink-0 ${isEditingThisTable ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
                      title={isEditingThisTable ? undefined : "Drag to canvas"}
                    >
                      <GripVertical size={12} className="text-muted-foreground" />
                    </span>
                    {isEditingThisTable ? (
                      <input
                        autoFocus
                        value={editingTableName}
                        onChange={e => setEditingTableName(e.target.value)}
                        onBlur={() => renameSidebarTable(table.id, editingTableName)}
                        onKeyDown={e => {
                          if (e.key === "Enter") { renameSidebarTable(table.id, editingTableName); }
                          else if (e.key === "Escape") { setEditingTableId(null); }
                          e.stopPropagation();
                        }}
                        onClick={e => e.stopPropagation()}
                        className="text-xs font-bold bg-transparent border-b border-primary outline-none w-full min-w-0"
                      />
                    ) : (
                      <span
                        className="text-xs font-bold truncate cursor-text hover:text-primary transition-colors"
                        title="Click to rename"
                        onClick={() => { setEditingTableId(table.id); setEditingTableName(table.name); }}
                      >
                        {table.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onAddToCanvas(table.id)}
                      className="p-0.5 text-accent hover:text-accent/80"
                      title="Add to canvas"
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      onClick={() => deleteSidebarTable(table.id)}
                      className="p-0.5 text-destructive hover:text-destructive/80"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {(expertMode ? table.columns : table.columns.slice(0, 3)).map(col => (
                  <div key={col.id} className="flex items-center gap-1 text-[10px] pl-4 py-0.5 group/col">
                    {expertMode ? (
                      <input
                        className="bg-transparent border-none outline-none text-[10px] font-mono w-20 text-foreground"
                        value={col.name}
                        onChange={e => updateSidebarColumn(table.id, col.id, { name: e.target.value })}
                      />
                    ) : (
                      <span className="font-mono text-foreground truncate">{col.name}</span>
                    )}
                    <span className="ml-auto text-muted-foreground text-[9px]">
                      <select
                        value={col.type}
                        onChange={e => updateSidebarColumn(table.id, col.id, { type: e.target.value })}
                        className="bg-transparent border-none outline-none text-[9px] text-right appearance-none cursor-pointer"
                      >
                        {COLUMN_TYPES.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </span>
                    {col.fkStatus && col.fkStatus !== "resolved" && (
                      <span className="text-destructive">⚠</span>
                    )}
                    {expertMode && (
                      <button
                        onClick={() => deleteSidebarColumn(table.id, col.id)}
                        className="ml-0.5 text-destructive opacity-0 group-hover/col:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}

                {!expertMode && table.columns.length > 3 && (
                  <div className="text-[9px] text-muted-foreground pl-4 mt-0.5">
                    + {table.columns.length - 3} more
                  </div>
                )}

                <button
                  onClick={() => addSidebarColumn(table.id)}
                  className="w-full text-[10px] text-center text-accent py-1 hover:bg-secondary/50 rounded flex items-center justify-center gap-1 mt-1"
                >
                  <Plus size={10} /> Add Column
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default VibeDBSidebar;
