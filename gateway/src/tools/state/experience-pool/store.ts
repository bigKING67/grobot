import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type ExperienceFeedbackFailureInput,
  type ExperienceEvidence,
  type ExperienceEvidenceRef,
  type ExperiencePoolSnapshot,
  type ExperienceRecord,
  type ExperienceRecordState,
  type ExperienceSearchInput,
  type ExperienceSearchMatch,
  type ExperienceUpsertResult,
  type ExperienceUpsertSuccessInput,
  type ExperienceFailureResult,
} from "./types";

const EXPERIENCE_POOL_VERSION = "v1";

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compactWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const match = normalized.match(/^(.*)[\\/][^\\/]+$/);
  if (match && typeof match[1] === "string" && match[1].length > 0) {
    return match[1];
  }
  return ".";
}

function normalizeTokenSource(raw: string): string {
  return compactWhitespace(raw.toLowerCase());
}

function extractTokens(raw: string): string[] {
  const source = normalizeTokenSource(raw);
  if (!source) {
    return [];
  }
  const unique = new Set<string>();
  for (const token of source.match(/[a-z0-9_]{2,}/g) ?? []) {
    unique.add(token);
  }
  for (const token of source.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    unique.add(token);
  }
  return Array.from(unique).slice(0, 32);
}

function deriveSignature(userText: string): string {
  const tokens = extractTokens(userText).slice(0, 8);
  if (tokens.length > 0) {
    return tokens.join(" ");
  }
  return compactWhitespace(userText).slice(0, 96);
}

function deriveSummary(userText: string): string {
  const summary = compactWhitespace(userText);
  if (!summary) {
    return "unspecified task";
  }
  return summary.length <= 120 ? summary : `${summary.slice(0, 120)}...`;
}

function extractSopSteps(assistantText: string): string[] {
  const rawLines = assistantText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const bulletLines = rawLines
    .filter((line) => /^([-*]\s+|\d+\.\s+)/.test(line))
    .map((line) => line.replace(/^([-*]\s+|\d+\.\s+)/, "").trim())
    .filter((line) => line.length > 0);
  if (bulletLines.length > 0) {
    return Array.from(new Set(bulletLines)).slice(0, 8);
  }
  const sentenceLines = compactWhitespace(assistantText)
    .split(/[。！？.!?]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6);
  return Array.from(new Set(sentenceLines)).slice(0, 6);
}

function extractFailureSignals(assistantText: string): string[] {
  const rawLines = assistantText
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length > 0);
  const candidates = rawLines.filter((line) =>
    /(失败|报错|错误|异常|超时|验证码|登录|forbidden|unauthorized|denied|error|timeout|429|403)/i.test(line),
  );
  if (candidates.length === 0) {
    return [];
  }
  return Array.from(new Set(candidates)).slice(0, 6);
}

function deriveConflictSignal(errorClass: string, errorMessage: string): string | undefined {
  const normalizedClass = compactWhitespace(errorClass).toLowerCase();
  const normalizedMessage = compactWhitespace(errorMessage).toLowerCase();
  const merged = `${normalizedClass} ${normalizedMessage}`.trim();
  if (!merged) {
    return undefined;
  }
  const patterns = [
    /conflict/,
    /contradict/,
    /mismatch/,
    /incompatible/,
    /regression/,
    /冲突/,
    /不一致/,
    /矛盾/,
    /回归/,
  ];
  const matched = patterns.some((pattern) => pattern.test(merged));
  if (!matched) {
    return undefined;
  }
  const raw = compactWhitespace(`${errorClass}: ${errorMessage}`);
  if (!raw) {
    return "conflict_signal";
  }
  return raw.slice(0, 180);
}

function signatureHash(tenant: string, team: string, user: string, signature: string): string {
  return createHash("sha1")
    .update(`${tenant}::${team}::${user}::${signature}`)
    .digest("hex")
    .slice(0, 20);
}

