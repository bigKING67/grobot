import {
  AskUserSessionStore,
  AskUserEnvelope,
  AskUserResolveResult,
  buildAskUserDisplay,
  normalizeAskUserEnvelope,
} from "../../../../tools/ask-user";

const REFLECTION_COOLDOWN_MS = 5 * 60 * 1000;
const REFLECTION_MIN_FAILURES = 2;
const ASK_USER_HINT_COOLDOWN_MS = 2 * 60 * 1000;
const ASK_USER_HINT_FAILURE_THRESHOLD = 2;
const ASK_USER_PENDING_MAX_AGE_MS_DEFAULT = 6 * 60 * 60 * 1000;
const SIGNATURE_STOPWORDS = new Set([
  "please",
  "using",
  "with",
  "from",
  "this",
  "that",
  "would",
  "should",
  "could",
  "into",
  "about",
  "agent",
  "grobot",
  "browser",
  "tool",
  "tools",
  "mcp",
  "继续",
  "一下",
  "这个",
  "那个",
  "然后",
  "需要",
  "帮我",
]);

export type GaMemoryLevel = "L1" | "L2" | "L3" | "L4";
export type GaSourceEventType =
  | "turn_executed"
  | "tool_executed"
  | "checkpoint_updated"
  | "reflection_generated"
  | "ask_user_resolved";

export interface GaEvidenceRef {
  traceId?: string;
  turnId?: string;
  toolCallId?: string;
  source?: string;
}

export interface GaMemoryWriteRequest {
  sessionKey: string;
  memoryLevel: GaMemoryLevel;
  text: string;
  sourceEventType: GaSourceEventType;
  executionVerified: boolean;
  evidenceRef?: GaEvidenceRef;
  tags?: string[];
  confidence?: number;
}

export interface GaMemoryRecord {
  id: string;
  sessionKey: string;
  memoryLevel: GaMemoryLevel;
  text: string;
  sourceEventType: GaSourceEventType;
  executionVerified: boolean;
  evidenceRef?: GaEvidenceRef;
  tags: string[];
  confidence: number;
  createdAt: string;
}

export interface GaMemoryWriteResult {
  ok: boolean;
  code: "OK" | "MEG_INVALID_TEXT" | "MEG_EXECUTION_REQUIRED" | "MEG_EVIDENCE_REQUIRED";
  message?: string;
  record?: GaMemoryRecord;
}

