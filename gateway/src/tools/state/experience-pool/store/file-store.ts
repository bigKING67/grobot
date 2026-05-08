import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  MAX_CONFLICT_SIGNALS,
  MAX_EVIDENCE,
  MAX_FAILURE_SIGNALS,
  MAX_GUARDRAILS,
  MAX_KEYWORDS,
  MAX_SCENARIO_TAGS,
  MAX_SOP_STEPS,
} from "./constants";
import {
  type ExperienceAttemptRecord,
  type ExperienceFeedbackFailureInput,
  type ExperienceFailureResult,
  type ExperiencePoolSnapshot,
  type ExperienceRecord,
  type ExperienceRecordState,
  type ExperienceSearchInput,
  type ExperienceSearchMatch,
  type ExperienceUpsertResult,
  type ExperienceUpsertSuccessInput,
} from "../types";
import {
  appendAttempt,
  computeConsecutiveFailureCount,
  parseProviderFailureDiagnostics,
} from "./attempts";
import {
  buildFailureSignal,
  deriveConflictSignal,
  deriveFailureStage,
  deriveReuseGuardrails,
  deriveScenarioTags,
  deriveSignature,
  deriveSuccessStrategy,
  deriveSummary,
  deriveTaskSignature,
  deriveTaskType,
  extractFailureSignals,
  extractSopSteps,
  signatureHash,
} from "./derive";
import {
  deriveLegacyEvidenceRef,
  normalizeEvidenceRef,
} from "./evidence";
import {
  buildQueryProfile,
  scoreRecordForQuery,
} from "./search";
import {
  cloneRecord,
  createEmptySnapshot,
  parseSnapshot,
  sortRecordsInPlace,
} from "./snapshot";
import {
  clamp,
  compactWhitespace,
  computeTokenOverlap,
  extractTokens,
  normalizeTaskType,
  nowIso,
  parentDirectory,
  uniqueTrimmed,
} from "./utils";

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
    return rows.map((record) => cloneRecord(record));
  }

  public getRecordById(id: string): ExperienceRecord | undefined {
    const found = this.snapshot.records.find((record) => record.id === id);
    if (!found) {
      return undefined;
    }
    return cloneRecord(found);
  }

  public setRecordState(id: string, state: ExperienceRecordState, reason?: string): ExperienceRecord | undefined {
    const found = this.snapshot.records.find((record) => record.id === id);
    if (!found) {
      return undefined;
    }
    found.state = state;
    found.updatedAt = nowIso();
    if (reason && reason.trim().length > 0) {
      found.failureSignals = uniqueTrimmed([reason.trim(), ...found.failureSignals], MAX_FAILURE_SIGNALS);
      found.reuseGuardrails = uniqueTrimmed(
        [...found.reuseGuardrails, ...deriveReuseGuardrails(found.failureSignals, found.conflictSignals)],
        MAX_GUARDRAILS,
      );
    }
    this.touchSnapshot();
    this.persist();
    return cloneRecord(found);
  }

  public search(input: ExperienceSearchInput): ExperienceSearchMatch[] {
    const profile = buildQueryProfile(input.query);
    if (!profile.rawQuery) {
      return [];
    }
    const states = input.includeStates ?? ["active"];
    const includeStates = new Set(states);
    const scored = this.snapshot.records
      .filter((record) => record.tenant === input.tenant)
      .filter((record) => !input.team || record.team === input.team)
      .filter((record) => !input.user || record.user === input.user)
      .filter((record) => includeStates.has(record.state))
      .map((record) => scoreRecordForQuery(record, profile))
      .filter((match) => match.score >= (profile.tokens.length <= 2 ? 22 : 30))
      .sort((left, right) => right.score - left.score);
    const limit = Math.min(Math.max(input.limit, 1), 20);
    return scored.slice(0, limit).map((match) => ({
      record: cloneRecord(match.record),
      score: match.score,
      matchedTokens: [...match.matchedTokens],
      matchedTaskSignals: match.matchedTaskSignals ? [...match.matchedTaskSignals] : undefined,
      matchedScenarioTags: match.matchedScenarioTags ? [...match.matchedScenarioTags] : undefined,
    }));
  }

  public upsertSuccess(input: ExperienceUpsertSuccessInput): ExperienceUpsertResult {
    const signature = deriveSignature(input.userText);
    const now = nowIso();
    const sop = extractSopSteps(input.assistantText);
    const successStrategy = deriveSuccessStrategy(input.assistantText, sop);
    const keywords = uniqueTrimmed(extractTokens(`${input.userText} ${input.assistantText}`), MAX_KEYWORDS);
    const taskSignature = deriveTaskSignature(input.userText, input.assistantText);
    const taskType = deriveTaskType(`${input.userText} ${input.assistantText}`);
    const normalizedTaskType = normalizeTaskType(taskType);
    const scenarioTags = deriveScenarioTags(`${input.userText} ${input.assistantText}`);
    const taskTokens = extractTokens(taskSignature);
    const fallbackRecordId = signatureHash(input.tenant, input.team, input.user, taskSignature || signature);
    const exactFound = this.snapshot.records.find((record) =>
      record.tenant === input.tenant
      && record.team === input.team
      && record.user === input.user
      && (record.taskSignature === taskSignature || record.signature === signature),
    );
    const found = exactFound
      ?? this.snapshot.records
        .filter((record) =>
          record.tenant === input.tenant
          && record.team === input.team
          && record.user === input.user,
        )
        .map((record) => {
          const taskOverlap = computeTokenOverlap(taskTokens, extractTokens(record.taskSignature));
          const scenarioOverlap = computeTokenOverlap(scenarioTags, record.scenarioTags);
          const taskTypeScore = record.taskType === normalizedTaskType ? 8 : 0;
          const signatureContainment = (
            record.taskSignature.includes(taskSignature)
            || taskSignature.includes(record.taskSignature)
          )
            ? 6
            : 0;
          const score = (taskOverlap * 12) + (scenarioOverlap * 9) + taskTypeScore + signatureContainment;
          return { record, score };
        })
        .filter((item) => item.score >= 30)
        .sort((left, right) => right.score - left.score)[0]?.record;
    const recordId = found?.id ?? fallbackRecordId;
    const evidence = {
      source: "turn_success" as const,
      traceId: input.traceId,
      providerName: input.providerName,
      capturedAt: now,
      evidenceRef:
        normalizeEvidenceRef(input.evidenceRef)
        ?? deriveLegacyEvidenceRef({
          traceId: input.traceId,
          sourceType: "turn_success",
          capturedAt: now,
        }),
    };
    const successAttempt: ExperienceAttemptRecord = {
      capturedAt: now,
      outcome: "success",
      stage: input.verificationPass ? "verification" : "implementation",
      providerName: input.providerName,
      verificationPass: input.verificationPass,
      traceId: input.traceId,
      strategy: successStrategy,
    };

    if (found) {
      const wasFailure = found.lastOutcome === "failure";
      found.signature = signature;
      found.taskSignature = taskSignature;
      found.taskType = normalizedTaskType;
      found.scenarioTags = uniqueTrimmed([...found.scenarioTags, ...scenarioTags], MAX_SCENARIO_TAGS);
      found.summary = deriveSummary(input.userText);
      found.keywords = uniqueTrimmed([...found.keywords, ...keywords], MAX_KEYWORDS);
      if (sop.length > 0) {
        found.sop = uniqueTrimmed([...found.sop, ...sop], MAX_SOP_STEPS);
      }
      found.successCount += 1;
      if (input.verificationPass) {
        found.verificationPassCount += 1;
      }
      if (wasFailure) {
        found.recoverySuccessCount += 1;
      }
      found.consecutiveFailureCount = 0;
      found.lastOutcome = "success";
      found.lastUsedAt = now;
      found.updatedAt = now;
      if (successStrategy) {
        found.lastSuccessStrategy = successStrategy;
      }
      const verificationBoost = input.verificationPass ? 0.08 : 0.03;
      const recoveryBoost = wasFailure ? 0.05 : 0;
      const recoveryRatio = found.recoverySuccessCount / Math.max(1, found.failureCount);
      const recoveryStabilityBoost = Math.min(0.08, recoveryRatio * 0.04);
      const longTailFailureDrag = Math.min(0.22, found.failureCount * 0.025);
      found.confidence = clamp(
        found.confidence + verificationBoost + recoveryBoost + recoveryStabilityBoost - longTailFailureDrag,
        0.05,
        0.99,
      );
      if (input.verificationPass && found.conflictCount > 0) {
        found.conflictCount = Math.max(0, found.conflictCount - 1);
      }
      if (
        found.state === "quarantined"
        && found.conflictCount === 0
        && found.consecutiveFailureCount === 0
        && found.confidence >= 0.56
      ) {
        found.state = "active";
        found.lastConflictAt = undefined;
      }
      found.reuseGuardrails = uniqueTrimmed(
        [...found.reuseGuardrails, ...deriveReuseGuardrails(found.failureSignals, found.conflictSignals)],
        MAX_GUARDRAILS,
      );
      found.attemptHistory = appendAttempt(found.attemptHistory, successAttempt);
      found.evidence = [evidence, ...found.evidence].slice(0, MAX_EVIDENCE);
      this.touchSnapshot();
      sortRecordsInPlace(this.snapshot.records);
      this.persist();
      return {
        record: cloneRecord(found),
        created: false,
      };
    }

    const initialFailureSignals = extractFailureSignals(input.assistantText);
    const initialGuardrails = deriveReuseGuardrails(initialFailureSignals, []);
    const next: ExperienceRecord = {
      id: recordId,
      tenant: input.tenant,
      team: input.team,
      user: input.user,
      signature,
      taskSignature,
      taskType: normalizeTaskType(taskType),
      scenarioTags,
      summary: deriveSummary(input.userText),
      keywords,
      sop,
      failureSignals: initialFailureSignals,
      reuseGuardrails: initialGuardrails,
      attemptHistory: [successAttempt],
      confidence: input.verificationPass ? 0.64 : 0.52,
      successCount: 1,
      failureCount: 0,
      recoverySuccessCount: 0,
      consecutiveFailureCount: 0,
      conflictCount: 0,
      verificationPassCount: input.verificationPass ? 1 : 0,
      lastOutcome: "success",
      lastFailureClass: undefined,
      lastFailureStage: undefined,
      lastProviderFailureDiagnostics: undefined,
      lastSuccessStrategy: successStrategy,
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
      record: cloneRecord(next),
      created: true,
    };
  }

  public registerFailure(input: ExperienceFeedbackFailureInput): ExperienceFailureResult {
    const profile = buildQueryProfile(input.userText);
    const candidates = this.snapshot.records
      .filter((record) => record.tenant === input.tenant)
      .filter((record) => record.team === input.team)
      .filter((record) => record.user === input.user)
      .filter((record) => record.state === "active" || record.state === "quarantined")
      .map((record) => {
        const scored = scoreRecordForQuery(record, profile);
        const taskOverlap = computeTokenOverlap(profile.taskTokens, extractTokens(record.taskSignature));
        const scenarioOverlap = computeTokenOverlap(profile.scenarioTags, record.scenarioTags);
        const adjustedScore = scored.score + (taskOverlap * 8) + (scenarioOverlap * 6);
        return {
          ...scored,
          adjustedScore: Number(adjustedScore.toFixed(4)),
        };
      })
      .sort((left, right) => right.adjustedScore - left.adjustedScore);

    const best = candidates[0];
    if (!best || best.adjustedScore < 38) {
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
    const failureStage = deriveFailureStage(input.errorClass, input.errorMessage, input.failureStage);
    const providerFailureDiagnostics = parseProviderFailureDiagnostics(input.providerFailureDiagnostics);
    const failureSignal = buildFailureSignal({
      stage: failureStage,
      errorClass: input.errorClass,
      errorMessage: input.errorMessage,
    });
    const conflictSignal = deriveConflictSignal(input.errorClass, input.errorMessage);
    const failureAttempt: ExperienceAttemptRecord = {
      capturedAt: now,
      outcome: "failure",
      stage: failureStage,
      providerName: input.providerName,
      errorClass: compactWhitespace(input.errorClass).slice(0, 120) || "unknown_error",
      errorMessage: compactWhitespace(input.errorMessage).slice(0, 220),
      toolContext: input.toolContext ? compactWhitespace(input.toolContext).slice(0, 160) : undefined,
      providerFailureDiagnostics,
    };
    found.failureCount += 1;
    found.lastOutcome = "failure";
    found.lastUsedAt = now;
    found.updatedAt = now;
    found.lastFailureClass = failureAttempt.errorClass;
    found.lastFailureStage = failureStage;
    found.lastProviderFailureDiagnostics = providerFailureDiagnostics;
    found.scenarioTags = uniqueTrimmed(
      [...found.scenarioTags, ...deriveScenarioTags(`${input.userText} ${input.errorClass} ${input.errorMessage}`)],
      MAX_SCENARIO_TAGS,
    );
    if (found.taskType === "general_task" && profile.taskType !== "general_task") {
      found.taskType = profile.taskType;
    }
    if (!found.taskSignature || found.taskSignature === "general_task") {
      found.taskSignature = profile.taskSignature;
    }
    if (failureSignal) {
      found.failureSignals = uniqueTrimmed([failureSignal, ...found.failureSignals], MAX_FAILURE_SIGNALS);
    }
    found.attemptHistory = appendAttempt(found.attemptHistory, failureAttempt);
    found.consecutiveFailureCount = computeConsecutiveFailureCount(found.attemptHistory);
    found.confidence = clamp(
      found.confidence - (0.09 + Math.min(0.2, found.consecutiveFailureCount * 0.03)),
      0.01,
      0.99,
    );
    found.evidence = [
      {
        source: "turn_failure" as const,
        providerName: input.providerName,
        errorClass: failureAttempt.errorClass,
        capturedAt: now,
        evidenceRef: {
          sourceType: "turn_failure",
          capturedAt: now,
        },
        providerFailureDiagnostics,
      },
      ...found.evidence,
    ].slice(0, MAX_EVIDENCE);

    let conflictIsolated = false;
    if (conflictSignal) {
      found.conflictCount += 1;
      found.lastConflictAt = now;
      found.conflictSignals = uniqueTrimmed([conflictSignal, ...found.conflictSignals], MAX_CONFLICT_SIGNALS);
      if (found.state === "active") {
        found.state = "quarantined";
        conflictIsolated = true;
      }
    }

    found.reuseGuardrails = uniqueTrimmed(
      [...found.reuseGuardrails, ...deriveReuseGuardrails(found.failureSignals, found.conflictSignals)],
      MAX_GUARDRAILS,
    );

    let quarantined = false;
    if (
      found.state === "active"
      && (
        (found.consecutiveFailureCount >= 2 && found.confidence <= 0.45)
        || (found.failureCount >= 4 && found.confidence <= 0.34)
      )
    ) {
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
      matchedRecord: cloneRecord(found),
      score: best.adjustedScore,
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