function parseRecordState(raw: unknown): ExperienceRecordState {
  if (raw === "active" || raw === "quarantined" || raw === "disabled") {
    return raw;
  }
  return "active";
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const normalized = compactWhitespace(item);
      if (normalized) {
        rows.push(normalized);
      }
    }
  }
  return rows;
}

function normalizeEvidenceRef(raw: ExperienceEvidenceRef | undefined): ExperienceEvidenceRef | undefined {
  if (!raw) {
    return undefined;
  }
  const traceId = typeof raw.traceId === "string" ? raw.traceId.trim() : "";
  const runId = typeof raw.runId === "string" ? raw.runId.trim() : "";
  const toolCallId = typeof raw.toolCallId === "string" ? raw.toolCallId.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const sourceType = typeof raw.sourceType === "string" ? raw.sourceType.trim() : "";
  const capturedAt = typeof raw.capturedAt === "string" ? raw.capturedAt.trim() : "";
  if (!traceId && !runId && !toolCallId && !url && !sourceType && !capturedAt) {
    return undefined;
  }
  return {
    traceId: traceId || undefined,
    runId: runId || undefined,
    toolCallId: toolCallId || undefined,
    url: url || undefined,
    sourceType: sourceType || undefined,
    capturedAt: capturedAt || undefined,
  };
}

function parseEvidenceRef(raw: unknown): ExperienceEvidenceRef | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  return normalizeEvidenceRef({
    traceId: typeof record.traceId === "string" ? record.traceId : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    toolCallId: typeof record.toolCallId === "string" ? record.toolCallId : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    sourceType: typeof record.sourceType === "string" ? record.sourceType : undefined,
    capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : undefined,
  });
}

function deriveLegacyEvidenceRef(input: {
  traceId?: string;
  sourceType: string;
  capturedAt: string;
}): ExperienceEvidenceRef | undefined {
  const traceId = typeof input.traceId === "string" ? input.traceId.trim() : "";
  if (!traceId) {
    return undefined;
  }
  return {
    traceId,
    sourceType: input.sourceType,
    capturedAt: input.capturedAt,
  };
}

function parseRecord(raw: unknown): ExperienceRecord | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const tenant = typeof record.tenant === "string" ? record.tenant.trim() : "";
  const team = typeof record.team === "string" ? record.team.trim() : "default";
  const user = typeof record.user === "string" ? record.user.trim() : "default";
  const signature = typeof record.signature === "string" ? compactWhitespace(record.signature) : "";
  if (!id || !tenant || !team || !user || !signature) {
    return undefined;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : nowIso();
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  const lastUsedAt = typeof record.lastUsedAt === "string" ? record.lastUsedAt : updatedAt;
  const evidenceRaw = Array.isArray(record.evidence) ? record.evidence : [];
  const evidence: ExperienceEvidence[] = [];
  for (const item of evidenceRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const sourceRaw = row.source;
    const source =
      sourceRaw === "turn_success" || sourceRaw === "turn_failure" || sourceRaw === "manual"
        ? sourceRaw
        : "manual";
    evidence.push({
      source,
      traceId: typeof row.traceId === "string" ? row.traceId : undefined,
      providerName: typeof row.providerName === "string" ? row.providerName : undefined,
      errorClass: typeof row.errorClass === "string" ? row.errorClass : undefined,
      capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : nowIso(),
      evidenceRef:
        parseEvidenceRef(row.evidenceRef) ??
        deriveLegacyEvidenceRef({
          traceId: typeof row.traceId === "string" ? row.traceId : undefined,
          sourceType: source,
          capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : nowIso(),
        }),
    });
  }
  const summaryRaw = typeof record.summary === "string" ? compactWhitespace(record.summary) : "";
  return {
    id,
    tenant,
    team,
    user,
    signature,
    summary: summaryRaw || signature,
    keywords: parseStringArray(record.keywords).slice(0, 32),
    sop: parseStringArray(record.sop).slice(0, 8),
    failureSignals: parseStringArray(record.failureSignals).slice(0, 6),
    confidence:
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? clamp(record.confidence, 0.01, 0.99)
        : 0.55,
    successCount:
      typeof record.successCount === "number" && Number.isFinite(record.successCount)
        ? Math.max(0, Math.floor(record.successCount))
        : 0,
    failureCount:
      typeof record.failureCount === "number" && Number.isFinite(record.failureCount)
        ? Math.max(0, Math.floor(record.failureCount))
        : 0,
    conflictCount:
      typeof record.conflictCount === "number" && Number.isFinite(record.conflictCount)
        ? Math.max(0, Math.floor(record.conflictCount))
        : 0,
    verificationPassCount:
      typeof record.verificationPassCount === "number" && Number.isFinite(record.verificationPassCount)
        ? Math.max(0, Math.floor(record.verificationPassCount))
        : 0,
    lastOutcome: record.lastOutcome === "failure" ? "failure" : "success",
    state: parseRecordState(record.state),
    createdAt,
    updatedAt,
    lastUsedAt,
    lastConflictAt: typeof record.lastConflictAt === "string" ? record.lastConflictAt : undefined,
    conflictSignals: parseStringArray(record.conflictSignals).slice(0, 6),
    evidence: evidence.slice(0, 24),
  };
}

