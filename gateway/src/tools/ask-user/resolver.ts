import {
  AskUserEnvelope,
  ResolvedAskUser,
} from "./schema";
import { buildAskUserResolutionPrompt } from "./protocol";

function defaultCleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export class AskUserSessionStore {
  private readonly pendingBySession = new Map<string, AskUserEnvelope>();

  get(sessionKey: string): AskUserEnvelope | undefined {
    return this.pendingBySession.get(sessionKey);
  }

  set(sessionKey: string, envelope: AskUserEnvelope): void {
    this.pendingBySession.set(sessionKey, envelope);
  }

  delete(sessionKey: string): void {
    this.pendingBySession.delete(sessionKey);
  }

  resolve(
    sessionKey: string,
    answer: string,
    options: { cleanText?: (value: string) => string } = {},
  ): ResolvedAskUser | undefined {
    const pending = this.pendingBySession.get(sessionKey);
    if (!pending) {
      return undefined;
    }
    this.pendingBySession.delete(sessionKey);
    const cleanText = options.cleanText ?? defaultCleanText;
    const cleanedAnswer = cleanText(answer);
    return {
      envelope: pending,
      answer: cleanedAnswer,
      resumePrompt: buildAskUserResolutionPrompt({
        envelope: pending,
        answer: cleanedAnswer,
      }),
    };
  }
}
