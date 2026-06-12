import type { TableNode, SchemaEnum, SchemaFunction, SupabaseBaseline, DDLPatch } from "@/lib/types";

export interface StoredProject {
  id: string;
  name: string;
  definition: TableNode[];
  enums?: SchemaEnum[];
  functions?: SchemaFunction[];
  supabaseBaseline?: SupabaseBaseline;
  ddlPatches?: DDLPatch[];
  updated_at: string;
  created_at: string;
}

// Lightweight metadata stored in localStorage for fast sync listing
export interface ProjectMeta {
  id: string;
  name: string;
  updated_at: string;
  created_at: string;
  tableCount?: number; // shown in the project list without loading IndexedDB
}

const INDEX_KEY = "vibedb_project_index";
const CURRENT_PROJECT_KEY = "vibedb_current_project";
const DB_NAME = "vibedb";
const STORE_NAME = "projects";
const DB_VERSION = 1;
const MAX_PROJECTS = 50;

// ─── IndexedDB helpers (no dependencies) ─────────────────

function dbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(id: string): Promise<StoredProject | undefined> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result as StoredProject | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(project: StoredProject): Promise<void> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(project);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id: string): Promise<void> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── localStorage index helpers ──────────────────────────

function readIndex(): ProjectMeta[] {
  try {
    const stored = localStorage.getItem(INDEX_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function writeIndex(index: ProjectMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

// ─── Migration: move old localStorage projects to IndexedDB ───

let migrationDone = false;

async function migrateFromLocalStorage(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;

  const OLD_KEY = "vibedb_projects";
  const oldData = localStorage.getItem(OLD_KEY);
  if (!oldData) return;

  try {
    const oldProjects: StoredProject[] = JSON.parse(oldData);
    if (!Array.isArray(oldProjects) || oldProjects.length === 0) return;

    // Write each project to IndexedDB
    for (const p of oldProjects) {
      if (p.id && Array.isArray(p.definition)) {
        await dbPut(p);
      }
    }

    // Build index
    const index: ProjectMeta[] = oldProjects
      .filter(p => p.id && Array.isArray(p.definition))
      .map(p => ({ id: p.id, name: p.name, updated_at: p.updated_at, created_at: p.created_at, tableCount: p.definition.length }));
    writeIndex(index);

    // Remove old localStorage data
    localStorage.removeItem(OLD_KEY);
    console.log(`[VibeDB] Migrated ${index.length} projects from localStorage to IndexedDB`);
  } catch (err) {
    console.warn("[VibeDB] Migration from localStorage failed:", err);
  }
}

// ─── Public API ──────────────────────────────────────────

export const ProjectStorage = {
  // SYNC — reads lightweight index from localStorage
  listProjects(): ProjectMeta[] {
    return readIndex().sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  },

  // ASYNC — reads full project from IndexedDB (includes dataRows)
  async getProject(id: string): Promise<StoredProject | null> {
    await migrateFromLocalStorage();
    try {
      const project = await dbGet(id);
      return project || null;
    } catch {
      return null;
    }
  },

  // ASYNC — writes to both localStorage index + IndexedDB
  async saveProject(project: StoredProject): Promise<void> {
    await migrateFromLocalStorage();

    // Write full project (with dataRows) to IndexedDB
    await dbPut({ ...project, updated_at: new Date().toISOString() });

    // Update lightweight index in localStorage
    const index = readIndex();
    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      updated_at: new Date().toISOString(),
      created_at: project.created_at || new Date().toISOString(),
      tableCount: Array.isArray(project.definition) ? project.definition.length : 0,
    };
    const existingIdx = index.findIndex(p => p.id === project.id);
    if (existingIdx >= 0) {
      index[existingIdx] = meta;
    } else {
      if (index.length >= MAX_PROJECTS) {
        index.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        const removed = index.pop();
        if (removed) dbDelete(removed.id).catch(() => {});
      }
      index.push(meta);
    }
    writeIndex(index);
  },

  // ASYNC — deletes from both
  async deleteProject(id: string): Promise<void> {
    await migrateFromLocalStorage();
    const index = readIndex().filter(p => p.id !== id);
    writeIndex(index);
    await dbDelete(id);
    if (localStorage.getItem(CURRENT_PROJECT_KEY) === id) {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  },

  // SYNC — just localStorage
  getCurrentProjectId(): string | null {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  },

  // SYNC — just localStorage
  setCurrentProjectId(id: string | null): void {
    if (id) {
      localStorage.setItem(CURRENT_PROJECT_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
  },

  // ASYNC
  async exportProject(id: string): Promise<string | null> {
    const project = await ProjectStorage.getProject(id);
    if (!project) return null;
    return JSON.stringify(project, null, 2);
  },

  // ASYNC
  async importProject(json: string): Promise<StoredProject> {
    const project = JSON.parse(json) as StoredProject;
    if (!project.id || !project.name || !Array.isArray(project.definition)) {
      throw new Error("Invalid project format");
    }
    project.id = crypto.randomUUID();
    project.created_at = new Date().toISOString();
    project.updated_at = new Date().toISOString();
    await ProjectStorage.saveProject(project);
    return project;
  },

  // ASYNC — one-time backfill: index entries saved before tableCount existed
  // get their count read from IndexedDB and persisted. Returns the updated
  // index (same order as listProjects).
  async backfillTableCounts(): Promise<ProjectMeta[]> {
    await migrateFromLocalStorage();
    const index = readIndex();
    let changed = false;
    for (const meta of index) {
      if (typeof meta.tableCount === "number") continue;
      try {
        const full = await dbGet(meta.id);
        meta.tableCount = Array.isArray(full?.definition) ? full!.definition.length : 0;
        changed = true;
      } catch {
        // unreadable project — leave count undefined
      }
    }
    if (changed) writeIndex(index);
    return index.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  },

  // Ensure migration runs on first access
  async init(): Promise<void> {
    await migrateFromLocalStorage();
  },
};
