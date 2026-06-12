// Feature 3 + 5: Generation Strategies & Sequential AI Pipeline

export interface GenerationStrategy {
  id: string;
  name: string;
  description: string;
}

export const STRATEGIES: GenerationStrategy[] = [
  {
    id: "v4-parallel",
    name: "Parallel (Recommended)",
    description: "Blueprint first, then every table generated simultaneously — fastest, no timeout risk",
  },
  {
    id: "v1-direct",
    name: "Sequential",
    description: "Single AI call generates the whole schema at once",
  },
  {
    id: "v4-slow",
    name: "Slow (Thorough)",
    description: "Parallel generation plus a cross-table consistency review at the end",
  },
];

export function getDefaultStrategy(): string {
  const stored = localStorage.getItem("vibedb_generation_strategy");
  // Older builds stored ids (v2-pipeline, v3-fast) that no longer exist —
  // fall back to the parallel default rather than silently misbehaving.
  if (stored && STRATEGIES.some(s => s.id === stored)) return stored;
  return "v4-parallel";
}

export function setDefaultStrategy(id: string): void {
  localStorage.setItem("vibedb_generation_strategy", id);
}
