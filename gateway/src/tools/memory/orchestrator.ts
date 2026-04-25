import { buildGaSkillCardPrompt } from "../ga-skill";
import { estimateTokensFromText } from "../context";
import { retrieveLineageSummaries } from "../context/lineage/lineage-memory";

export type MemoryLevel = "L1" | "L2" | "L3" | "L4";
export type MemoryEventType =
  | "turn_success"
  | "turn_failure"
  | "verification_failure"
  | "tool_success"
  | "ask_user_resolved"
  | "manual_import";

export interface MemoryOrchestratorGaMemoryRecord {
  id: string;
  memoryLevel: MemoryLevel;
  text: string;
  executionVerified: boolean;
  confidence: number;
  createdAt: string;
  tags: readonly string[];
}

export interface MemoryOrchestratorGaSkillCard {
  id: string;
  taskSignature: string;
  preconditions: readonly string[];
  steps: readonly string[];
  failureSignals: readonly string[];
  rollback: readonly string[];
  confidence: number;
  updatedAt: string;
}

export interface MemoryOrchestratorExperienceRecord {
  id: string;
  user: string;
  taskSignature?: string;
  taskType?: string;
  scenarioTags?: readonly string[];
  summary: string;
  sop: readonly string[];
  reuseGuardrails?: readonly string[];
  confidence: number;
  successCount: number;
  failureCount: number;
  recoverySuccessCount?: number;
  consecutiveFailureCount?: number;
  lastFailureClass?: string;
  lastSuccessStrategy?: string;
  state: "active" | "quarantined" | "disabled";
}

export interface MemoryOrchestratorExperienceSearchMatch {
  record: MemoryOrchestratorExperienceRecord;
  score: number;
}

export interface MemoryOrchestratorExperienceRecall {
  prompt: string;
  matched: number;
  candidates: number;
}

export interface MemoryOrchestratorExperiencePublishResult {
  skipped: boolean;
  reason?: string;
  verificationPassed: boolean;
  evidenceRefPassed: boolean;
  redactionPassed: boolean;
  created?: boolean;
  recordId?: string;
  confidence?: number;
}

export interface MemoryOrchestratorExperienceFailureResult {
  matched: boolean;
  recordId?: string;
  score?: number;
  confidence?: number;
  quarantined?: boolean;
  conflictIsolated?: boolean;
}

export interface MemoryOrchestratorGaAdapter {
  listMemory(sessionKey: string): readonly MemoryOrchestratorGaMemoryRecord[];
  listSkillCards(sessionKey: string): readonly MemoryOrchestratorGaSkillCard[];
  registerTurnSuccess(input: {
    sessionKey: string;
    userText: string;
    assistantText: string;
    traceId: string;
    providerName: string;
    verificationPass: boolean;
  }): void;
  registerTurnFailure(input: {
    sessionKey: string;
    providerName: string;
    errorClass: string;
    errorMessage: string;
    traceId?: string;
  }): void;
  writeMemory?(input: {
    sessionKey: string;
    memoryLevel: MemoryLevel;
    text: string;
    sourceEventType:
      | "turn_executed"
      | "tool_executed"
      | "checkpoint_updated"
      | "reflection_generated"
      | "ask_user_resolved";
    executionVerified: boolean;
    evidenceRef?: {
      traceId?: string;
      turnId?: string;
      toolCallId?: string;
      source?: string;
    };
    tags?: string[];
    confidence?: number;
  }): {
    ok: boolean;
    code: string;
    message?: string;
    record?: MemoryOrchestratorGaMemoryRecord;
  };
}

export interface MemoryOrchestratorExperienceAdapter {
  getTeamDefault(): string;
  buildRecallPrompt(input: {
    sessionKey: string;
    userText: string;
  }): MemoryOrchestratorExperienceRecall;
  searchRecords(input: {
    tenant: string;
    query: string;
    limit: number;
    includeStates?: readonly ("active" | "quarantined" | "disabled")[];
    team?: string;
    user?: string;
  }): readonly MemoryOrchestratorExperienceSearchMatch[];
  registerTurnSuccess(input: {
    sessionKey: string;
    userText: string;
    assistantText: string;
    traceId: string;
    providerName: string;
    verificationPass: boolean;
    evidenceRef: {
      traceId?: string;
      runId?: string;
      toolCallId?: string;
      url?: string;
      sourceType?: string;
      capturedAt?: string;
    };
  }): MemoryOrchestratorExperiencePublishResult;
  registerTurnFailure(input: {
    sessionKey: string;
    userText: string;
    providerName: string;
    errorClass: string;
    errorMessage: string;
    failureStage?: "planning" | "implementation" | "verification" | "runtime" | "unknown";
    toolContext?: string;
  }): MemoryOrchestratorExperienceFailureResult;
}