export interface SkillCard {
  id: string;
  sessionKey: string;
  taskSignature: string;
  preconditions: string[];
  steps: string[];
  failureSignals: string[];
  rollback: string[];
  successEvidenceRefs: GaEvidenceRef[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReflectionTask {
  id: string;
  sessionKey: string;
  triggerType: "repeated_failure" | "verification_failure";
  failureBundle: string[];
  insightSchemaVersion: "v1";
  nextActionHint: string;
  createdAt: string;
}

export interface RegisterTurnSuccessInput {
  sessionKey: string;
  userText: string;
  assistantText: string;
  traceId: string;
  providerName: string;
  verificationPass: boolean;
}

export interface RegisterTurnFailureInput {
  sessionKey: string;
  providerName: string;
  errorClass: string;
  errorMessage: string;
  traceId?: string;
}

interface SessionFailureState {
  consecutiveFailures: number;
  recentErrors: string[];
  lastReflectionAtMs: number;
}

export interface GaSessionStateSnapshot {
  memory: GaMemoryRecord[];
  skillCards: SkillCard[];
  reflectionQueue: ReflectionTask[];
  pendingAskQueue?: AskUserEnvelope[];
  failureState?: SessionFailureState;
}

export interface GaMechanismRuntime {
  buildAskUserDisplay(envelope: AskUserEnvelope): string;
  purgeExpiredPendingAsk(sessionKey: string): AskUserEnvelope[];
  getPendingAsk(sessionKey: string): AskUserEnvelope | undefined;
  listPendingAsk(sessionKey: string): AskUserEnvelope[];
  getPendingAskQueueSize(sessionKey: string): number;
  registerPendingAsk(sessionKey: string, envelope: AskUserEnvelope): void;
  resolvePendingAsk(sessionKey: string, answer: string): AskUserResolveResult | undefined;
  hydrateSession(sessionKey: string, state: GaSessionStateSnapshot | undefined): void;
  snapshotSession(sessionKey: string): GaSessionStateSnapshot | undefined;
  writeMemory(request: GaMemoryWriteRequest): GaMemoryWriteResult;
  listMemory(sessionKey: string): GaMemoryRecord[];
  listSkillCards(sessionKey: string): SkillCard[];
  registerTurnSuccess(input: RegisterTurnSuccessInput): void;
  registerTurnFailure(input: RegisterTurnFailureInput): void;
  buildAskUserClarificationHint(sessionKey: string, userText: string): string;
  pullReflectionTasks(sessionKey: string): ReflectionTask[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeConfidence(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 0.7;
  }
  if (raw <= 0) {
    return 0;
  }
  if (raw >= 1) {
    return 1;
  }
  return raw;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function parseOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function parseTimestampMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function resolveAskUserPendingMaxAgeMs(): number {
  const rawMinutes = process.env.GROBOT_ASK_USER_PENDING_TTL_MINUTES;
  if (typeof rawMinutes !== "string") {
    return ASK_USER_PENDING_MAX_AGE_MS_DEFAULT;
  }
  const parsedMinutes = Number.parseInt(rawMinutes, 10);
  if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
    return ASK_USER_PENDING_MAX_AGE_MS_DEFAULT;
  }
  return parsedMinutes * 60 * 1000;
}

function parseMemoryLevel(value: unknown): GaMemoryLevel | undefined {
  if (value === "L1" || value === "L2" || value === "L3" || value === "L4") {
    return value;
  }
  return undefined;
}

function parseSourceEventType(value: unknown): GaSourceEventType | undefined {
  if (
    value === "turn_executed"
    || value === "tool_executed"
    || value === "checkpoint_updated"
    || value === "reflection_generated"
    || value === "ask_user_resolved"
  ) {
    return value;
  }
  return undefined;
}

function hasEvidenceRef(value: GaEvidenceRef | undefined): boolean {
  if (!value) {
    return false;
  }
  return [value.traceId, value.turnId, value.toolCallId, value.source].some((item) => typeof item === "string" && item.trim().length > 0);
}

function normalizeEvidenceRef(raw: unknown): GaEvidenceRef | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const normalized: GaEvidenceRef = {
    traceId: parseOptionalString(record.traceId),
    turnId: parseOptionalString(record.turnId),
    toolCallId: parseOptionalString(record.toolCallId),
    source: parseOptionalString(record.source),
  };
  return hasEvidenceRef(normalized) ? normalized : undefined;
}

function ensureStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const cleaned = cleanText(item);
    if (!cleaned) {
      continue;
    }
    rows.push(cleaned);
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

function normalizeMemoryRecord(raw: unknown, fallbackSessionKey: string): GaMemoryRecord | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const memoryLevel = parseMemoryLevel(record.memoryLevel);
  const sourceEventType = parseSourceEventType(record.sourceEventType);
  const text = parseOptionalString(record.text);
  if (!memoryLevel || !sourceEventType || !text) {
    return undefined;
  }
  return {
    id: parseOptionalString(record.id) ?? randomId("mem"),
    sessionKey: parseOptionalString(record.sessionKey) ?? fallbackSessionKey,
    memoryLevel,
    text,
    sourceEventType,
    executionVerified: Boolean(record.executionVerified),
    evidenceRef: normalizeEvidenceRef(record.evidenceRef),
    tags: ensureStringArray(record.tags, 12),
    confidence: normalizeConfidence(parseOptionalFiniteNumber(record.confidence)),
    createdAt: parseOptionalString(record.createdAt) ?? nowIso(),
  };
}

function normalizeSkillCard(raw: unknown, fallbackSessionKey: string): SkillCard | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const taskSignature = parseOptionalString(record.taskSignature);
  if (!taskSignature) {
    return undefined;
  }
  const evidenceRefs: GaEvidenceRef[] = [];
  if (Array.isArray(record.successEvidenceRefs)) {
    for (const item of record.successEvidenceRefs) {
      const normalized = normalizeEvidenceRef(item);
      if (normalized) {
        evidenceRefs.push(normalized);
      }
    }
  }
  return {
    id: parseOptionalString(record.id) ?? randomId("sc"),
    sessionKey: parseOptionalString(record.sessionKey) ?? fallbackSessionKey,
    taskSignature,
    preconditions: ensureStringArray(record.preconditions, 24),
    steps: ensureStringArray(record.steps, 32),
    failureSignals: ensureStringArray(record.failureSignals, 24),
    rollback: ensureStringArray(record.rollback, 24),
    successEvidenceRefs: evidenceRefs,
    confidence: normalizeConfidence(parseOptionalFiniteNumber(record.confidence)),
    createdAt: parseOptionalString(record.createdAt) ?? nowIso(),
    updatedAt: parseOptionalString(record.updatedAt) ?? nowIso(),
  };
}

