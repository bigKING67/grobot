import { type SessionProviderRuntimeState } from "../../../start/session-registry";

export type ProviderHealthStatus = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ProviderHealthSnapshotInput {
  sessionKey: string;
  stickyProvider?: string;
  failureThreshold: number;
  cooldownSecs: number;
  nowMs?: number;
  providers: ReadonlyArray<{
    name: string;
    maxInFlight?: number;
    requestsPerMinute?: number;
    burst?: number;
  }>;
  states: readonly SessionProviderRuntimeState[];
}

export interface ProviderHealthRow {
  name: string;
  status: ProviderHealthStatus;
  statusLabel: string;
  severity: "ok" | "warning" | "error";
  detailLines: readonly string[];
}

export interface ProviderHealthViewModel {
  title: string;
  subtitle?: string;
  sessionKey: string;
  stickyProvider: string;
  rows: readonly ProviderHealthRow[];
  emptyMessage?: string;
}