export interface MemoryOrchestratorPolicySnapshot {
  version: string;
  enabled: boolean;
  injectBudgetRatio: number;
  injectBudgetMinTokens: number;
  injectBudgetMaxTokens: number;
  maxSectionTokens: number;
  maxGaMemoryRows: number;
  maxTeamExperienceRows: number;
  minTeamExperienceScore: number;
  decayEnabled: boolean;
  decayMaxRowsPerSession: number;
  decayMinRowsToKeep: number;
  decayMaxAgeHoursL1: number;
  decayMaxAgeHoursL2: number;
  decayMaxAgeHoursL3: number;
  decayMaxAgeHoursL4: number;
  decayUnverifiedMaxAgeHours: number;
  decayMinConfidenceVerified: number;
  decayMinConfidenceUnverified: number;
}

export interface MemoryOrchestratorInjectInput {
  sessionKey: string;
  userText: string;
  targetTokenLimit: number;
  tenant: string;
  team?: string;
  user: string;
  includeLineage: boolean;
  lineageMaxRows: number;
  lineageMaxCommits: number;
  lineageCacheTtlMs: number;
  workDir?: string;
}

export interface MemoryOrchestratorInjectResult {
  promptParts: string[];
  usedTokens: number;
  budgetTokens: number;
  sectionCount: number;
  includedSections: string[];
  truncatedSections: string[];
  stderrEvents: string[];
}

export type MemoryOrchestratorFeedbackInput =
  | {
    type: "turn_success";
    sessionKey: string;
    userText: string;
    assistantText: string;
    traceId: string;
    requestId?: string;
    providerName: string;
    verificationPass: boolean;
  }
  | {
    type: "turn_failure";
    sessionKey: string;
    userText: string;
    providerName: string;
    errorClass: string;
    errorMessage: string;
    traceId?: string;
    failureStage?: "planning" | "implementation" | "verification" | "runtime" | "unknown";
    toolContext?: string;
  }
  | {
    type: "verification_failure";
    sessionKey: string;
    userText: string;
    providerName: string;
    errorMessage: string;
  };

export interface MemoryOrchestratorFeedbackResult {
  stderrEvents: string[];
}

export interface MemoryOrchestratorIngestInput {
  eventType: MemoryEventType;
  sessionKey: string;
  text: string;
  executionVerified: boolean;
  evidenceRef?: {
    traceId?: string;
    turnId?: string;
    toolCallId?: string;
    source?: string;
  };
  tags?: string[];
  confidence?: number;
}

export interface MemoryOrchestratorIngestResult {
  accepted: boolean;
  reason?: string;
  stderrEvents: string[];
}

function mapMemoryEventTypeToSourceEventType(eventType: MemoryEventType):
  | "turn_executed"
  | "tool_executed"
  | "checkpoint_updated"
  | "reflection_generated"
  | "ask_user_resolved" {
  if (eventType === "ask_user_resolved") {
    return "ask_user_resolved";
  }
  if (eventType === "tool_success") {
    return "tool_executed";
  }
  if (eventType === "turn_success") {
    return "turn_executed";
  }
  if (eventType === "manual_import") {
    return "reflection_generated";
  }
  return "checkpoint_updated";
}

export interface MemoryOrchestratorRetrieveInput {
  sessionKey: string;
  userText: string;
  tenant: string;
  team?: string;
  user: string;
}

export interface MemoryOrchestratorRetrieveResult {
  gaSkillPrompt: string;
  gaSkillMatched: number;
  gaSkillTotal: number;
  personalExperiencePrompt: string;
  personalExperienceMatched: number;
  personalExperienceCandidates: number;
  gaMemoryRows: string[];
  teamExperienceRows: string[];
}

export interface MemoryOrchestratorReconcileInput<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  rows: readonly T[];
}

export interface MemoryOrchestratorReconcileResult<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  deduplicated: number;
  kept: number;
  rows: readonly T[];
}

export interface MemoryOrchestratorDecayInput<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  rows: readonly T[];
  nowMs?: number;
}

export interface MemoryOrchestratorDecayResult<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  action: "noop" | "pruned";
  reason: string;
  kept: number;
  dropped: number;
  rows: readonly T[];
  droppedByReason: {
    ageExceeded: number;
    lowConfidence: number;
    capacityTrim: number;
  };
  keptByLevel: Record<MemoryLevel, number>;
}

export interface MemoryOrchestratorDecayPolicyOverride {
  decayMaxRowsPerSession?: number;
  decayMinRowsToKeep?: number;
  decayUnverifiedMaxAgeHours?: number;
  decayMinConfidenceVerified?: number;
  decayMinConfidenceUnverified?: number;
}

export interface MemoryOrchestratorInjectionPolicyOverride {
  injectBudgetRatio?: number;
  injectBudgetMinTokens?: number;
  injectBudgetMaxTokens?: number;
  maxSectionTokens?: number;
  maxGaMemoryRows?: number;
  maxTeamExperienceRows?: number;
  minTeamExperienceScore?: number;
}

