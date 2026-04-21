import {
  AskUserEnvelope,
  ResolvedAskUser,
} from "./schema";
import { buildAskUserResolutionPrompt } from "./protocol";

function defaultCleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export class AskUserSessionStore {
  private readonly pendingBySession = new Map<string, AskUserEnvelope[]>();

  get(sessionKey: string): AskUserEnvelope | undefined {
    const queue = this.pendingBySession.get(sessionKey);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    return queue[0];
  }

  list(sessionKey: string): AskUserEnvelope[] {
    const queue = this.pendingBySession.get(sessionKey);
    return queue ? [...queue] : [];
  }

  size(sessionKey: string): number {
    return this.pendingBySession.get(sessionKey)?.length ?? 0;
  }

  set(sessionKey: string, envelope: AskUserEnvelope): void {
    const queue = this.pendingBySession.get(sessionKey) ?? [];
    queue.push(envelope);
    this.pendingBySession.set(sessionKey, queue);
  }

  delete(sessionKey: string): void {
    this.pendingBySession.delete(sessionKey);
  }

  dismissCurrent(sessionKey: string): AskUserEnvelope | undefined {
    const queue = this.pendingBySession.get(sessionKey);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const dismissed = queue.shift();
    if (!queue.length) {
      this.pendingBySession.delete(sessionKey);
    } else {
      this.pendingBySession.set(sessionKey, queue);
    }
    return dismissed;
  }

  resolve(
    sessionKey: string,
    answer: string,
    options: { cleanText?: (value: string) => string } = {},
  ): ResolvedAskUser | undefined {
    const pending = this.dismissCurrent(sessionKey);
    if (!pending) {
      return undefined;
    }
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
