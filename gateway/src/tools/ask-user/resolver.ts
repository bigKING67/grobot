import {
  AskUserEnvelope,
  ResolvedAskUser,
} from "./schema";
import { buildAskUserResolutionPrompt } from "./protocol";

function defaultCleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeFullWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizeOptionAnswer(
  envelope: AskUserEnvelope,
  answer: string,
): string {
  const normalized = normalizeFullWidthDigits(answer);
  if (!normalized) {
    return envelope.defaultOnTimeout;
  }
  if (envelope.options.length > 0) {
    if (/^\d+$/.test(normalized)) {
      const selectedIndex = Number.parseInt(normalized, 10) - 1;
      if (selectedIndex >= 0 && selectedIndex < envelope.options.length) {
        return envelope.options[selectedIndex] as string;
      }
    }
    const lower = normalized.toLowerCase();
    for (const option of envelope.options) {
      if (option.toLowerCase() === lower) {
        return option;
      }
    }
  }
  return normalized;
}

function parseCreatedAtMs(createdAt: string): number | undefined {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

interface PruneExpiredOptions {
  maxAgeMs: number;
  nowMs?: number;
}

export class AskUserSessionStore {
  private readonly pendingBySession = new Map<string, AskUserEnvelope[]>();

  private findDuplicateIndex(queue: AskUserEnvelope[], envelope: AskUserEnvelope): number {
    return queue.findIndex((item) =>
      item.questionId === envelope.questionId
      || item.resumeToken === envelope.resumeToken);
  }

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
    const duplicateIndex = this.findDuplicateIndex(queue, envelope);
    if (duplicateIndex >= 0) {
      queue[duplicateIndex] = envelope;
    } else {
      queue.push(envelope);
    }
    this.pendingBySession.set(sessionKey, queue);
  }

  delete(sessionKey: string): void {
    this.pendingBySession.delete(sessionKey);
  }

  clear(sessionKey: string): number {
    const queue = this.pendingBySession.get(sessionKey);
    if (!queue || queue.length === 0) {
      return 0;
    }
    const removed = queue.length;
    this.pendingBySession.delete(sessionKey);
    return removed;
  }

  pruneExpired(
    sessionKey: string,
    options: PruneExpiredOptions,
  ): AskUserEnvelope[] {
    const queue = this.pendingBySession.get(sessionKey);
    if (!queue || queue.length === 0) {
      return [];
    }
    const maxAgeMs = Number.isFinite(options.maxAgeMs)
      ? Math.max(0, Math.floor(options.maxAgeMs))
      : 0;
    if (maxAgeMs <= 0) {
      return [];
    }
    const nowMs = Number.isFinite(options.nowMs)
      ? Math.floor(options.nowMs as number)
      : Date.now();
    const keep: AskUserEnvelope[] = [];
    const expired: AskUserEnvelope[] = [];
    for (const envelope of queue) {
      const createdAtMs = parseCreatedAtMs(envelope.createdAt);
      if (typeof createdAtMs !== "number") {
        keep.push(envelope);
        continue;
      }
      if (nowMs - createdAtMs > maxAgeMs) {
        expired.push(envelope);
      } else {
        keep.push(envelope);
      }
    }
    if (expired.length <= 0) {
      return [];
    }
    if (keep.length > 0) {
      this.pendingBySession.set(sessionKey, keep);
    } else {
      this.pendingBySession.delete(sessionKey);
    }
    return expired;
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
    const cleanedAnswer = normalizeOptionAnswer(pending, cleanText(answer));
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
