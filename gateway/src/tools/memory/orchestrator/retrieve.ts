import { buildGaSkillCardPrompt } from "../../ga-skill";
import { retrieveLineageSummaries } from "../../context/lineage/lineage-memory";
import type {
  CreateMemoryOrchestratorInput,
  MemoryContextBlock,
  MemoryOrchestratorInjectInput,
  MemoryOrchestratorInjectResult,
  MemoryOrchestratorPolicySnapshot,
  MemoryOrchestratorRetrieveInput,
  MemoryOrchestratorRetrieveResult,
} from "./contract";
import {
  buildInjectBudget,
  selectBlocksByBudget,
} from "./budget";
import {
  scoreGaMemoryRelevance,
  scoreTeamExperienceRelevance,
} from "./relevance";
import {
  clamp,
  compactLine,
  tokenize,
} from "./utils";

export function retrieveMemoryContext(
  input: CreateMemoryOrchestratorInput,
  policy: MemoryOrchestratorPolicySnapshot,
  request: MemoryOrchestratorRetrieveInput,
): MemoryOrchestratorRetrieveResult {
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
}

export function injectMemoryContext(
  input: CreateMemoryOrchestratorInput,
  policy: MemoryOrchestratorPolicySnapshot,
  request: MemoryOrchestratorInjectInput,
): MemoryOrchestratorInjectResult {
  const base = retrieveMemoryContext(input, policy, {
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
}