function normalizeReflectionTask(raw: unknown, fallbackSessionKey: string): ReflectionTask | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const triggerType = record.triggerType === "verification_failure" ? "verification_failure" : record.triggerType === "repeated_failure" ? "repeated_failure" : undefined;
  const nextActionHint = parseOptionalString(record.nextActionHint);
  if (!triggerType || !nextActionHint) {
    return undefined;
  }
  return {
    id: parseOptionalString(record.id) ?? randomId("refl"),
    sessionKey: parseOptionalString(record.sessionKey) ?? fallbackSessionKey,
    triggerType,
    failureBundle: ensureStringArray(record.failureBundle, 24),
    insightSchemaVersion: "v1",
    nextActionHint,
    createdAt: parseOptionalString(record.createdAt) ?? nowIso(),
  };
}

function normalizeFailureState(raw: unknown): SessionFailureState | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const recentErrors = ensureStringArray(record.recentErrors, 8);
  const consecutiveFailures = parseOptionalFiniteNumber(record.consecutiveFailures);
  const lastReflectionAtMs = parseOptionalFiniteNumber(record.lastReflectionAtMs);
  if (typeof consecutiveFailures !== "number" && recentErrors.length === 0 && typeof lastReflectionAtMs !== "number") {
    return undefined;
  }
  return {
    consecutiveFailures: typeof consecutiveFailures === "number" && consecutiveFailures > 0
      ? Math.floor(consecutiveFailures)
      : 0,
    recentErrors,
    lastReflectionAtMs: typeof lastReflectionAtMs === "number" && lastReflectionAtMs > 0
      ? Math.floor(lastReflectionAtMs)
      : 0,
  };
}