function createEmptySnapshot(): ExperiencePoolSnapshot {
  return {
    version: EXPERIENCE_POOL_VERSION,
    updatedAt: nowIso(),
    records: [],
  };
}

function parseSnapshot(raw: unknown): ExperiencePoolSnapshot {
  if (typeof raw !== "object" || raw === null) {
    return createEmptySnapshot();
  }
  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.records) ? record.records : [];
  const records = rows
    .map((item) => parseRecord(item))
    .filter((item): item is ExperienceRecord => Boolean(item));
  return {
    version: EXPERIENCE_POOL_VERSION,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
    records,
  };
}

function sortRecordsInPlace(records: ExperienceRecord[]): void {
  records.sort((left, right) => {
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function scoreRecordForQuery(record: ExperienceRecord, queryTokens: readonly string[]): ExperienceSearchMatch {
  const signatureText = `${record.signature} ${record.summary}`.toLowerCase();
  const keywordSet = new Set<string>(record.keywords.map((token) => token.toLowerCase()));
  const matchedTokens: string[] = [];
  let overlap = 0;
  for (const token of queryTokens) {
    const normalizedToken = token.toLowerCase();
    if (keywordSet.has(normalizedToken) || signatureText.includes(normalizedToken)) {
      overlap += 1;
      matchedTokens.push(normalizedToken);
    }
  }
  const overlapScore = overlap * 24;
  const confidenceScore = record.confidence * 45;
  const freshnessHours = Math.max(0, (Date.now() - Date.parse(record.updatedAt)) / 3_600_000);
  const freshnessScore = Math.max(0, 36 - Math.min(36, freshnessHours)) * 0.35;
  const failurePenalty = Math.min(24, record.failureCount * 4);
  const statePenalty = record.state === "active" ? 0 : record.state === "quarantined" ? 18 : 80;
  const score = overlapScore + confidenceScore + freshnessScore - failurePenalty - statePenalty;
  return {
    record,
    score: Number(score.toFixed(4)),
    matchedTokens,
  };
}

export class FileBackedExperiencePoolStore {
  private readonly path: string;

  private readonly legacyPath?: string;

  private snapshot: ExperiencePoolSnapshot;

  constructor(path: string, legacyPath?: string) {
    this.path = path;
    this.legacyPath = legacyPath;
    this.snapshot = this.readSnapshot();
  }

  public getPath(): string {
    return this.path;
  }

  public getRecordCount(): number {
    return this.snapshot.records.length;
  }

  public getUpdatedAt(): string {
    return this.snapshot.updatedAt;
  }

  public listRecords(tenant?: string, team?: string, user?: string): ExperienceRecord[] {
    const rows = this.snapshot.records.filter((record) => {
      if (tenant && record.tenant !== tenant) {
        return false;
      }
      if (team && record.team !== team) {
        return false;
      }
      if (user && record.user !== user) {
        return false;
      }
      return true;
    });
    return rows.map((record) => ({ ...record, evidence: [...record.evidence] }));
  }

  public getRecordById(id: string): ExperienceRecord | undefined {
    const found = this.snapshot.records.find((record) => record.id === id);
    if (!found) {
      return undefined;
    }
    return { ...found, evidence: [...found.evidence] };
  }

  public setRecordState(id: string, state: ExperienceRecordState, reason?: string): ExperienceRecord | undefined {
    const found = this.snapshot.records.find((record) => record.id === id);
    if (!found) {
      return undefined;
    }
    found.state = state;
    found.updatedAt = nowIso();
    if (reason && reason.trim().length > 0) {
      found.failureSignals = Array.from(new Set([reason.trim(), ...found.failureSignals])).slice(0, 6);
    }
    this.touchSnapshot();
    this.persist();
    return { ...found, evidence: [...found.evidence] };
  }

  public search(input: ExperienceSearchInput): ExperienceSearchMatch[] {
    const queryTokens = extractTokens(input.query);
    const states = input.includeStates ?? ["active"];
    const includeStates = new Set(states);
    const scored = this.snapshot.records
      .filter((record) => record.tenant === input.tenant)
      .filter((record) => !input.team || record.team === input.team)
      .filter((record) => !input.user || record.user === input.user)
      .filter((record) => includeStates.has(record.state))
      .map((record) => scoreRecordForQuery(record, queryTokens))
      .filter((match) => match.score >= 28)
      .sort((left, right) => right.score - left.score);
    const limit = Math.min(Math.max(input.limit, 1), 20);
    return scored.slice(0, limit).map((match) => ({
      record: { ...match.record, evidence: [...match.record.evidence] },
      score: match.score,
      matchedTokens: [...match.matchedTokens],
    }));
  }

  public upsertSuccess(input: ExperienceUpsertSuccessInput): ExperienceUpsertResult {
    const signature = deriveSignature(input.userText);
    const now = nowIso();
    const recordId = signatureHash(input.tenant, input.team, input.user, signature);
    const found = this.snapshot.records.find((record) => record.id === recordId);
    const sop = extractSopSteps(input.assistantText);
    const keywords = Array.from(new Set(extractTokens(`${input.userText} ${input.assistantText}`))).slice(0, 32);
    const evidence = {
      source: "turn_success" as const,
      traceId: input.traceId,
      providerName: input.providerName,
      capturedAt: now,
      evidenceRef:
        normalizeEvidenceRef(input.evidenceRef) ??
        deriveLegacyEvidenceRef({
          traceId: input.traceId,
          sourceType: "turn_success",
          capturedAt: now,
        }),
    };

    if (found) {
      found.summary = deriveSummary(input.userText);
      found.keywords = Array.from(new Set([...found.keywords, ...keywords])).slice(0, 32);
      if (sop.length > 0) {
        found.sop = Array.from(new Set([...found.sop, ...sop])).slice(0, 8);
      }
      found.successCount += 1;
      if (input.verificationPass) {
        found.verificationPassCount += 1;
      }
      found.lastOutcome = "success";
      found.lastUsedAt = now;
      found.updatedAt = now;
      const passDelta = input.verificationPass ? 0.08 : 0.03;
      const failurePenalty = Math.min(0.35, found.failureCount * 0.05);
      found.confidence = clamp(found.confidence + passDelta - failurePenalty, 0.05, 0.99);
      if (input.verificationPass && found.conflictCount > 0) {
        found.conflictCount = Math.max(0, found.conflictCount - 1);
      }
      if (found.conflictCount === 0 && found.state === "quarantined" && input.verificationPass && found.confidence >= 0.55) {
        found.state = "active";
        found.lastConflictAt = undefined;
      }
      found.evidence = [evidence, ...found.evidence].slice(0, 24);
      this.touchSnapshot();
      sortRecordsInPlace(this.snapshot.records);
      this.persist();
      return {
        record: { ...found, evidence: [...found.evidence] },
        created: false,
      };
    }

    const next: ExperienceRecord = {
      id: recordId,
      tenant: input.tenant,
      team: input.team,
      user: input.user,
      signature,
      summary: deriveSummary(input.userText),
      keywords,
      sop,
      failureSignals: extractFailureSignals(input.assistantText),
      confidence: input.verificationPass ? 0.62 : 0.5,
      successCount: 1,
      failureCount: 0,
      conflictCount: 0,
      verificationPassCount: input.verificationPass ? 1 : 0,
      lastOutcome: "success",
      state: "active",
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      conflictSignals: [],
      evidence: [evidence],
    };
    this.snapshot.records.push(next);
    this.touchSnapshot();
    sortRecordsInPlace(this.snapshot.records);
    this.persist();
    return {
      record: { ...next, evidence: [...next.evidence] },
      created: true,
    };
  }

  public registerFailure(input: ExperienceFeedbackFailureInput): ExperienceFailureResult {
    const matches = this.search({
      tenant: input.tenant,
      team: input.team,
      user: input.user,
      query: input.userText,
      limit: 1,
      includeStates: ["active", "quarantined"],
    });
    const best = matches[0];
    if (!best || best.score < 42) {
      return {
        quarantined: false,
      };
    }
    const found = this.snapshot.records.find((record) => record.id === best.record.id);
    if (!found) {
      return {
        quarantined: false,
      };
    }
    const now = nowIso();
    found.failureCount += 1;
    found.lastOutcome = "failure";
    found.updatedAt = now;
    found.lastUsedAt = now;
    found.confidence = clamp(found.confidence - 0.12, 0.01, 0.99);
    const failureSignal = compactWhitespace(`${input.errorClass}: ${input.errorMessage}`).slice(0, 180);
    if (failureSignal) {
      found.failureSignals = Array.from(new Set([failureSignal, ...found.failureSignals])).slice(0, 6);
    }
    found.evidence = [
      {
        source: "turn_failure" as const,
        providerName: input.providerName,
        errorClass: input.errorClass,
        capturedAt: now,
        evidenceRef: {
          sourceType: "turn_failure",
          capturedAt: now,
        },
      },
      ...found.evidence,
    ].slice(0, 24);
    let conflictIsolated = false;
    const conflictSignal = deriveConflictSignal(input.errorClass, input.errorMessage);
    if (conflictSignal) {
      found.conflictCount += 1;
      found.lastConflictAt = now;
      found.conflictSignals = Array.from(new Set([conflictSignal, ...found.conflictSignals])).slice(0, 6);
      if (found.state === "active") {
        found.state = "quarantined";
        conflictIsolated = true;
      }
    }
    let quarantined = false;
    if (found.failureCount >= 3 && found.confidence <= 0.34 && found.state === "active") {
      found.state = "quarantined";
      quarantined = true;
    }
    if (conflictIsolated) {
      quarantined = true;
    }
    this.touchSnapshot();
    sortRecordsInPlace(this.snapshot.records);
    this.persist();
    return {
      matchedRecord: { ...found, evidence: [...found.evidence] },
      score: best.score,
      quarantined,
      conflictIsolated,
    };
  }

  private touchSnapshot(): void {
    this.snapshot.updatedAt = nowIso();
  }

  private readSnapshotFrom(path: string): ExperiencePoolSnapshot {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return parseSnapshot(parsed);
    } catch {
      return createEmptySnapshot();
    }
  }

  private readSnapshot(): ExperiencePoolSnapshot {
    if (existsSync(this.path)) {
      return this.readSnapshotFrom(this.path);
    }
    if (this.legacyPath && existsSync(this.legacyPath)) {
      const migrated = this.readSnapshotFrom(this.legacyPath);
      if (migrated.records.length > 0) {
        this.snapshot = migrated;
        this.touchSnapshot();
        this.persist();
        return this.snapshot;
      }
    }
    return createEmptySnapshot();
  }

  private persist(): void {
    mkdirSync(parentDirectory(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.snapshot, undefined, 2)}\n`, "utf8");
  }
}
