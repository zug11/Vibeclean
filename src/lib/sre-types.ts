export interface ServiceNode {
  id: string;
  name: string;
  type: "api" | "database" | "cache" | "queue" | "storage" | "cdn" | "gateway" | "worker" | "external";
  status: "healthy" | "degraded" | "down" | "unknown";
  url?: string;
  description?: string;
  x: number;
  y: number;
  dependencies: string[]; // IDs of services this depends on
  metrics?: {
    uptime?: number; // percentage
    latency?: number; // ms
    errorRate?: number; // percentage
    requestsPerMin?: number;
  };
}

export interface Incident {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "active" | "investigating" | "resolved";
  affectedServices: string[]; // ServiceNode IDs
  description: string;
  rootCause?: string;
  timeline: { timestamp: number; message: string }[];
  createdAt: number;
  resolvedAt?: number;
}

export interface Runbook {
  id: string;
  title: string;
  serviceId: string;
  steps: { order: number; action: string; command?: string; expected?: string }[];
  createdAt: number;
}