export function normalizeGaSessionStateSnapshot(
  sessionKey: string,
  raw: unknown,
): GaSessionStateSnapshot | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const memory: GaMemoryRecord[] = [];
  if (Array.isArray(record.memory)) {
    for (const item of record.memory) {
      const normalized = normalizeMemoryRecord(item, sessionKey);
      if (normalized) {
        memory.push(normalized);
      }
    }
  }
  const skillCards: SkillCard[] = [];
  if (Array.isArray(record.skillCards)) {
    for (const item of record.skillCards) {
      const normalized = normalizeSkillCard(item, sessionKey);
      if (normalized) {
        skillCards.push(normalized);
      }
    }
  }
  const reflectionQueue: ReflectionTask[] = [];
  if (Array.isArray(record.reflectionQueue)) {
    for (const item of record.reflectionQueue) {
      const normalized = normalizeReflectionTask(item, sessionKey);
      if (normalized) {
        reflectionQueue.push(normalized);
      }
    }
  }
  const pendingAskQueue: AskUserEnvelope[] = [];
  if (Array.isArray(record.pendingAskQueue)) {
    for (const item of record.pendingAskQueue) {
      const normalized = normalizeAskUserEnvelope(item);
      if (normalized) {
        pendingAskQueue.push(normalized);
      }
    }
  }
  const failureState = normalizeFailureState(record.failureState);
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
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function collectDomainHints(raw: string): string[] {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return [];
  }
  const result: string[] = [];
  const pushUnique = (candidate: string): void => {
    const normalized = candidate.replace(/^www\./, "").trim();
    if (!normalized) {
      return;
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  };
  const urlHostPattern = /https?:\/\/([^/\s?#]+)/gi;
  let urlMatch = urlHostPattern.exec(text);
  while (urlMatch) {
    pushUnique(urlMatch[1] ?? "");
    urlMatch = urlHostPattern.exec(text);
  }
  const domainPattern = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi;
  let domainMatch = domainPattern.exec(text);
  while (domainMatch) {
    pushUnique(domainMatch[1] ?? "");
    domainMatch = domainPattern.exec(text);
  }
  return result.slice(0, 3);
}

function detectIntentTags(raw: string): string[] {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return [];
  }
  const tags: string[] = [];
  const push = (value: string): void => {
    if (!tags.includes(value)) {
      tags.push(value);
    }
  };
  if (/(登录|登入|login|sign[ -]?in|账号|密码)/i.test(text)) {
    push("auth_login");
  }
  if (/(提取|抓取|抽取|scan|extract|parse|crawl|文档)/i.test(text)) {
    push("extract_info");
  }
  if (/(点击|click|勾选|checkbox|同意|submit|提交)/i.test(text)) {
    push("ui_action");
  }
  if (/(对比|compare|diff|分析|analysis|复盘|review)/i.test(text)) {
    push("analyze");
  }
  if (tags.length === 0) {
    push("generic");
  }
  return tags.slice(0, 3);
}

function collectSignatureKeywords(raw: string): string[] {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return [];
  }
  const keywords: string[] = [];
  const push = (value: string): void => {
    if (!value || SIGNATURE_STOPWORDS.has(value)) {
      return;
    }
    if (!keywords.includes(value)) {
      keywords.push(value);
    }
  };
  const latinTokens = text.match(/[a-z0-9_]{3,}/g) ?? [];
  for (const token of latinTokens) {
    push(token);
  }
  const hanTokens = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const token of hanTokens) {
    push(token);
  }
  return keywords.slice(0, 4);
}

function normalizeTaskSignature(userText: string): string {
  const lowered = cleanText(userText).toLowerCase();
  if (!lowered) {
    return "";
  }
  const domains = collectDomainHints(lowered);
  const intents = detectIntentTags(lowered);
  const topics = collectSignatureKeywords(lowered);
  const parts: string[] = [];
  if (domains.length > 0) {
    parts.push(`domain:${domains[0]}`);
  }
  if (intents.length > 0) {
    parts.push(`intent:${intents.join("+")}`);
  }
  if (topics.length > 0) {
    parts.push(`topic:${topics.join("+")}`);
  }
  const composite = parts.join(" | ");
  if (composite.length > 0) {
    return composite.slice(0, 120);
  }
  if (lowered.length <= 120) {
    return lowered;
  }
  return lowered.slice(0, 120);
}

function hasAmbiguousIntentSignal(raw: string): boolean {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return false;
  }
  if (text.length <= 4) {
    return true;
  }
  if (/^(继续|继续打磨|继续优化|还是这个|同上)$/.test(text)) {
    return true;
  }
  const pronounHeavy = /(这个|那个|这里|那里|它|这样|那样|上面|之前|刚才)/.test(text);
  const lacksConcreteTarget = !(/[/\\]/.test(text) || /[a-z0-9_-]{3,}\.[a-z0-9]{1,6}/i.test(text));
  if (pronounHeavy && lacksConcreteTarget) {
    return true;
  }
  return /(怎么做|咋办|怎么办|如何处理)\??$/.test(text);
}

function buildAskUserHintPrompt(input: {
  reason: string;
  userText: string;
}): string {
  return [
    "[AskUser Tool Hint]",
    `reason=${input.reason}`,
    `user_input=${cleanText(input.userText).slice(0, 160)}`,
    "If critical constraints are still missing, call ask_user exactly once.",
    "Question must be specific and unblock a single next action.",
    "Keep options <= 3 and avoid open-ended prompts unless necessary.",
  ].join("\n");
}

