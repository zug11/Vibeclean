// ─── Domain Module Registry + Vibe Detector ──────────────
import type { TableNode, DomainModule, DomainDetectionResult, DomainId } from "@/lib/types";
import { quantFinanceModule } from "./quant-finance";
import { peVcModule } from "./pe-vc";
import { healthcareModule } from "./healthcare";

const ALL_MODULES: DomainModule[] = [
  quantFinanceModule,
  peVcModule,
  healthcareModule,
];

const DEFAULT_THRESHOLD = 0.3;

/**
 * Detect which domain modules should activate for the given schema.
 * Returns ALL modules with confidence >= threshold, sorted by confidence desc.
 * A schema CAN match multiple domains (e.g., clinical research + quant).
 * Returns empty array if no domain exceeds threshold (backward-compatible).
 */
export function detectDomains(
  tables: TableNode[],
  threshold: number = DEFAULT_THRESHOLD
): DomainDetectionResult[] {
  return ALL_MODULES
    .map(mod => mod.detect(tables))
    .filter(r => r.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);
}

export function getDomainModule(id: DomainId): DomainModule | undefined {
  return ALL_MODULES.find(m => m.id === id);
}

export { ALL_MODULES };