export interface MemoryOrchestrator {
  policySnapshot(): MemoryOrchestratorPolicySnapshot;
  ingest(input: MemoryOrchestratorIngestInput): MemoryOrchestratorIngestResult;
  retrieve(input: MemoryOrchestratorRetrieveInput): MemoryOrchestratorRetrieveResult;
  reconcile<T extends MemoryOrchestratorGaMemoryRecord>(
    input: MemoryOrchestratorReconcileInput<T>,
  ): MemoryOrchestratorReconcileResult<T>;
  decay<T extends MemoryOrchestratorGaMemoryRecord>(
    input: MemoryOrchestratorDecayInput<T>,
  ): MemoryOrchestratorDecayResult<T>;
  tuneInjectionPolicy(
    input: MemoryOrchestratorInjectionPolicyOverride,
  ): MemoryOrchestratorPolicySnapshot;
  tuneDecayPolicy(input: MemoryOrchestratorDecayPolicyOverride): MemoryOrchestratorPolicySnapshot;
  feedback(input: MemoryOrchestratorFeedbackInput): MemoryOrchestratorFeedbackResult;
  injectContext(input: MemoryOrchestratorInjectInput): MemoryOrchestratorInjectResult;
}

export interface CreateMemoryOrchestratorInput {
  ga: MemoryOrchestratorGaAdapter;
  experience: MemoryOrchestratorExperienceAdapter;
  workDir?: string;
  policy?: Partial<MemoryOrchestratorPolicySnapshot>;
}

interface MemoryContextBlock {
  name: string;
  priority: number;
  text: string;
}