function buildSkillCardBlueprint(input: {
  userText: string;
  assistantText: string;
}): {
  preconditions: string[];
  steps: string[];
  failureSignals: string[];
  rollback: string[];
} {
  const cleanedUserText = cleanText(input.userText).toLowerCase();
  const cleanedAssistantText = cleanText(input.assistantText).toLowerCase();
  const domains = collectDomainHints(`${cleanedUserText} ${cleanedAssistantText}`);
  const primaryDomain = domains[0];
  const loginIntent = /(登录|登入|login|sign[ -]?in|账号|密码)/i.test(cleanedUserText);
  const agreementSignal = /(勾选|同意|checkbox|agree)/i.test(`${cleanedUserText} ${cleanedAssistantText}`);

  const preconditions = [
    "same runtime environment",
    "same tool policy",
  ];
  if (primaryDomain) {
    preconditions.push(`target domain matches ${primaryDomain}`);
  }

  if (loginIntent) {
    const steps = [
      `Open target login page${primaryDomain ? ` on ${primaryDomain}` : ""} and pin active session`,
      "Fill username/password fields using secure input path",
    ];
    if (agreementSignal) {
      steps.push("Ensure required agreement checkbox is checked before submit");
    }
    steps.push("Submit login and verify authenticated state via URL/title/content checks");
    return {
      preconditions,
      steps,
      failureSignals: [
        "still on login page after submit",
        "captcha or risk challenge appears",
        "required checkbox/agreement is not satisfied",
      ],
      rollback: [
        "fallback to previous verified strategy",
        "request user confirmation for captcha/risk-control step",
      ],
    };
  }

  return {
    preconditions,
    steps: [
      `Interpret user goal: ${cleanText(input.userText).slice(0, 120)}`,
      "Execute minimal tool chain and verify outcome",
      "Return concise summary with evidence",
    ],
    failureSignals: [
      "verification failed",
      "runtime provider repeated errors",
    ],
    rollback: [
      "fallback to previous verified strategy",
      "request user clarification if constraints changed",
    ],
  };
}

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
      evidenceRef: {
        traceId: input.traceId,
        source: `provider:${input.providerName}`,
      },
      tags: input.verificationPass ? ["turn", "success", "verified"] : ["turn", "success", "unverified"],
      confidence: input.verificationPass ? 0.9 : 0.6,
    });
    if (!input.verificationPass) {
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
      return;
    }
    const signature = normalizeTaskSignature(input.userText);
    if (!signature) {
      return;
    }
    const cards = skillCardsBySession.get(input.sessionKey) ?? [];
    const existing = cards.find((card) => card.taskSignature === signature);
    const evidenceRef: GaEvidenceRef = {
      traceId: input.traceId,
      source: `provider:${input.providerName}`,
    };
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
      evidenceRef: {
        traceId: input.traceId,
        source: `provider:${input.providerName}`,
      },
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
      text: `ask_user expired removed=${String(expired.length)} reason=${reason} ttl_seconds=${String(Math.floor(pendingAskMaxAgeMs / 1000))} oldest_age_seconds=${String(oldestAgeSeconds)}`,
      sourceEventType: "checkpoint_updated",
      executionVerified: false,
      tags: ["ask-user", "expired"],
      confidence: 0.8,
    });
    return expired;
  };

  return {
    buildAskUserDisplay: (envelope): string => buildAskUserDisplay(envelope),
    purgeExpiredPendingAsk: (sessionKey): AskUserEnvelope[] =>
      purgeExpiredPendingAsk(sessionKey, "read"),
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
        text: `ask_user issued ask_id=${envelope.askId} node=${envelope.blockingNodeId} queue_depth=${String(queueDepth)} queue_action=${queueAction} active_ask_id=${activeAskId}`,
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
      writeMemory({
        sessionKey,
        memoryLevel: "L2",
        text: `ask_user resolved ask_id=${resolvedAsk.envelope.askId} answer="${resolvedAsk.answer}" remaining=${String(resolved.queueSizeAfterResolve)}`,
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
      if (memory.length === 0 && skillCards.length === 0 && reflectionQueue.length === 0 && pendingAskQueue.length === 0 && !failureState) {
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
