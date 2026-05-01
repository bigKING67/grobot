import {
  type ResolveStartupRewindTargetResult,
  type StartupRewindCheckpointSummary,
} from "./session-rewind-startup";
import { terminalStyle } from "../ui/theme/terminal-style";

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
      [
        `${terminalStyle.accent("●")} 已自动选择启动检查点`,
        `  ${terminalStyle.muted(`检查点: ${targetCheckpointId}`)}`,
        `  ${terminalStyle.muted("非交互启动无法打开选择器，已使用首个匹配项。")}`,
        "",
      ].join("\n"),
    );
  }
  return {
    targetCheckpointId,
    messages,
  };
}
