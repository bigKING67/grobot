import {
  AskUserSessionStore,
  buildAskUserDisplay,
  formatAskUserResolvedAnswerForPersistence,
  type AskUserEnvelope,
  type AskUserResolveResult,
} from "../../../tools/ask-user";
import { buildAskUserHintPrompt, buildSkillCardBlueprint, providerEvidenceRef } from "./blueprint";
import {
  ASK_USER_HINT_COOLDOWN_MS,
  ASK_USER_HINT_FAILURE_THRESHOLD,
  REFLECTION_COOLDOWN_MS,
  REFLECTION_MIN_FAILURES,
  type GaMechanismRuntime,
  type GaMemoryRecord,
  type GaMemoryWriteRequest,
  type GaMemoryWriteResult,
  type GaSessionStateSnapshot,
  type ReflectionTask,
  type RegisterTurnFailureInput,
  type RegisterTurnSuccessInput,
  type SessionFailureState,
  type SkillCard,
} from "./contract";
import { normalizeGaSessionStateSnapshot } from "./normalize";
import { hasAmbiguousIntentSignal, normalizeTaskSignature } from "./signature";
import {
  cleanText,
  ensureStringArray,
  hasEvidenceRef,
  normalizeConfidence,
  nowIso,
  parseTimestampMs,
  randomId,
  resolveAskUserPendingMaxAgeMs,
} from "./utils";

