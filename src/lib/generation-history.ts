// Feature 4: Enhanced Generation History

import type { TableNode } from "@/lib/types";
import type { GenerationStep } from "@/lib/generation-tracker";

export interface GenerationRecord {
  id: string;
  prompt: string;
  strategy: string;
  steps: GenerationStep[];
  resultTableCount: number;
  resultTableNames: string[];
  startedAt: number;
  completedAt: number;
  durationMs: number;
  success: boolean;
  error?: string;
  continuationCount?: number;
}

const HISTORY_KEY = "vibedb_generation_history";
const MAX_RECORDS = 100;

function readHistory(): GenerationRecord[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function writeHistory(records: GenerationRecord[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
}

export const GenerationHistoryStore = {
  addRecord(record: GenerationRecord): void {
    const records = readHistory();
    records.unshift(record);
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    writeHistory(records);
  },

  getRecords(): GenerationRecord[] {
    return readHistory();
  },

  getRecord(id: string): GenerationRecord | null {
    return readHistory().find(r => r.id === id) || null;
  },

  clearHistory(): void {
    localStorage.removeItem(HISTORY_KEY);
  },
};
