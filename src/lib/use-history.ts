import { useCallback, useState } from "react";

interface HistoryState<T> {
  stack: T[];
  idx: number;
}

// Undo/redo state hook. Stack and cursor live in ONE state object so every
// update is atomic: rapid same-tick setState calls chain through React's
// updater queue instead of racing a separately-tracked index (the old
// idx-closure version could drop updates and corrupt undo history).
export function useHistory<T>(
  initial: T
): [T, (action: T | ((prev: T) => T)) => void, () => void, () => void, boolean, boolean] {
  const [hist, setHist] = useState<HistoryState<T>>({ stack: [initial], idx: 0 });

  const setState = useCallback((action: T | ((prev: T) => T)) => {
    setHist(prev => {
      // Editing after undo discards the redo branch.
      const slice = prev.stack.slice(0, prev.idx + 1);
      const current = slice[slice.length - 1];
      const next = typeof action === "function" ? (action as (prev: T) => T)(current) : action;
      let cloned: T;
      try {
        cloned = JSON.parse(JSON.stringify(next));
      } catch (err) {
        console.error("[useHistory] clone failed:", err);
        cloned = next;
      }
      return { stack: [...slice, cloned], idx: slice.length };
    });
  }, []); // stable forever — safe to capture in long-lived closures

  const undo = useCallback(() => setHist(prev => ({ ...prev, idx: Math.max(0, prev.idx - 1) })), []);
  const redo = useCallback(
    () => setHist(prev => ({ ...prev, idx: Math.min(prev.stack.length - 1, prev.idx + 1) })),
    []
  );

  return [hist.stack[hist.idx], setState, undo, redo, hist.idx > 0, hist.idx < hist.stack.length - 1];
}
