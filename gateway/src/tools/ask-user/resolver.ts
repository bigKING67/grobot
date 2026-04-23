import {
  AskUserResolveResult,
  AskUserEnvelope,
  ResolvedAskUser,
} from "./schema";
import { buildAskUserResolutionPromptBatch } from "./protocol";

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
  if (envelope.optionsDetailed.length > 0) {
    if (/^\d+$/.test(normalized)) {
      const selectedIndex = Number.parseInt(normalized, 10) - 1;
      if (selectedIndex >= 0 && selectedIndex < envelope.optionsDetailed.length) {
        const selected = envelope.optionsDetailed[selectedIndex];
        return selected?.value ?? selected?.label ?? envelope.defaultOnTimeout;
      }
    }
    const lower = normalized.toLowerCase();
    for (const option of envelope.optionsDetailed) {
      const label = option.label.toLowerCase();
      const value = (option.value ?? option.label).toLowerCase();
      if (label === lower || value === lower) {
        return option.value ?? option.label;
      }
    }
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
  private readonly resolvedBySession = new Map<string, ResolvedAskUser[]>();

  private findDuplicateIndex(queue: AskUserEnvelope[], envelope: AskUserEnvelope): number {
    return queue.findIndex((item) => {
      if (item.questionId === envelope.questionId) {
        return true;
      }
      const itemResumeToken = item.resumeToken.trim();
      const envelopeResumeToken = envelope.resumeToken.trim();
      if (!itemResumeToken || !envelopeResumeToken || itemResumeToken !== envelopeResumeToken) {
        return false;
      }
      const itemKey = item.questionKey?.trim() ?? "";
      const envelopeKey = envelope.questionKey?.trim() ?? "";
      if (!itemKey && !envelopeKey) {
        return true;
      }
      return itemKey.length > 0 && envelopeKey.length > 0 && itemKey === envelopeKey;
    });
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

  private appendResolved(sessionKey: string, resolved: ResolvedAskUser): void {
    const rows = this.resolvedBySession.get(sessionKey) ?? [];
    rows.push(resolved);
    this.resolvedBySession.set(sessionKey, rows);
  }

  private takeResolvedBatch(sessionKey: string): ResolvedAskUser[] {
    const rows = this.resolvedBySession.get(sessionKey) ?? [];
    this.resolvedBySession.delete(sessionKey);
    return rows;
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
    this.resolvedBySession.delete(sessionKey);
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
      this.resolvedBySession.delete(sessionKey);
    }
    return expired;
  }

  private dequeueCurrent(sessionKey: string): AskUserEnvelope | undefined {
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
  ): AskUserResolveResult | undefined {
    const pending = this.dequeueCurrent(sessionKey);
    if (!pending) {
      return undefined;
    }
    const cleanText = options.cleanText ?? defaultCleanText;
    const cleanedAnswer = normalizeOptionAnswer(pending, cleanText(answer));
    const resolvedAsk: ResolvedAskUser = {
      envelope: pending,
      answer: cleanedAnswer,
    };
    this.appendResolved(sessionKey, resolvedAsk);
    const queue = this.pendingBySession.get(sessionKey);
    const queueSizeAfterResolve = queue?.length ?? 0;
    const pendingNextAsk = queue && queue.length > 0 ? queue[0] : undefined;
    if (pendingNextAsk) {
      return {
        resolvedAsk,
        pendingNextAsk,
        queueSizeAfterResolve,
      };
    }
    const resolvedBatch = this.takeResolvedBatch(sessionKey);
    const resumePrompt = buildAskUserResolutionPromptBatch({
      resolvedAsks: resolvedBatch,
    });
    return {
      resolvedAsk,
      queueSizeAfterResolve,
      resumePrompt: resumePrompt.trim().length > 0 ? resumePrompt : undefined,
      resolvedBatch,
    };
  }
}
