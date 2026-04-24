import {
  listSlashCommandSuggestions,
  type SlashCommandSuggestion,
} from "../commands/slash/registry";
import {
  listRunStartUserCommandSuggestions,
  type RunStartUserCommandSuggestion,
} from "./run-start-user-commands";
import {
  resolvePlanStatusRecommendationActionId,
  resolvePlanStatusRecommendation,
  resolvePlanStatusRecommendationCommand,
} from "./plan-state";
import { type RunStartPlanSuggestionState } from "./plan-suggestion-state";

export interface RunStartSlashSuggestion {
  command: string;
  description: string;
  source: "builtin" | "user";
}

export type RunStartPlanSuggestionStatus =
  | "draft"
  | "blocked"
  | "review_failed"
  | "ready"
  | "approved"
  | "applying"
  | "apply_failed"
  | "applied"
  | "discarded";

interface ListRunStartSlashSuggestionsInput {
  homeDir: string;
  userInput: string;
  pendingAskCount?: number;
  planMode?: boolean;
  planSuggestionState?: RunStartPlanSuggestionState;
  maxItems?: number;
}

const ROOT_SLASH_PRIMARY_BUILTIN_COMMANDS = new Set<string>([
  "sessions",
  "resume",
  "rewind",
  "commands",
  "skill-creator",
  "model",
  "plan",
  "status",
  "help",
  "exit",
]);

const PLAN_PRIMARY_PRIORITY_SUGGESTIONS: readonly RunStartSlashSuggestion[] = [
  {
    command: "/plan",
    description: "Enter plan mode (or show current plan status when already in plan mode)",
    source: "builtin",
  },
  {
    command: "/plan <goal>",
    description: "Start plan mode with a goal",
    source: "builtin",
  },
  {
    command: "/plan open",
    description: "Open active plan file in editor",
    source: "builtin",
  },
];

function resolvePlanEffectiveStatus(state: RunStartPlanSuggestionState | undefined): {
  activeStatus?: RunStartPlanSuggestionStatus;
  latestStatus?: RunStartPlanSuggestionStatus;
  effectiveStatus?: RunStartPlanSuggestionStatus;
  verificationPending: boolean;
} {
  const activeStatus = state?.activePlanStatus;
  const latestStatus = state?.latestPlanStatus;
  const latestVerificationStatus = state?.latestVerificationStatus;
  const effectiveStatus = activeStatus ?? latestStatus;
  return {
    activeStatus,
    latestStatus,
    effectiveStatus,
    verificationPending: latestVerificationStatus === undefined || latestVerificationStatus === "pending",
  };
}

function resolvePlanSuggestionStateTag(state: RunStartPlanSuggestionState | undefined): string | undefined {
  if (!state) {
    return undefined;
  }
  const resolved = resolvePlanEffectiveStatus(state);
  const activeStatus = resolved.activeStatus;
  const latestStatus = resolved.latestStatus;
  const effectiveStatus = resolved.effectiveStatus;
  const verificationLabel = resolved.verificationPending ? "pending" : "recorded";
  if (!activeStatus && (latestStatus === "applied" || latestStatus === "apply_failed")) {
    return `latest=${latestStatus}; verification=${verificationLabel}`;
  }
  if (effectiveStatus === "applied" || effectiveStatus === "apply_failed") {
    return `status=${effectiveStatus}; verification=${verificationLabel}`;
  }
  if (effectiveStatus) {
    return `status=${effectiveStatus}`;
  }
  return undefined;
}

function trimPlanRecommendationReason(reasonRaw: string): string {
  const compacted = reasonRaw.replace(/\s+/g, " ").trim();
  if (compacted.length <= 72) {
    return compacted;
  }
  return `${compacted.slice(0, 69)}...`;
}

