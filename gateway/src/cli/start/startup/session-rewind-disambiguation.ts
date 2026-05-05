import {
  type ResolveStartupRewindTargetResult,
  type StartupRewindCheckpointSummary,
} from "./session-rewind";
import { renderInfoPanel } from "../../tui/components/info-panel/render";

export type StartupRewindCheckpointSelection =
  | { kind: "cancelled" }
  | { kind: "checkpoint"; checkpointId: string };

export interface ResolveStartupRewindDisambiguationInput {
  rewindTarget: ResolveStartupRewindTargetResult;
  stdinIsTTY: boolean;
  pickCheckpoint?: (
    candidates: ReadonlyArray<StartupRewindCheckpointSummary>,
  ) => Promise<StartupRewindCheckpointSelection>;
}

export interface ResolveStartupRewindDisambiguationResult {
  targetCheckpointId?: string;
  messages: string[];
}

export async function resolveStartupRewindDisambiguation(
  input: ResolveStartupRewindDisambiguationInput,
): Promise<ResolveStartupRewindDisambiguationResult> {
  let targetCheckpointId = input.rewindTarget.targetCheckpointId;
  const messages: string[] = [];
  if (
    input.stdinIsTTY
    && input.rewindTarget.requiresDisambiguation
    && Array.isArray(input.rewindTarget.disambiguationCandidates)
    && input.rewindTarget.disambiguationCandidates.length > 1
  ) {
    const pickCheckpoint = input.pickCheckpoint;
    if (typeof pickCheckpoint === "function") {
      const picked = await pickCheckpoint(input.rewindTarget.disambiguationCandidates);
      if (picked.kind === "checkpoint") {
        targetCheckpointId = picked.checkpointId;
      } else {
        targetCheckpointId = undefined;
      }
    }
    return {
      targetCheckpointId,
      messages,
    };
  }
  if (
    targetCheckpointId
    && input.rewindTarget.requiresDisambiguation
    && !input.stdinIsTTY
  ) {
    messages.push(
      renderInfoPanel({
        title: "Startup checkpoint auto-selected",
        sections: [{
          rows: [{
            title: `checkpoint ${targetCheckpointId}`,
            detailLines: ["Non-interactive startup cannot open a picker; using the first match."],
          }],
        }],
      }),
    );
  }
  return {
    targetCheckpointId,
    messages,
  };
}