export function createGaMechanismRuntime(): GaMechanismRuntime {
  const memoryBySession = new Map<string, GaMemoryRecord[]>();
  const skillCardsBySession = new Map<string, SkillCard[]>();
  const reflectionBySession = new Map<string, ReflectionTask[]>();
  const pendingAskBySession = new AskUserSessionStore();
  const failureStateBySession = new Map<string, SessionFailureState>();
  const askUserHintAtBySession = new Map<string, number>();
  const pendingAskMaxAgeMs = resolveAskUserPendingMaxAgeMs();

  const writeMemory = (request: GaMemoryWriteRequest): GaMemoryWriteResult => {
    const text = cleanText(request.text);
    if (!text) {
      return {
        ok: false,
        code: "MEG_INVALID_TEXT",
        message: "text must be non-empty",
      };
    }
    const level = request.memoryLevel;
    if (level !== "L1" && !request.executionVerified) {
      return {
        ok: false,
        code: "MEG_EXECUTION_REQUIRED",
        message: "L2/L3/L4 write requires execution_verified=true",
      };
    }
    if (level !== "L1" && !hasEvidenceRef(request.evidenceRef)) {
      return {
        ok: false,
        code: "MEG_EVIDENCE_REQUIRED",
        message: "L2/L3/L4 write requires non-empty evidence_ref",
      };
    }
    const record: GaMemoryRecord = {
      id: randomId("mem"),
      sessionKey: request.sessionKey,
      memoryLevel: request.memoryLevel,
      text,
      sourceEventType: request.sourceEventType,
      executionVerified: request.executionVerified,
      evidenceRef: request.evidenceRef,
      tags: ensureStringArray(request.tags ?? [], 12),
      confidence: normalizeConfidence(request.confidence),
      createdAt: nowIso(),
    };
    const rows = memoryBySession.get(request.sessionKey) ?? [];
    rows.push(record);
    memoryBySession.set(request.sessionKey, rows);
    return {
      ok: true,
      code: "OK",
      record,
    };
  };

  const registerTurnSuccess = (input: RegisterTurnSuccessInput): void => {
    askUserHintAtBySession.delete(input.sessionKey);
    const failureState = failureStateBySession.get(input.sessionKey);
    if (failureState) {
      failureState.consecutiveFailures = 0;
      failureState.recentErrors = [];
      failureStateBySession.set(input.sessionKey, failureState);
    }
    writeMemory({
      sessionKey: input.sessionKey,
      memoryLevel: "L2",
      text: `turn success provider=${input.providerName} question="${cleanText(input.userText)}"`,
      sourceEventType: "turn_executed",
      executionVerified: true,
      evidenceRef: providerEvidenceRef(input.traceId, input.providerName),
      tags: input.verificationPass ? ["turn", "success", "verified"] : ["turn", "success", "unverified"],
      confidence: input.verificationPass ? 0.9 : 0.6,
    });
    if (!input.verificationPass) {
      pushVerificationFailureReflection(input);
      return;
    }
    registerSkillCardSuccess(input);
  };

  const pushVerificationFailureReflection = (input: RegisterTurnSuccessInput): void => {
    const tasks = reflectionBySession.get(input.sessionKey) ?? [];
    tasks.push({
      id: randomId("refl"),
      sessionKey: input.sessionKey,
      triggerType: "verification_failure",
      failureBundle: [
        `verification failed after successful runtime execution`,
        `provider=${input.providerName}`,
      ],
      insightSchemaVersion: "v1",
      nextActionHint: "re-check assumptions and tighten tool/result validation",
      createdAt: nowIso(),
    });
    reflectionBySession.set(input.sessionKey, tasks);
  };

  const registerSkillCardSuccess = (input: RegisterTurnSuccessInput): void => {
    const signature = normalizeTaskSignature(input.userText);
    if (!signature) {
      return;
    }
    const cards = skillCardsBySession.get(input.sessionKey) ?? [];
    const existing = cards.find((card) => card.taskSignature === signature);
    const evidenceRef = providerEvidenceRef(input.traceId, input.providerName);
    if (existing) {
      existing.updatedAt = nowIso();
      existing.successEvidenceRefs.push(evidenceRef);
      existing.confidence = Math.min(1, Number(((existing.confidence * 0.8) + 0.2).toFixed(4)));
      skillCardsBySession.set(input.sessionKey, cards);
      writeMemory({
        sessionKey: input.sessionKey,
        memoryLevel: "L3",
        text: `skill card reinforced for signature="${signature}"`,
        sourceEventType: "checkpoint_updated",
        executionVerified: true,
        evidenceRef,
        tags: ["skill-card", "reinforced"],
        confidence: existing.confidence,
      });
      return;
    }
    const createdAt = nowIso();
    const blueprint = buildSkillCardBlueprint({
      userText: input.userText,
      assistantText: input.assistantText,
    });
    const nextCard: SkillCard = {
      id: randomId("sc"),
      sessionKey: input.sessionKey,
      taskSignature: signature,
      preconditions: blueprint.preconditions,
      steps: blueprint.steps,
      failureSignals: blueprint.failureSignals,
      rollback: blueprint.rollback,
      successEvidenceRefs: [evidenceRef],
      confidence: 0.75,
      createdAt,
      updatedAt: createdAt,
    };
    cards.push(nextCard);
    skillCardsBySession.set(input.sessionKey, cards);
    writeMemory({
      sessionKey: input.sessionKey,
      memoryLevel: "L3",
      text: `skill card created signature="${signature}"`,
      sourceEventType: "checkpoint_updated",
      executionVerified: true,
      evidenceRef,
      tags: ["skill-card", "created"],
      confidence: nextCard.confidence,
    });
  };

  const registerTurnFailure = (input: RegisterTurnFailureInput): void => {
    const state = failureStateBySession.get(input.sessionKey) ?? {
      consecutiveFailures: 0,
      recentErrors: [],
      lastReflectionAtMs: 0,
    };
    state.consecutiveFailures += 1;
    state.recentErrors = [
      ...state.recentErrors.slice(-3),
      `${input.providerName}:${input.errorClass}:${input.errorMessage}`,
    ];
    failureStateBySession.set(input.sessionKey, state);
    writeMemory({
      sessionKey: input.sessionKey,
      memoryLevel: "L2",
      text: `turn failure provider=${input.providerName} class=${input.errorClass} detail="${cleanText(input.errorMessage)}"`,
      sourceEventType: "turn_executed",
      executionVerified: true,
      evidenceRef: providerEvidenceRef(input.traceId, input.providerName),
      tags: ["turn", "failure", input.errorClass],
      confidence: 0.85,
    });
    const nowMs = Date.now();
    const shouldReflect = state.consecutiveFailures >= REFLECTION_MIN_FAILURES
      && nowMs - state.lastReflectionAtMs >= REFLECTION_COOLDOWN_MS;
    if (!shouldReflect) {
      return;
    }
    state.lastReflectionAtMs = nowMs;
    failureStateBySession.set(input.sessionKey, state);
    const queue = reflectionBySession.get(input.sessionKey) ?? [];
    queue.push({
      id: randomId("refl"),
      sessionKey: input.sessionKey,
      triggerType: "repeated_failure",
      failureBundle: [...state.recentErrors],
      insightSchemaVersion: "v1",
      nextActionHint: "pause and switch strategy before retry",
      createdAt: nowIso(),
    });
    reflectionBySession.set(input.sessionKey, queue);
  };

  const purgeExpiredPendingAsk = (
    sessionKey: string,
    reason: "read" | "write" | "resolve" | "snapshot" = "read",
  ): AskUserEnvelope[] => {
    const expired = pendingAskBySession.pruneExpired(sessionKey, {
      maxAgeMs: pendingAskMaxAgeMs,
    });
    if (expired.length <= 0) {
      return [];
    }
    let oldestAgeSeconds = 0;
    const nowMs = Date.now();
    for (const ask of expired) {
      const createdAtMs = parseTimestampMs(ask.createdAt);
      if (typeof createdAtMs !== "number") {
        continue;
      }
      const ageSeconds = Math.max(0, Math.floor((nowMs - createdAtMs) / 1000));
      if (ageSeconds > oldestAgeSeconds) {
        oldestAgeSeconds = ageSeconds;
      }
    }
    writeMemory({
      sessionKey,
      memoryLevel: "L1",
      text: `ask_user expired removed=${String(expired.length)} reason=${reason} ttl_seconds=${String(
        Math.floor(pendingAskMaxAgeMs / 1000),
      )} oldest_age_seconds=${String(oldestAgeSeconds)}`,
      sourceEventType: "checkpoint_updated",
      executionVerified: false,
      tags: ["ask-user", "expired"],
      confidence: 0.8,
    });
    return expired;
  };

  return {
    buildAskUserDisplay: (envelope): string => buildAskUserDisplay(envelope),
    purgeExpiredPendingAsk: (sessionKey): AskUserEnvelope[] => purgeExpiredPendingAsk(sessionKey, "read"),
    getPendingAsk: (sessionKey): AskUserEnvelope | undefined => {
      purgeExpiredPendingAsk(sessionKey, "read");
      return pendingAskBySession.get(sessionKey);
    },
    listPendingAsk: (sessionKey): AskUserEnvelope[] => {
      purgeExpiredPendingAsk(sessionKey, "read");
      return pendingAskBySession.list(sessionKey);
    },
    getPendingAskQueueSize: (sessionKey): number => {
      purgeExpiredPendingAsk(sessionKey, "read");
      return pendingAskBySession.size(sessionKey);
    },
    registerPendingAsk: (sessionKey, envelope): void => {
      purgeExpiredPendingAsk(sessionKey, "write");
      const queueDepthBefore = pendingAskBySession.size(sessionKey);
      pendingAskBySession.set(sessionKey, envelope);
      const queueDepth = pendingAskBySession.size(sessionKey);
      const queueAction = queueDepth > queueDepthBefore ? "enqueued" : "updated";
      const activeAskId = pendingAskBySession.get(sessionKey)?.askId ?? envelope.askId;
      writeMemory({
        sessionKey,
        memoryLevel: "L1",
        text: `ask_user issued ask_id=${envelope.askId} node=${envelope.blockingNodeId} queue_depth=${String(
          queueDepth,
        )} queue_action=${queueAction} active_ask_id=${activeAskId}`,
        sourceEventType: "checkpoint_updated",
        executionVerified: false,
        tags: ["ask-user", "pending"],
        confidence: 0.8,
      });
    },
    resolvePendingAsk: (sessionKey, answer): AskUserResolveResult | undefined => {
      purgeExpiredPendingAsk(sessionKey, "resolve");
      const resolved = pendingAskBySession.resolve(sessionKey, answer, {
        cleanText,
      });
      if (!resolved) {
        return undefined;
      }
      const resolvedAsk = resolved.resolvedAsk;
      const safeAnswer = formatAskUserResolvedAnswerForPersistence(resolvedAsk);
      writeMemory({
        sessionKey,
        memoryLevel: "L2",
        text: `ask_user resolved ask_id=${resolvedAsk.envelope.askId} answer="${safeAnswer}" remaining=${String(
          resolved.queueSizeAfterResolve,
        )}`,
        sourceEventType: "ask_user_resolved",
        executionVerified: true,
        evidenceRef: {
          source: "ask-user",
        },
        tags: ["ask-user", "resolved"],
        confidence: 0.85,
      });
      return resolved;
    },
    hydrateSession: (sessionKey, state): void => {
      const normalized = normalizeGaSessionStateSnapshot(sessionKey, state);
      if (!normalized) {
        memoryBySession.delete(sessionKey);
        skillCardsBySession.delete(sessionKey);
        reflectionBySession.delete(sessionKey);
        pendingAskBySession.delete(sessionKey);
        failureStateBySession.delete(sessionKey);
        return;
      }
      memoryBySession.set(sessionKey, [...normalized.memory]);
      skillCardsBySession.set(sessionKey, [...normalized.skillCards]);
      reflectionBySession.set(sessionKey, [...normalized.reflectionQueue]);
      pendingAskBySession.delete(sessionKey);
      if (Array.isArray(normalized.pendingAskQueue) && normalized.pendingAskQueue.length > 0) {
        for (const ask of normalized.pendingAskQueue) {
          pendingAskBySession.set(sessionKey, ask);
        }
      }
      if (normalized.failureState) {
        failureStateBySession.set(sessionKey, normalized.failureState);
      } else {
        failureStateBySession.delete(sessionKey);
      }
    },
    snapshotSession: (sessionKey): GaSessionStateSnapshot | undefined => {
      purgeExpiredPendingAsk(sessionKey, "snapshot");
      const memory = [...(memoryBySession.get(sessionKey) ?? [])];
      const skillCards = [...(skillCardsBySession.get(sessionKey) ?? [])];
      const reflectionQueue = [...(reflectionBySession.get(sessionKey) ?? [])];
      const pendingAskQueue = pendingAskBySession.list(sessionKey);
      const failureState = failureStateBySession.get(sessionKey);
      if (
        memory.length === 0
        && skillCards.length === 0
        && reflectionQueue.length === 0
        && pendingAskQueue.length === 0
        && !failureState
      ) {
        return undefined;
      }
      return {
        memory,
        skillCards,
        reflectionQueue,
        pendingAskQueue: pendingAskQueue.length > 0 ? pendingAskQueue : undefined,
        failureState,
      };
    },
    writeMemory,
    listMemory: (sessionKey): GaMemoryRecord[] => [...(memoryBySession.get(sessionKey) ?? [])],
    listSkillCards: (sessionKey): SkillCard[] => [...(skillCardsBySession.get(sessionKey) ?? [])],
    registerTurnSuccess,
    registerTurnFailure,
    buildAskUserClarificationHint: (sessionKey, userText): string => {
      purgeExpiredPendingAsk(sessionKey, "read");
      if (pendingAskBySession.size(sessionKey) > 0) {
        return "";
      }
      const nowMs = Date.now();
      const lastHintAt = askUserHintAtBySession.get(sessionKey) ?? 0;
      if (nowMs - lastHintAt < ASK_USER_HINT_COOLDOWN_MS) {
        return "";
      }
      const failureState = failureStateBySession.get(sessionKey);
      const repeatedFailure = (failureState?.consecutiveFailures ?? 0) >= ASK_USER_HINT_FAILURE_THRESHOLD;
      const ambiguousIntent = hasAmbiguousIntentSignal(userText);
      if (!repeatedFailure && !ambiguousIntent) {
        return "";
      }
      askUserHintAtBySession.set(sessionKey, nowMs);
      const reason = repeatedFailure ? "repeated_failure" : "ambiguous_intent";
      return buildAskUserHintPrompt({
        reason,
        userText,
      });
    },
    pullReflectionTasks: (sessionKey): ReflectionTask[] => {
      const rows = reflectionBySession.get(sessionKey) ?? [];
      reflectionBySession.set(sessionKey, []);
      return [...rows];
    },
  };
}

export function validateGaMechanismRuntimeConfigInputs(): void {
  resolveAskUserPendingMaxAgeMs();
}
