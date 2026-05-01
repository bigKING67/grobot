import {
  type ResolveStartupRewindTargetResult,
  type StartupRewindCheckpointSummary,
} from "./session-rewind-startup";

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
      `[rewind] non-tty startup auto-selected "${targetCheckpointId}" from multiple checkpoint matches.\n\n`,
    );
  }
  return {
    targetCheckpointId,
    messages,
  };
}
