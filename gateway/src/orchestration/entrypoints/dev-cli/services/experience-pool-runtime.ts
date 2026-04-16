import { FileBackedExperiencePoolStore } from "../../../../tools/state/experience-pool/store";
import {
  type ExperienceEvidenceRef,
  type ExperienceRecord,
  type ExperienceRecordState,
  type ExperienceSearchMatch,
} from "../../../../tools/state/experience-pool/types";
import { redactSensitiveText } from "./redaction";

export type ExperiencePublishMode = "auto" | "off";

interface CreateExperiencePoolRuntimeInput {
  poolPath: string;
  legacyPoolPath?: string;
  publishMode: ExperiencePublishMode;
  recallLimit: number;
  teamDefault?: string;
}

interface BuildRecallPromptInput {
  sessionKey: string;
  userText: string;
}

interface RegisterTurnSuccessInput {
  sessionKey: string;
  userText: string;
  assistantText: string;
  traceId?: string;
  providerName?: string;
  verificationPass: boolean;
  evidenceRef?: ExperienceEvidenceRef;
}

interface RegisterTurnFailureInput {
  sessionKey: string;
  userText: string;
  providerName?: string;
  errorClass: string;
  errorMessage: string;
}

export interface ExperienceRecallResult {
  prompt: string;
  matched: number;
  candidates: number;
}

export interface ExperiencePublishResult {
  skipped: boolean;
  reason?: string;
  created?: boolean;
  recordId?: string;
  confidence?: number;
  verificationPassed: boolean;
  evidenceRefPassed: boolean;
  redactionPassed: boolean;
}

export interface ExperienceFailureFeedbackResult {
  matched: boolean;
  recordId?: string;
  score?: number;
  confidence?: number;
  quarantined?: boolean;
}

export interface ExperiencePoolRuntime {
  getPath(): string;
  getPublishMode(): ExperiencePublishMode;
  getRecallLimit(): number;
  getTeamDefault(): string;
  getRecordCount(): number;
  getUpdatedAt(): string;
  buildRecallPrompt(input: BuildRecallPromptInput): ExperienceRecallResult;
  registerTurnSuccess(input: RegisterTurnSuccessInput): ExperiencePublishResult;
  registerTurnFailure(input: RegisterTurnFailureInput): ExperienceFailureFeedbackResult;
  searchRecords(input: {
    tenant: string;
    team?: string;
    user?: string;
    query: string;
    limit: number;
    includeStates?: ExperienceRecordState[];
  }): ExperienceSearchMatch[];
  listRecords(tenant?: string, team?: string, user?: string): ExperienceRecord[];
  getRecordById(id: string): ExperienceRecord | undefined;
  setRecordState(id: string, state: ExperienceRecordState, reason?: string): ExperienceRecord | undefined;
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

interface SessionExperienceScope {
  tenant: string;
  team: string;
  user: string;
}

function parseSessionScope(sessionKey: string, teamDefault: string): SessionExperienceScope {
  const parts = sessionKey.split(":");
  const tenant = parts.length >= 2 && parts[1].trim().length > 0 ? parts[1].trim() : "default";
  const user = parts.length >= 4 && parts[3].trim().length > 0 ? parts[3].trim() : "default";
  return {
    tenant,
    team: teamDefault,
    user,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function hasSensitiveLeak(raw: string): boolean {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (
      /^(\s*[A-Za-z0-9_.-]*?(?:api[_-]?key|token|secret|password|authorization|access[_-]?token|refresh[_-]?token)[A-Za-z0-9_.-]*\s*=\s*).+$/i
        .test(line)
    ) {
      return true;
    }
  }
  const patternChecks = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/i,
    /\b(?:sk|gsk|rk|pk)-[A-Za-z0-9]{10,}\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    /\b1[3-9]\d{9}\b/,
    /cookie[:=]\s*[^;,\s]{6,}/i,
    /[?&](?:token|api_key|apikey|access_token|refresh_token|password)=[^&\s]+/i,
  ];
  return patternChecks.some((pattern) => pattern.test(raw));
}

function normalizeEvidenceRef(
  raw: ExperienceEvidenceRef | undefined,
  traceId: string | undefined,
): ExperienceEvidenceRef | undefined {
  const normalizedTraceId = typeof raw?.traceId === "string" && raw.traceId.trim().length > 0
    ? raw.traceId.trim()
    : typeof traceId === "string" && traceId.trim().length > 0
      ? traceId.trim()
      : undefined;
  const runId = typeof raw?.runId === "string" && raw.runId.trim().length > 0 ? raw.runId.trim() : undefined;
  const toolCallId =
    typeof raw?.toolCallId === "string" && raw.toolCallId.trim().length > 0 ? raw.toolCallId.trim() : undefined;
  const url = typeof raw?.url === "string" && raw.url.trim().length > 0 ? raw.url.trim() : undefined;
  const sourceType =
    typeof raw?.sourceType === "string" && raw.sourceType.trim().length > 0 ? raw.sourceType.trim() : "turn_success";
  const capturedAt =
    typeof raw?.capturedAt === "string" && raw.capturedAt.trim().length > 0 ? raw.capturedAt.trim() : nowIso();
  if (!normalizedTraceId && !runId && !toolCallId && !url) {
    return undefined;
  }
  return {
    traceId: normalizedTraceId,
    runId,
    toolCallId,
    url,
    sourceType,
    capturedAt,
  };
}

function isEvidenceRefComplete(raw: ExperienceEvidenceRef | undefined): boolean {
  if (!raw) {
    return false;
  }
  const hasPrimaryId =
    (typeof raw.traceId === "string" && raw.traceId.trim().length > 0)
    || (typeof raw.runId === "string" && raw.runId.trim().length > 0)
    || (typeof raw.toolCallId === "string" && raw.toolCallId.trim().length > 0)
    || (typeof raw.url === "string" && raw.url.trim().length > 0);
  const hasCapturedAt = typeof raw.capturedAt === "string" && raw.capturedAt.trim().length > 0;
  const hasSourceType = typeof raw.sourceType === "string" && raw.sourceType.trim().length > 0;
  return hasPrimaryId && hasCapturedAt && hasSourceType;
}

function buildRecallPromptFromMatches(matches: readonly ExperienceSearchMatch[]): string {
  if (matches.length === 0) {
    return "";
  }
  const lines: string[] = [
    "[GA Experience Pool]",
    "Reuse the following proven SOP only if current intent is truly aligned.",
  ];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const record = match.record;
    lines.push(
      `- exp#${String(index + 1)} id=${record.id} confidence=${record.confidence.toFixed(2)} score=${match.score.toFixed(2)} success=${String(record.successCount)} failure=${String(record.failureCount)}`,
    );
    lines.push(`  summary: ${record.summary}`);
    if (record.sop.length > 0) {
      lines.push(`  sop: ${record.sop.slice(0, 5).join(" -> ")}`);
    }
    if (record.failureSignals.length > 0) {
      lines.push(`  avoid: ${record.failureSignals.slice(0, 3).join(" ; ")}`);
    }
  }
  return lines.join("\n");
}

