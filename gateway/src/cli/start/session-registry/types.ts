import type { SessionScope } from "../../../models/types";
import type { GaSessionStateSnapshot } from "../../services/ga-mechanism-runtime";
import type { SessionPlanPhase } from "../plan-state";

export const SESSION_REGISTRY_VERSION = 1;
export const SESSION_REGISTRY_MAIN_ID = "main";
export const SESSION_KEY_INSTANCE_SEPARATOR = "__s_";
export const HISTORY_STORE_VERSION = 1;

export type SessionPlanMode = "normal" | "plan_only";

export interface SessionPlanMeta {
  active_plan_id?: string;
  active_plan_status?:
    | "draft"
    | "blocked"
    | "review_failed"
    | "ready"
    | "approved"
    | "applying"
    | "apply_failed"
    | "applied"
    | "discarded";
  active_plan_path?: string;
  active_plan_seq?: number;
  active_plan_title?: string;
  review_status?: "blocked" | "review_failed" | "ready";
  blocked_count?: number;
  review_fail_count?: number;
  approved_hash?: string;
  approval_ticket_id?: string;
  approved_snapshot_path?: string;
  active_plan_phase?: SessionPlanPhase;
  updated_at?: string;
}

export interface SessionProviderRuntimeState {
  provider_name: string;
  consecutive_failures: number;
  circuit_open_until_ms: number;
  last_error_class?: string;
  last_error_message?: string;
  last_failed_at?: string;
  last_succeeded_at?: string;
  ewma_latency_ms?: number;
  ewma_error_rate?: number;
}

export interface SessionRegistryRecord {
  id: string;
  session_key: string;
  created_at: string;
  updated_at: string;
  preview: string;
  sticky_provider?: string;
  provider_runtime_states?: SessionProviderRuntimeState[];
  plan_mode?: SessionPlanMode;
  plan_meta?: SessionPlanMeta;
  ga_state?: GaSessionStateSnapshot;
}

export interface SessionRegistryPayload {
  version: number;
  namespace_key: string;
  active_id: string;
  sessions: SessionRegistryRecord[];
}

export interface LoadedSessionRegistry {
  registry: SessionRegistryPayload;
  warnings: string[];
}

export interface ResolvedSessionStoreReadPath {
  path: string;
  warnings: string[];
}

export type SessionKeyParts = [
  platform: string,
  tenant: string,
  scope: SessionScope,
  subject: string,
];
