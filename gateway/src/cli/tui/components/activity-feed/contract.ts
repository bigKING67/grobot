import type { RuntimeEvent } from "../../../../models/types";

export type RuntimeActivityFeedDetailMode = "none" | "compact" | "full";

export interface RuntimeActivityFeedInput {
  events: readonly RuntimeEvent[];
  terminalColumns?: number;
  maxItems?: number;
  maxDiffLines?: number;
  detailMode?: RuntimeActivityFeedDetailMode;
}

export type ActivityFeedRowKind = "tool" | "tool-group" | "recovery";

export interface ActivityFeedRow {
  title: string;
  detailLines: string[];
  severity: "ok" | "warning" | "error";
  state?: "queued" | "running" | "success" | "warning" | "error";
  kind?: ActivityFeedRowKind;
  toolName?: string;
  toolCallId?: string;
  count?: number;
}

export interface RuntimeActivityFeedViewModel {
  rows: readonly ActivityFeedRow[];
  detailMode: RuntimeActivityFeedDetailMode;
  terminalColumns?: number;
}