export function createExperiencePoolRuntime(
  input: CreateExperiencePoolRuntimeInput,
): ExperiencePoolRuntime {
  const store = new FileBackedExperiencePoolStore(input.poolPath, input.legacyPoolPath);
  const recallLimit = clampInt(input.recallLimit, 1, 6);
  const teamDefault = input.teamDefault?.trim() || "default";

  return {
    getPath: () => input.poolPath,
    getPublishMode: () => input.publishMode,
    getRecallLimit: () => recallLimit,
    getTeamDefault: () => teamDefault,
    getRecordCount: () => store.getRecordCount(),
    getUpdatedAt: () => store.getUpdatedAt(),
    buildRecallPrompt: ({ sessionKey, userText }): ExperienceRecallResult => {
      const scope = parseSessionScope(sessionKey, teamDefault);
      const matches = store.search({
        tenant: scope.tenant,
        team: scope.team,
        user: scope.user,
        query: userText,
        limit: recallLimit,
      });
      return {
        prompt: buildRecallPromptFromMatches(matches),
        matched: matches.length,
        candidates: store.listRecords(scope.tenant, scope.team, scope.user).length,
      };
    },
    registerTurnSuccess: ({
      sessionKey,
      userText,
      assistantText,
      traceId,
      providerName,
      verificationPass,
      evidenceRef,
    }): ExperiencePublishResult => {
      if (input.publishMode === "off") {
        return {
          skipped: true,
          reason: "publish_mode_off",
          verificationPassed: verificationPass,
          evidenceRefPassed: false,
          redactionPassed: false,
        };
      }
      if (!verificationPass) {
        return {
          skipped: true,
          reason: "verification_not_passed",
          verificationPassed: false,
          evidenceRefPassed: false,
          redactionPassed: false,
        };
      }
      const scope = parseSessionScope(sessionKey, teamDefault);
      const redactedUserText = redactSensitiveText(userText);
      const redactedAssistantText = redactSensitiveText(assistantText);
      const redactionPassed = !hasSensitiveLeak(redactedUserText) && !hasSensitiveLeak(redactedAssistantText);
      if (!redactionPassed) {
        return {
          skipped: true,
          reason: "redaction_failed",
          verificationPassed: true,
          evidenceRefPassed: false,
          redactionPassed: false,
        };
      }
      const normalizedEvidenceRef = normalizeEvidenceRef(evidenceRef, traceId);
      const evidenceRefPassed = isEvidenceRefComplete(normalizedEvidenceRef);
      if (!evidenceRefPassed) {
        return {
          skipped: true,
          reason: "evidence_ref_incomplete",
          verificationPassed: true,
          evidenceRefPassed: false,
          redactionPassed: true,
        };
      }
      const result = store.upsertSuccess({
        tenant: scope.tenant,
        team: scope.team,
        user: scope.user,
        userText: redactedUserText,
        assistantText: redactedAssistantText,
        traceId,
        providerName,
        verificationPass,
        evidenceRef: normalizedEvidenceRef,
      });
      return {
        skipped: false,
        created: result.created,
        recordId: result.record.id,
        confidence: result.record.confidence,
        verificationPassed: true,
        evidenceRefPassed: true,
        redactionPassed: true,
      };
    },
    registerTurnFailure: ({
      sessionKey,
      userText,
      providerName,
      errorClass,
      errorMessage,
    }): ExperienceFailureFeedbackResult => {
      const scope = parseSessionScope(sessionKey, teamDefault);
      const result = store.registerFailure({
        tenant: scope.tenant,
        team: scope.team,
        user: scope.user,
        userText: redactSensitiveText(userText),
        providerName,
        errorClass,
        errorMessage: redactSensitiveText(errorMessage),
      });
      if (!result.matchedRecord) {
        return {
          matched: false,
        };
      }
      return {
        matched: true,
        recordId: result.matchedRecord.id,
        score: result.score,
        confidence: result.matchedRecord.confidence,
        quarantined: result.quarantined,
      };
    },
    searchRecords: ({ tenant, query, limit, includeStates }): ExperienceSearchMatch[] =>
      store.search({
        tenant,
        query,
        limit,
        includeStates,
      }),
    listRecords: (tenant, team, user) => store.listRecords(tenant, team, user),
    getRecordById: (id) => store.getRecordById(id),
    setRecordState: (id, state, reason) => store.setRecordState(id, state, reason),
  };
}
