// Feature 3 + 5: Generation Strategies & Sequential AI Pipeline

import type { TableNode } from "@/lib/types";
import type { GenerationProgress } from "@/lib/generation-tracker";
import { createGenerationTracker } from "@/lib/generation-tracker";

export interface GenerationStrategy {
  id: string;
  name: string;
  description: string;
}

export const STRATEGIES: GenerationStrategy[] = [
  {
    id: "v1-direct",
    name: "Direct (Recommended)",
    description: "Single AI call — full schema with indexes and constraints",
  },
  {
    id: "v2-pipeline",
    name: "Pipeline",
    description: "Multi-step: extract entities, then design full schema",
  },
  {
    id: "v3-fast",
    name: "Fast",
    description: "Quick generation with smaller model — lower cost, less detail",
  },
];

export function getDefaultStrategy(): string {
  return localStorage.getItem("vibedb_generation_strategy") || "v1-direct";
}

export function setDefaultStrategy(id: string): void {
  localStorage.setItem("vibedb_generation_strategy", id);
}
