import { type SessionMenuSelection } from "../session/menu";
import {
  type ResolveStartupResumeTargetResult,
  type StartupResumeSessionSummary,
} from "./session-resume";
import { renderInfoPanel } from "../../tui/components/info-panel/render";

export interface ResolveStartupResumeDisambiguationInput {
  resumeTarget: ResolveStartupResumeTargetResult;
  stdinIsTTY: boolean;
  pickSession?: (
    candidates: ReadonlyArray<StartupResumeSessionSummary>,
  ) => Promise<SessionMenuSelection>;
}

export interface ResolveStartupResumeDisambiguationResult {
  targetSessionId?: string;
  messages: string[];
}

export async function resolveStartupResumeDisambiguation(
  input: ResolveStartupResumeDisambiguationInput,
): Promise<ResolveStartupResumeDisambiguationResult> {
  let targetSessionId = input.resumeTarget.targetSessionId;
  const messages: string[] = [];
  if (
    input.stdinIsTTY
    && input.resumeTarget.requiresDisambiguation
    && Array.isArray(input.resumeTarget.disambiguationCandidates)
    && input.resumeTarget.disambiguationCandidates.length > 1
  ) {
    const pickSession = input.pickSession;
    if (typeof pickSession === "function") {
      const picked = await pickSession(input.resumeTarget.disambiguationCandidates);
      if (picked.kind === "session") {
        targetSessionId = picked.sessionId;
      } else {
        targetSessionId = undefined;
      }
    }
    return {
      targetSessionId,
      messages,
    };
  }
  if (
    targetSessionId
    && input.resumeTarget.requiresDisambiguation
    && !input.stdinIsTTY
  ) {
    messages.push(
      renderInfoPanel({
        title: "Startup session auto-selected",
        sections: [{
          rows: [{
            title: `session ${targetSessionId}`,
            detailLines: ["Non-interactive startup cannot open a picker; using the first match."],
          }],
        }],
      }),
    );
  }
  return {
    targetSessionId,
    messages,
  };
}