function matchesPlanRecommendationCommand(input: {
  suggestionCommand: string;
  recommendationCommand: string;
}): boolean {
  const suggestionActionId = resolvePlanStatusRecommendationActionId(input.suggestionCommand);
  const recommendationActionId = resolvePlanStatusRecommendationActionId(input.recommendationCommand);
  if (recommendationActionId === "unknown" || suggestionActionId === "unknown") {
    return false;
  }
  if (suggestionActionId === recommendationActionId) {
    return true;
  }
  return false;
}

function resolvePlanSuggestionRecommendation(input: {
  planMode: boolean;
  state: RunStartPlanSuggestionState | undefined;
}): {
  command: string;
  reason: string;
} {
  if (
    typeof input.state?.activePlanRecommendationCommand === "string"
    && input.state.activePlanRecommendationCommand.trim().length > 0
    && typeof input.state?.activePlanRecommendationReason === "string"
    && input.state.activePlanRecommendationReason.trim().length > 0
  ) {
    return {
      command: input.state.activePlanRecommendationCommand.trim(),
      reason: trimPlanRecommendationReason(input.state.activePlanRecommendationReason),
    };
  }
  const recommendation = resolvePlanStatusRecommendation({
    mode: input.planMode === true ? "plan_only" : "normal",
    status: input.state?.activePlanStatus ?? input.state?.latestPlanStatus,
    latestVerificationStatus: input.state?.latestVerificationStatus,
    planQualityScore: input.state?.activePlanQualityScore,
    planQualityGuardLevel: input.state?.activePlanQualityGuardLevel,
  });
  return {
    command: resolvePlanStatusRecommendationCommand(recommendation.action),
    reason: trimPlanRecommendationReason(recommendation.reason),
  };
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function startsWithSlashToken(value: string): boolean {
  return value.trimStart().startsWith("/");
}

function isRootSlashQuery(value: string): boolean {
  return value.trim() === "/";
}

function resolveSlashHead(value: string): string | undefined {
  const head = value
    .trimStart()
    .split(/\s+/, 1)[0]
    ?.toLowerCase();
  if (!head || !head.startsWith("/")) {
    return undefined;
  }
  return head;
}

function matchesSuggestionQuery(queryRaw: string, suggestionCommandRaw: string): boolean {
  const query = normalizeForMatch(queryRaw);
  if (!query || query === "/") {
    return true;
  }
  const suggestionCommand = normalizeForMatch(suggestionCommandRaw);
  if (suggestionCommand.startsWith(query)) {
    return true;
  }
  const queryWithoutTrailingSpace = queryRaw.trimStart().toLowerCase().replace(/\s+$/g, "");
  if (queryWithoutTrailingSpace.length > 0 && suggestionCommand.startsWith(queryWithoutTrailingSpace)) {
    return true;
  }
  const queryTokens = queryWithoutTrailingSpace
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const suggestionTokens = suggestionCommand
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (queryTokens.length <= 0 || suggestionTokens.length <= 0) {
    return false;
  }
  if (queryTokens.length > 1) {
    for (let tokenIndex = 0; tokenIndex < queryTokens.length; tokenIndex += 1) {
      const queryToken = queryTokens[tokenIndex] ?? "";
      const suggestionToken = suggestionTokens[tokenIndex] ?? "";
      if (!queryToken || !suggestionToken || !suggestionToken.startsWith(queryToken)) {
        return false;
      }
    }
    return true;
  }
  const queryHead = queryTokens[0] ?? "";
  const suggestionHead = suggestionTokens[0] ?? "";
  if (!queryHead || !suggestionHead) {
    return false;
  }
  return suggestionHead.startsWith(queryHead);
}

function toBuiltinSuggestion(item: SlashCommandSuggestion): RunStartSlashSuggestion {
  return {
    command: item.command,
    description: item.description,
    source: "builtin",
  };
}

function toUserSuggestion(item: RunStartUserCommandSuggestion): RunStartSlashSuggestion {
  return {
    command: item.command,
    description: item.enabled ? item.description : `${item.description} (disabled)`,
    source: "user",
  };
}

export function listRunStartSlashSuggestions(
  input: ListRunStartSlashSuggestionsInput,
): RunStartSlashSuggestion[] {
  if (!startsWithSlashToken(input.userInput)) {
    return [];
  }
  const maxItems = typeof input.maxItems === "number" && input.maxItems > 0
    ? Math.floor(input.maxItems)
    : 8;
  const query = input.userInput.trimStart();
  const queryHead = resolveSlashHead(query);
  const normalizedQuery = normalizeForMatch(query);
  const isRootSlash = isRootSlashQuery(query);
  const planMode = input.planMode === true;
  const suggestions: RunStartSlashSuggestion[] = [];
  const seen = new Set<string>();

  const appendSuggestion = (item: RunStartSlashSuggestion): void => {
    const commandHead = (item.command.trim().split(/\s+/, 1)[0] ?? "").replace(/^\//, "").toLowerCase();
    const isRootSubcommand = item.command.trim().includes(" ");
    if (
      isRootSlash
      && item.source === "builtin"
      && !ROOT_SLASH_PRIMARY_BUILTIN_COMMANDS.has(commandHead)
    ) {
      return;
    }
    if (isRootSlash && item.source === "builtin" && isRootSubcommand) {
      return;
    }
    if (!matchesSuggestionQuery(query, item.command)) {
      return;
    }
    if (seen.has(item.command)) {
      return;
    }
    if (
      planMode
      && queryHead === "/plan"
      && normalizedQuery === "/plan"
      && item.command === "/plan"
    ) {
      return;
    }
    seen.add(item.command);
    suggestions.push(item);
  };

  if (queryHead === "/plan") {
    if (normalizedQuery === "/plan") {
      if (planMode) {
        appendSuggestion(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[0]);
      }
      appendSuggestion(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[1]);
      appendSuggestion(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[2]);
    } else {
      for (const entry of PLAN_PRIMARY_PRIORITY_SUGGESTIONS) {
        appendSuggestion(entry);
      }
    }
  }

  const builtin = listSlashCommandSuggestions();
  for (const entry of builtin) {
    appendSuggestion(toBuiltinSuggestion(entry));
  }

  const userCommands = listRunStartUserCommandSuggestions(input.homeDir);
  for (const entry of userCommands) {
    appendSuggestion(toUserSuggestion(entry));
  }

  const planRecommendation = queryHead === "/plan"
    ? resolvePlanSuggestionRecommendation({
      planMode,
      state: input.planSuggestionState,
    })
    : undefined;
  const planStateTag = queryHead === "/plan"
    ? resolvePlanSuggestionStateTag(input.planSuggestionState)
    : undefined;
  const hasExplicitRecommendationTarget = queryHead === "/plan" && planRecommendation
    ? suggestions.some((item) =>
      matchesPlanRecommendationCommand({
        suggestionCommand: item.command,
        recommendationCommand: planRecommendation.command,
      }))
    : false;
  const renderedSuggestions = queryHead === "/plan"
    ? suggestions.map((item, index) => {
      if (!item.command.startsWith("/plan")) {
        return item;
      }
      const suffixParts: string[] = [];
      if (planStateTag) {
        suffixParts.push(planStateTag);
      }
      if (
        planRecommendation
        && planRecommendation.reason.length > 0
        && (
          matchesPlanRecommendationCommand({
            suggestionCommand: item.command,
            recommendationCommand: planRecommendation.command,
          })
          || (!hasExplicitRecommendationTarget && index === 0)
        )
      ) {
        suffixParts.push(`Recommended now: ${planRecommendation.reason}`);
      }
      if (suffixParts.length <= 0) {
        return item;
      }
      return {
        ...item,
        description: `${item.description} · ${suffixParts.join(" · ")}`,
      };
    })
    : suggestions;

  if (renderedSuggestions.length <= maxItems) {
    return renderedSuggestions;
  }
  return renderedSuggestions.slice(0, maxItems);
}