export function defaultMemoryOrchestratorPolicy(): MemoryOrchestratorPolicySnapshot {
  return {
    version: "v1",
    enabled: true,
    injectBudgetRatio: 0.22,
    injectBudgetMinTokens: 280,
    injectBudgetMaxTokens: 2600,
    maxSectionTokens: 1200,
    maxGaMemoryRows: 4,
    maxTeamExperienceRows: 3,
    minTeamExperienceScore: 36,
    decayEnabled: true,
    decayMaxRowsPerSession: 240,
    decayMinRowsToKeep: 4,
    decayMaxAgeHoursL1: 7 * 24,
    decayMaxAgeHoursL2: 30 * 24,
    decayMaxAgeHoursL3: 90 * 24,
    decayMaxAgeHoursL4: 180 * 24,
    decayUnverifiedMaxAgeHours: 72,
    decayMinConfidenceVerified: 0.2,
    decayMinConfidenceUnverified: 0.45,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function createMemoryLevelCounter(): Record<MemoryLevel, number> {
  return {
    L1: 0,
    L2: 0,
    L3: 0,
    L4: 0,
  };
}

function normalizeText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function parseCreatedAtMs(createdAt: string): number | undefined {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function computeAgeHours(nowMs: number, createdAt: string): number {
  const createdAtMs = parseCreatedAtMs(createdAt);
  if (typeof createdAtMs !== "number") {
    return 0;
  }
  return Math.max(0, (nowMs - createdAtMs) / 3_600_000);
}

function resolveDecayMaxAgeHours(
  policy: MemoryOrchestratorPolicySnapshot,
  row: MemoryOrchestratorGaMemoryRecord,
): number {
  let maxAgeByLevel = policy.decayMaxAgeHoursL2;
  if (row.memoryLevel === "L1") {
    maxAgeByLevel = policy.decayMaxAgeHoursL1;
  } else if (row.memoryLevel === "L3") {
    maxAgeByLevel = policy.decayMaxAgeHoursL3;
  } else if (row.memoryLevel === "L4") {
    maxAgeByLevel = policy.decayMaxAgeHoursL4;
  }
  if (!row.executionVerified) {
    return Math.min(maxAgeByLevel, policy.decayUnverifiedMaxAgeHours);
  }
  return maxAgeByLevel;
}

function scoreDecayRetention(input: {
  policy: MemoryOrchestratorPolicySnapshot;
  row: MemoryOrchestratorGaMemoryRecord;
  nowMs: number;
}): number {
  const confidence = clamp(input.row.confidence, 0, 1);
  const ageHours = computeAgeHours(input.nowMs, input.row.createdAt);
  const maxAgeHours = Math.max(
    1,
    resolveDecayMaxAgeHours(input.policy, input.row),
  );
  const freshness = Math.max(0, 1 - Math.min(ageHours, maxAgeHours) / maxAgeHours);
  const levelWeight =
    input.row.memoryLevel === "L4"
      ? 6
      : input.row.memoryLevel === "L3"
      ? 4
      : input.row.memoryLevel === "L2"
      ? 2
      : 1;
  const executionBoost = input.row.executionVerified ? 0.8 : 0;
  return Number((levelWeight + executionBoost + (confidence * 3.2) + freshness).toFixed(6));
}

function buildDecayReason(input: {
  droppedByReason: {
    ageExceeded: number;
    lowConfidence: number;
    capacityTrim: number;
  };
  dropped: number;
}): string {
  if (input.dropped <= 0) {
    return "within_policy";
  }
  return [
    `age_exceeded:${String(input.droppedByReason.ageExceeded)}`,
    `low_confidence:${String(input.droppedByReason.lowConfidence)}`,
    `capacity_trim:${String(input.droppedByReason.capacityTrim)}`,
  ].join(",");
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 36);
}

function compactLine(raw: string, maxChars: number): string {
  const normalized = normalizeText(raw);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function extractFirstUrl(raw: string): string | undefined {
  const match = raw.match(/https?:\/\/\S+/);
  return match?.[0];
}

function scoreGaMemoryRelevance(input: {
  userTokens: readonly string[];
  row: MemoryOrchestratorGaMemoryRecord;
}): number {
  const text = input.row.text.toLowerCase();
  let overlap = 0;
  for (const token of input.userTokens) {
    if (text.includes(token)) {
      overlap += 1;
    }
  }
  const overlapScore = Math.min(90, overlap * 18);
  const confidenceScore = clamp(input.row.confidence, 0, 1) * 48;
  const executionBoost = input.row.executionVerified ? 20 : 0;
  const memoryLevelBoost = input.row.memoryLevel === "L3" ? 16 : input.row.memoryLevel === "L2" ? 10 : 5;
  const ageHours = Math.max(0, (Date.now() - Date.parse(input.row.createdAt)) / 3_600_000);
  const freshnessScore = Math.max(0, 30 - Math.min(30, ageHours)) * 0.35;
  return Number((overlapScore + confidenceScore + executionBoost + memoryLevelBoost + freshnessScore).toFixed(4));
}

function scoreTeamExperienceRelevance(input: {
  userText: string;
  row: MemoryOrchestratorExperienceSearchMatch;
}): number {
  const userTokens = tokenize(input.userText);
  const summary = input.row.record.summary.toLowerCase();
  const taskSignature = (input.row.record.taskSignature ?? "").toLowerCase();
  const taskType = (input.row.record.taskType ?? "").toLowerCase();
  const scenarioTags = (input.row.record.scenarioTags ?? []).map((item) => item.toLowerCase());
  let overlap = 0;
  let taskOverlap = 0;
  let scenarioOverlap = 0;
  for (const token of userTokens) {
    if (summary.includes(token)) {
      overlap += 1;
    }
    if (taskSignature.includes(token)) {
      taskOverlap += 1;
    }
    if (scenarioTags.some((tag) => tag.includes(token) || token.includes(tag))) {
      scenarioOverlap += 1;
    }
  }
  const overlapScore = overlap * 10;
  const taskScore = taskOverlap * 12;
  const scenarioScore = scenarioOverlap * 8;
  const taskTypeScore = taskType && input.userText.toLowerCase().includes(taskType) ? 8 : 0;
  const baseScore = input.row.score;
  const confidenceScore = clamp(input.row.record.confidence, 0, 1) * 25;
  const successBoost = Math.min(20, input.row.record.successCount * 2.5);
  const failurePenalty = Math.min(18, input.row.record.failureCount * 3);
  const recoveryBoost = Math.min(12, (input.row.record.recoverySuccessCount ?? 0) * 2.5);
  const instabilityPenalty = Math.min(14, (input.row.record.consecutiveFailureCount ?? 0) * 4);
  return Number((
    baseScore
    + overlapScore
    + taskScore
    + scenarioScore
    + taskTypeScore
    + confidenceScore
    + successBoost
    + recoveryBoost
    - failurePenalty
    - instabilityPenalty
  ).toFixed(4));
}

function fitBlockToTokens(rawBlock: string, maxTokens: number): {
  text: string;
  truncated: boolean;
} | undefined {
  if (maxTokens <= 0) {
    return undefined;
  }
  const tokens = estimateTokensFromText(rawBlock);
  if (tokens <= maxTokens) {
    return {
      text: rawBlock,
      truncated: false,
    };
  }
  const lines = rawBlock.split(/\r?\n/);
  if (lines.length <= 2) {
    return undefined;
  }
  let cursor = lines.length;
  while (cursor > 2) {
    const candidate = `${lines.slice(0, cursor).join("\n")}\n[... trimmed by memory orchestrator budget]`;
    if (estimateTokensFromText(candidate) <= maxTokens) {
      return {
        text: candidate,
        truncated: true,
      };
    }
    cursor -= 1;
  }
  return undefined;
}

function buildInjectBudget(policy: MemoryOrchestratorPolicySnapshot, targetTokenLimit: number): number {
  const ratioBudget = Math.floor(targetTokenLimit * clamp(policy.injectBudgetRatio, 0.05, 0.45));
  return clamp(
    ratioBudget,
    policy.injectBudgetMinTokens,
    Math.max(policy.injectBudgetMinTokens, policy.injectBudgetMaxTokens),
  );
}

function selectBlocksByBudget(input: {
  blocks: readonly MemoryContextBlock[];
  budgetTokens: number;
  maxSectionTokens: number;
}): {
  promptParts: string[];
  usedTokens: number;
  includedSections: string[];
  truncatedSections: string[];
} {
  let usedTokens = 0;
  const promptParts: string[] = [];
  const includedSections: string[] = [];
  const truncatedSections: string[] = [];
  const sorted = [...input.blocks].sort((left, right) => right.priority - left.priority);
  for (const block of sorted) {
    if (usedTokens >= input.budgetTokens) {
      break;
    }
    const remaining = input.budgetTokens - usedTokens;
    const sectionCap = Math.min(remaining, input.maxSectionTokens);
    const fitted = fitBlockToTokens(block.text, sectionCap);
    if (!fitted) {
      continue;
    }
    const fittedTokens = estimateTokensFromText(fitted.text);
    promptParts.push(fitted.text);
    includedSections.push(block.name);
    if (fitted.truncated) {
      truncatedSections.push(block.name);
    }
    usedTokens += fittedTokens;
  }
  return {
    promptParts,
    usedTokens,
    includedSections,
    truncatedSections,
  };
}

export function createMemoryOrchestrator(input: CreateMemoryOrchestratorInput): MemoryOrchestrator {
  const policy: MemoryOrchestratorPolicySnapshot = {
    ...defaultMemoryOrchestratorPolicy(),
    ...(input.policy ?? {}),
  };

  const retrieve = (request: MemoryOrchestratorRetrieveInput): MemoryOrchestratorRetrieveResult => {
    const gaSkillPromptResult = buildGaSkillCardPrompt({
      userText: request.userText,
      cards: input.ga.listSkillCards(request.sessionKey).map((card) => ({
        taskSignature: card.taskSignature,
        confidence: card.confidence,
        preconditions: card.preconditions,
        steps: card.steps,
        failureSignals: card.failureSignals,
        rollback: card.rollback,
        updatedAt: card.updatedAt,
      })),
    });
    const personalExperience = input.experience.buildRecallPrompt({
      sessionKey: request.sessionKey,
      userText: request.userText,
    });
    const userTokens = tokenize(request.userText);
    const gaMemoryRows = input.ga
      .listMemory(request.sessionKey)
      .map((row) => ({
        row,
        score: scoreGaMemoryRelevance({
          userTokens,
          row,
        }),
      }))
      .filter((item) => item.score >= 36)
      .sort((left, right) => right.score - left.score)
      .slice(0, policy.maxGaMemoryRows)
      .map((item) => {
        const tags = item.row.tags.length > 0 ? ` tags=${item.row.tags.slice(0, 3).join(",")}` : "";
        return `- ${item.row.memoryLevel} score=${item.score.toFixed(2)} confidence=${item.row.confidence.toFixed(2)}${tags} text=${compactLine(item.row.text, 160)}`;
      });

    const teamMatches = input.experience.searchRecords({
      tenant: request.tenant,
      team: request.team ?? input.experience.getTeamDefault(),
      query: request.userText,
      limit: Math.max(6, policy.maxTeamExperienceRows * 4),
      includeStates: ["active"],
    });
    const teamExperienceRows = teamMatches
      .map((row) => ({
        ...row,
        weightedScore: scoreTeamExperienceRelevance({
          userText: request.userText,
          row,
        }),
      }))
      .filter((row) => row.record.user !== request.user)
      .filter((row) => row.weightedScore >= policy.minTeamExperienceScore)
      .sort((left, right) => right.weightedScore - left.weightedScore)
      .slice(0, policy.maxTeamExperienceRows)
      .map((row, index) => {
        const sopPreview = row.record.sop.length > 0
          ? ` sop=${row.record.sop.slice(0, 3).join(" -> ")}`
          : "";
        const taskPreview = row.record.taskType ? ` task=${row.record.taskType}` : "";
        const scenarioPreview = row.record.scenarioTags && row.record.scenarioTags.length > 0
          ? ` scenario=${row.record.scenarioTags.slice(0, 2).join(",")}`
          : "";
        const recoveryPreview = typeof row.record.recoverySuccessCount === "number"
          ? ` recovery=${String(row.record.recoverySuccessCount)}`
          : "";
        return `- team_exp#${String(index + 1)} user=${row.record.user} score=${row.weightedScore.toFixed(2)} confidence=${row.record.confidence.toFixed(2)} summary=${compactLine(row.record.summary, 140)}${taskPreview}${scenarioPreview}${recoveryPreview}${sopPreview}`;
      });

    return {
      gaSkillPrompt: gaSkillPromptResult.prompt,
      gaSkillMatched: gaSkillPromptResult.matched,
      gaSkillTotal: gaSkillPromptResult.total,
      personalExperiencePrompt: personalExperience.prompt,
      personalExperienceMatched: personalExperience.matched,
      personalExperienceCandidates: personalExperience.candidates,
      gaMemoryRows,
      teamExperienceRows,
    };
  };

  const injectContext = (request: MemoryOrchestratorInjectInput): MemoryOrchestratorInjectResult => {
    const base = retrieve({
      sessionKey: request.sessionKey,
      userText: request.userText,
      tenant: request.tenant,
      team: request.team,
      user: request.user,
    });
    const blocks: MemoryContextBlock[] = [];
    if (base.gaSkillPrompt.trim().length > 0) {
      blocks.push({
        name: "ga_skill_cards",
        priority: 100,
        text: base.gaSkillPrompt,
      });
    }
    if (base.personalExperiencePrompt.trim().length > 0) {
      blocks.push({
        name: "personal_experience",
        priority: 90,
        text: base.personalExperiencePrompt,
      });
    }
    if (base.gaMemoryRows.length > 0) {
      blocks.push({
        name: "session_hot_memory",
        priority: 80,
        text: ["[Session Hot Memory]", ...base.gaMemoryRows].join("\n"),
      });
    }
    if (base.teamExperienceRows.length > 0) {
      blocks.push({
        name: "team_memory",
        priority: 65,
        text: ["[Team Shared Memory]", ...base.teamExperienceRows].join("\n"),
      });
    }
    if (request.includeLineage) {
      const lineageRows = retrieveLineageSummaries(
        request.userText,
        clamp(request.lineageMaxRows, 1, 16),
        {
          workDir: request.workDir ?? input.workDir,
          maxCommits: clamp(request.lineageMaxCommits, 20, 500),
          cacheTtlMs: clamp(request.lineageCacheTtlMs, 1_000, 600_000),
        },
      );
      if (lineageRows.length > 0) {
        const lineageLines = lineageRows.map((row) => {
          const author = row.author?.trim();
          const date = row.timestamp ? row.timestamp.slice(0, 10) : "";
          const meta = [author, date].filter((item) => Boolean(item)).join(" ");
          return `- ${row.commitId.slice(0, 8)} ${row.summary}${meta ? ` (${meta})` : ""}`;
        });
        blocks.push({
          name: "lineage_memory",
          priority: 50,
          text: ["[Commit Lineage Memory]", ...lineageLines].join("\n"),
        });
      }
    }
    const budgetTokens = buildInjectBudget(policy, request.targetTokenLimit);
    const selected = selectBlocksByBudget({
      blocks,
      budgetTokens,
      maxSectionTokens: policy.maxSectionTokens,
    });
    const stderrEvents: string[] = [];
    if (selected.promptParts.length > 0) {
      stderrEvents.push(
        `[memory-orchestrator] event=context_injected sections=${selected.includedSections.join(",")} truncated=${selected.truncatedSections.length > 0 ? selected.truncatedSections.join(",") : "<none>"} used_tokens=${String(selected.usedTokens)} budget_tokens=${String(budgetTokens)}\n`,
      );
    } else {
      stderrEvents.push(
        `[memory-orchestrator] event=context_skipped reason=budget_or_no_signal budget_tokens=${String(budgetTokens)}\n`,
      );
    }
    return {
      promptParts: selected.promptParts,
      usedTokens: selected.usedTokens,
      budgetTokens,
      sectionCount: selected.promptParts.length,
      includedSections: selected.includedSections,
      truncatedSections: selected.truncatedSections,
      stderrEvents,
    };
  };

  return {
    policySnapshot: () => ({ ...policy }),
    tuneInjectionPolicy: (override): MemoryOrchestratorPolicySnapshot => {
      if (typeof override.injectBudgetRatio === "number") {
        policy.injectBudgetRatio = clamp(
          Number(override.injectBudgetRatio.toFixed(4)),
          0.05,
          0.55,
        );
      }
      if (typeof override.injectBudgetMinTokens === "number") {
        policy.injectBudgetMinTokens = clamp(
          Math.floor(override.injectBudgetMinTokens),
          64,
          8_192,
        );
      }
      if (typeof override.injectBudgetMaxTokens === "number") {
        policy.injectBudgetMaxTokens = clamp(
          Math.floor(override.injectBudgetMaxTokens),
          64,
          16_384,
        );
      }
      if (policy.injectBudgetMaxTokens < policy.injectBudgetMinTokens) {
        policy.injectBudgetMaxTokens = policy.injectBudgetMinTokens;
      }
      if (typeof override.maxSectionTokens === "number") {
        policy.maxSectionTokens = clamp(
          Math.floor(override.maxSectionTokens),
          96,
          8_192,
        );
      }
      if (typeof override.maxGaMemoryRows === "number") {
        policy.maxGaMemoryRows = clamp(
          Math.floor(override.maxGaMemoryRows),
          1,
          32,
        );
      }
      if (typeof override.maxTeamExperienceRows === "number") {
        policy.maxTeamExperienceRows = clamp(
          Math.floor(override.maxTeamExperienceRows),
          1,
          32,
        );
      }
      if (typeof override.minTeamExperienceScore === "number") {
        policy.minTeamExperienceScore = clamp(
          Math.floor(override.minTeamExperienceScore),
          0,
          160,
        );
      }
      return {
        ...policy,
      };
    },
    tuneDecayPolicy: (override): MemoryOrchestratorPolicySnapshot => {
      const minRowsToKeep = typeof override.decayMinRowsToKeep === "number"
        ? clamp(Math.floor(override.decayMinRowsToKeep), 1, 64)
        : policy.decayMinRowsToKeep;
      policy.decayMinRowsToKeep = minRowsToKeep;
      if (typeof override.decayMaxRowsPerSession === "number") {
        policy.decayMaxRowsPerSession = clamp(
          Math.floor(override.decayMaxRowsPerSession),
          minRowsToKeep,
          2_048,
        );
      }
      if (typeof override.decayUnverifiedMaxAgeHours === "number") {
        policy.decayUnverifiedMaxAgeHours = clamp(
          Math.floor(override.decayUnverifiedMaxAgeHours),
          1,
          8_760,
        );
      }
      if (typeof override.decayMinConfidenceVerified === "number") {
        policy.decayMinConfidenceVerified = clamp(
          Number(override.decayMinConfidenceVerified.toFixed(4)),
          0,
          1,
        );
      }
      if (typeof override.decayMinConfidenceUnverified === "number") {
        policy.decayMinConfidenceUnverified = clamp(
          Number(override.decayMinConfidenceUnverified.toFixed(4)),
          0,
          1,
        );
      }
      return {
        ...policy,
      };
    },
    ingest: (request): MemoryOrchestratorIngestResult => {
      if (!input.ga.writeMemory) {
        return {
          accepted: false,
          reason: "ga_write_memory_unavailable",
          stderrEvents: [
            "[memory-orchestrator] event=ingest_skipped reason=ga_write_memory_unavailable\n",
          ],
        };
      }
      const normalizedText = normalizeText(request.text);
      if (!normalizedText) {
        return {
          accepted: false,
          reason: "empty_text",
          stderrEvents: [
            "[memory-orchestrator] event=ingest_skipped reason=empty_text\n",
          ],
        };
      }
      const writeResult = input.ga.writeMemory({
        sessionKey: request.sessionKey,
        memoryLevel: request.executionVerified ? "L2" : "L1",
        text: normalizedText,
        sourceEventType: mapMemoryEventTypeToSourceEventType(request.eventType),
        executionVerified: request.executionVerified,
        evidenceRef: request.evidenceRef,
        tags: request.tags,
        confidence: request.confidence,
      });
      if (!writeResult.ok) {
        return {
          accepted: false,
          reason: writeResult.code,
          stderrEvents: [
            `[memory-orchestrator] event=ingest_rejected reason=${writeResult.code} message=${writeResult.message ?? "<none>"}\n`,
          ],
        };
      }
      return {
        accepted: true,
        stderrEvents: [
          `[memory-orchestrator] event=ingest_accepted level=${writeResult.record?.memoryLevel ?? "<none>"} id=${writeResult.record?.id ?? "<none>"}\n`,
        ],
      };
    },
    retrieve,
    reconcile: <T extends MemoryOrchestratorGaMemoryRecord>(
      request: MemoryOrchestratorReconcileInput<T>,
    ): MemoryOrchestratorReconcileResult<T> => {
      const dedupe = new Set<string>();
      let deduplicated = 0;
      const rows: T[] = [];
      for (const row of request.rows) {
        const key = `${row.memoryLevel}:${normalizeText(row.text).toLowerCase()}`;
        if (dedupe.has(key)) {
          deduplicated += 1;
          continue;
        }
        dedupe.add(key);
        rows.push(row);
      }
      return {
        deduplicated,
        kept: rows.length,
        rows,
      };
    },
    decay: <T extends MemoryOrchestratorGaMemoryRecord>(
      request: MemoryOrchestratorDecayInput<T>,
    ): MemoryOrchestratorDecayResult<T> => {
      const rows = [...request.rows];
      const droppedByReason = {
        ageExceeded: 0,
        lowConfidence: 0,
        capacityTrim: 0,
      };
      if (!policy.decayEnabled) {
        const keptByLevel = createMemoryLevelCounter();
        for (const row of rows) {
          keptByLevel[row.memoryLevel] += 1;
        }
        return {
          action: "noop",
          reason: "policy_disabled",
          kept: rows.length,
          dropped: 0,
          rows,
          droppedByReason,
          keptByLevel,
        };
      }
      if (rows.length === 0) {
        return {
          action: "noop",
          reason: "empty_rows",
          kept: 0,
          dropped: 0,
          rows,
          droppedByReason,
          keptByLevel: createMemoryLevelCounter(),
        };
      }
      const minRowsToKeep = Math.max(1, Math.floor(policy.decayMinRowsToKeep));
      if (rows.length <= minRowsToKeep) {
        const keptByLevel = createMemoryLevelCounter();
        for (const row of rows) {
          keptByLevel[row.memoryLevel] += 1;
        }
        return {
          action: "noop",
          reason: "below_min_rows_to_keep",
          kept: rows.length,
          dropped: 0,
          rows,
          droppedByReason,
          keptByLevel,
        };
      }
      const nowMs = Number.isFinite(request.nowMs) ? Number(request.nowMs) : Date.now();
      const candidates: Array<{ index: number; score: number; row: T }> = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const ageHours = computeAgeHours(nowMs, row.createdAt);
        const maxAgeHours = resolveDecayMaxAgeHours(policy, row);
        if (ageHours > maxAgeHours) {
          droppedByReason.ageExceeded += 1;
          continue;
        }
        const minConfidence = row.executionVerified
          ? policy.decayMinConfidenceVerified
          : policy.decayMinConfidenceUnverified;
        if (clamp(row.confidence, 0, 1) < minConfidence) {
          droppedByReason.lowConfidence += 1;
          continue;
        }
        candidates.push({
          index,
          score: scoreDecayRetention({
            policy,
            row,
            nowMs,
          }),
          row,
        });
      }
      const maxRows = Math.max(1, Math.floor(policy.decayMaxRowsPerSession));
      let keptCandidates = candidates;
      if (candidates.length > maxRows) {
        const sorted = [...candidates].sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          if (left.row.confidence !== right.row.confidence) {
            return right.row.confidence - left.row.confidence;
          }
          return left.index - right.index;
        });
        keptCandidates = sorted.slice(0, maxRows);
        droppedByReason.capacityTrim = Math.max(0, sorted.length - keptCandidates.length);
      }
      const keepIndex = new Set<number>(keptCandidates.map((item) => item.index));
      const keptRows: T[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        if (keepIndex.has(index)) {
          keptRows.push(rows[index]);
        }
      }
      const keptByLevel = createMemoryLevelCounter();
      for (const row of keptRows) {
        keptByLevel[row.memoryLevel] += 1;
      }
      const dropped = rows.length - keptRows.length;
      return {
        action: dropped > 0 ? "pruned" : "noop",
        reason: buildDecayReason({
          droppedByReason,
          dropped,
        }),
        kept: keptRows.length,
        dropped,
        rows: keptRows,
        droppedByReason,
        keptByLevel,
      };
    },
    feedback: (request): MemoryOrchestratorFeedbackResult => {
      const stderrEvents: string[] = [];
      if (request.type === "turn_success") {
        input.ga.registerTurnSuccess({
          sessionKey: request.sessionKey,
          userText: request.userText,
          assistantText: request.assistantText,
          traceId: request.traceId,
          providerName: request.providerName,
          verificationPass: request.verificationPass,
        });
        const publish = input.experience.registerTurnSuccess({
          sessionKey: request.sessionKey,
          userText: request.userText,
          assistantText: request.assistantText,
          traceId: request.traceId,
          providerName: request.providerName,
          verificationPass: request.verificationPass,
          evidenceRef: {
            traceId: request.traceId,
            runId: request.requestId,
            url: extractFirstUrl(request.userText),
            sourceType: "turn_success",
            capturedAt: nowIso(),
          },
        });
        if (publish.skipped) {
          stderrEvents.push(
            `[experience] event=publish_skipped reason=${publish.reason ?? "unknown"} gate_verification=${publish.verificationPassed ? "pass" : "fail"} gate_evidence_ref=${publish.evidenceRefPassed ? "pass" : "fail"} gate_redaction=${publish.redactionPassed ? "pass" : "fail"}\n`,
          );
        } else {
          stderrEvents.push(
            `[experience] event=published id=${publish.recordId ?? "<unknown>"} created=${publish.created ? "true" : "false"} confidence=${typeof publish.confidence === "number" ? publish.confidence.toFixed(2) : "n/a"} gate_verification=${publish.verificationPassed ? "pass" : "fail"} gate_evidence_ref=${publish.evidenceRefPassed ? "pass" : "fail"} gate_redaction=${publish.redactionPassed ? "pass" : "fail"}\n`,
          );
        }
        return {
          stderrEvents,
        };
      }
      if (request.type === "verification_failure") {
        const failure = input.experience.registerTurnFailure({
          sessionKey: request.sessionKey,
          userText: request.userText,
          providerName: request.providerName,
          errorClass: "verification_failed",
          errorMessage: request.errorMessage,
          failureStage: "verification",
        });
        if (failure.matched) {
          stderrEvents.push(
            `[experience] event=failure_feedback id=${failure.recordId ?? "<unknown>"} score=${typeof failure.score === "number" ? failure.score.toFixed(2) : "n/a"} confidence=${typeof failure.confidence === "number" ? failure.confidence.toFixed(2) : "n/a"} quarantined=${failure.quarantined ? "true" : "false"} conflict_isolated=${failure.conflictIsolated ? "true" : "false"}\n`,
          );
        }
        return {
          stderrEvents,
        };
      }
      input.ga.registerTurnFailure({
        sessionKey: request.sessionKey,
        providerName: request.providerName,
        errorClass: request.errorClass,
        errorMessage: request.errorMessage,
        traceId: request.traceId,
      });
      const failure = input.experience.registerTurnFailure({
        sessionKey: request.sessionKey,
        userText: request.userText,
        providerName: request.providerName,
        errorClass: request.errorClass,
        errorMessage: request.errorMessage,
        failureStage: request.failureStage,
        toolContext: request.toolContext,
      });
      if (failure.matched) {
        stderrEvents.push(
          `[experience] event=failure_feedback id=${failure.recordId ?? "<unknown>"} score=${typeof failure.score === "number" ? failure.score.toFixed(2) : "n/a"} confidence=${typeof failure.confidence === "number" ? failure.confidence.toFixed(2) : "n/a"} quarantined=${failure.quarantined ? "true" : "false"} conflict_isolated=${failure.conflictIsolated ? "true" : "false"}\n`,
        );
      }
      return {
        stderrEvents,
      };
    },
    injectContext,
  };
}
