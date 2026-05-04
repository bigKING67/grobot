import { readFileSync } from "node:fs";
import {
  normalizeDescriptorItems,
  tokenizeSkillText,
  type JsonObject,
  type SkillDescriptor,
  type SkillRouterEvalCase,
  type SkillRoutingResult,
} from "./shared";

function setIntersectionCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) {
      count += 1;
    }
  }
  return count;
}

function phraseInNegatedContext(promptLower: string, phraseLower: string): boolean {
  if (!phraseLower || !promptLower.includes(phraseLower)) {
    return false;
  }
  const negatedMarkers = [
    `不要${phraseLower}`,
    `别${phraseLower}`,
    `避免${phraseLower}`,
    `not ${phraseLower}`,
    `don't ${phraseLower}`,
    `do not ${phraseLower}`,
    `avoid ${phraseLower}`,
  ];
  return negatedMarkers.some((marker) => promptLower.includes(marker));
}

function routeSkillForPrompt(
  userPrompt: string,
  descriptors: SkillDescriptor[],
  options: { scoreThreshold: number; minScoreGap: number },
): SkillRoutingResult | null {
  if (!Array.isArray(descriptors) || descriptors.length === 0 || !userPrompt.trim()) {
    return null;
  }
  const promptText = userPrompt.trim();
  const promptLower = promptText.toLowerCase();
  const promptTokens = tokenizeSkillText(promptText);
  const scoredItems: SkillRoutingResult[] = [];

  for (const descriptor of descriptors) {
    const positiveHits: string[] = [];
    const negativeHits: string[] = [];
    let positiveScore = 0;
    let negativeScore = 0;

    for (const phrase of descriptor.useWhen) {
      const phraseNorm = phrase.trim().toLowerCase();
      if (!phraseNorm) {
        continue;
      }
      if (promptLower.includes(phraseNorm)) {
        positiveScore += 4.0;
        positiveHits.push(`use:${phrase}`);
        continue;
      }
      const overlap = setIntersectionCount(promptTokens, tokenizeSkillText(phraseNorm));
      if (overlap > 0) {
        positiveScore += Math.min(2.4, overlap * 0.8);
        positiveHits.push(`use~${phrase}`);
      }
    }

    const keywordOverlap = setIntersectionCount(promptTokens, new Set<string>(descriptor.keywords));
    if (keywordOverlap > 0) {
      positiveScore += Math.min(3.0, keywordOverlap * 0.45);
    }

    for (const phrase of descriptor.dontUseWhen) {
      const phraseNorm = phrase.trim().toLowerCase();
      if (!phraseNorm) {
        continue;
      }
      if (promptLower.includes(phraseNorm)) {
        if (phraseInNegatedContext(promptLower, phraseNorm)) {
          positiveScore += 0.6;
          positiveHits.push(`avoid-negated:${phrase}`);
          continue;
        }
        negativeScore += 8.0;
        negativeHits.push(`avoid:${phrase}`);
        continue;
      }
      const overlap = setIntersectionCount(promptTokens, tokenizeSkillText(phraseNorm));
      if (overlap >= 2) {
        negativeScore += 4.5;
        negativeHits.push(`avoid~${phrase}`);
      }
    }

    if (
      descriptor.sideEffect &&
      ["只读", "read-only", "不要修改", "不要执行"].some((token) => promptLower.includes(token))
    ) {
      negativeScore += 3.0;
      negativeHits.push("avoid:side_effect_for_readonly");
    }

    const score = positiveScore - negativeScore + descriptor.specificity * 0.05;
    if (score < options.scoreThreshold) {
      continue;
    }
    const reasonParts: string[] = [];
    if (positiveHits.length > 0) {
      reasonParts.push(`matched=${positiveHits.slice(0, 3).join(",")}`);
    }
    if (negativeHits.length > 0) {
      reasonParts.push(`penalty=${negativeHits.slice(0, 2).join(",")}`);
    }
    if (reasonParts.length === 0) {
      reasonParts.push("matched=keyword-overlap");
    }
    scoredItems.push({
      descriptor,
      score,
      positiveHits,
      negativeHits,
      reason: reasonParts.join("; "),
    });
  }

  if (scoredItems.length === 0) {
    return null;
  }

  scoredItems.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.descriptor.specificity !== left.descriptor.specificity) {
      return right.descriptor.specificity - left.descriptor.specificity;
    }
    const rightProject = right.descriptor.scope === "project" ? 1 : 0;
    const leftProject = left.descriptor.scope === "project" ? 1 : 0;
    if (rightProject !== leftProject) {
      return rightProject - leftProject;
    }
    return right.descriptor.name.toLowerCase().localeCompare(left.descriptor.name.toLowerCase());
  });

  const top = scoredItems[0];
  if (scoredItems.length === 1) {
    return top;
  }
  const second = scoredItems[1];
  if (Math.abs(top.score - second.score) > options.minScoreGap) {
    return top;
  }

  const closeCandidates = scoredItems.filter(
    (item) => Math.abs(top.score - item.score) <= options.minScoreGap,
  );
  closeCandidates.sort((left, right) => {
    if (right.descriptor.specificity !== left.descriptor.specificity) {
      return right.descriptor.specificity - left.descriptor.specificity;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const rightProject = right.descriptor.scope === "project" ? 1 : 0;
    const leftProject = left.descriptor.scope === "project" ? 1 : 0;
    return rightProject - leftProject;
  });
  return closeCandidates[0] ?? null;
}

export function loadSkillRouterCases(path: string): SkillRouterEvalCase[] {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);
  const cases: SkillRouterEvalCase[] = [];
  for (const [index, lineRaw] of lines.entries()) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSON at line ${index + 1}: ${String(error)}`);
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error(`line ${index + 1}: expected object`);
    }
    const row = payload as JsonObject;
    const idRaw = row.id;
    const promptRaw = row.prompt;
    if (typeof idRaw !== "string" || !idRaw.trim()) {
      throw new Error(`line ${index + 1}: missing id`);
    }
    if (typeof promptRaw !== "string" || !promptRaw.trim()) {
      throw new Error(`line ${index + 1}: missing prompt`);
    }
    const expectedSkillRaw = row.expected_skill;
    const expectedSkill =
      typeof expectedSkillRaw === "string" && expectedSkillRaw.trim().length > 0
        ? expectedSkillRaw.trim()
        : null;
    const forbiddenSkills = normalizeDescriptorItems(row.forbidden_skills);
    cases.push({
      id: idRaw.trim(),
      prompt: promptRaw.trim(),
      expectedSkill,
      forbiddenSkills,
    });
  }
  return cases;
}

export function evaluateSkillRouterCases(input: {
  cases: SkillRouterEvalCase[];
  descriptors: SkillDescriptor[];
  scoreThreshold: number;
  minScoreGap: number;
}): JsonObject {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let passed = 0;
  let forbiddenViolations = 0;
  const caseResults: JsonObject[] = [];

  for (const item of input.cases) {
    const route = routeSkillForPrompt(item.prompt, input.descriptors, {
      scoreThreshold: input.scoreThreshold,
      minScoreGap: input.minScoreGap,
    });
    const selectedSkill = route?.descriptor.name ?? null;
    const expectedSkill = item.expectedSkill;
    const match = selectedSkill === expectedSkill;
    const forbiddenSet = new Set<string>(item.forbiddenSkills);
    const violation = selectedSkill !== null && forbiddenSet.has(selectedSkill);
    if (violation) {
      forbiddenViolations += 1;
    }
    const casePassed = match && !violation;
    if (casePassed) {
      passed += 1;
    }

    const expectedPositive = expectedSkill !== null;
    const selectedPositive = selectedSkill !== null;
    if (expectedPositive && selectedSkill === expectedSkill) {
      tp += 1;
    } else if (expectedPositive) {
      fn += 1;
      if (selectedPositive) {
        fp += 1;
      }
    } else if (selectedPositive) {
      fp += 1;
    } else {
      tn += 1;
    }

    caseResults.push({
      id: item.id,
      prompt: item.prompt,
      expected_skill: expectedSkill,
      selected_skill: selectedSkill,
      passed: casePassed,
      forbidden_violation: violation,
      forbidden_skills: item.forbiddenSkills,
      score: route ? Number(route.score.toFixed(4)) : null,
      reason: route?.reason ?? "no-route",
      positive_hits: route?.positiveHits ?? [],
      negative_hits: route?.negativeHits ?? [],
    });
  }

  const total = input.cases.length;
  const accuracy = total > 0 ? passed / total : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    summary: {
      total_cases: total,
      passed_cases: passed,
      failed_cases: total - passed,
      forbidden_violations: forbiddenViolations,
      accuracy: accuracy,
      precision: precision,
      recall: recall,
      f1: f1,
      tp: tp,
      tn: tn,
      fp: fp,
      fn: fn,
    },
    cases: caseResults,
  };
}

export function evaluateSkillRouterGate(input: {
  summary: JsonObject;
  minAccuracy: number | null;
  maxForbiddenViolations: number | null;
}): JsonObject {
  const checks: JsonObject[] = [];
  let passed = true;

  if (typeof input.minAccuracy === "number") {
    const actual = typeof input.summary.accuracy === "number" ? input.summary.accuracy : 0;
    const checkPassed = actual >= input.minAccuracy;
    checks.push({
      name: "min_accuracy",
      expected: input.minAccuracy,
      actual: actual,
      passed: checkPassed,
    });
    if (!checkPassed) {
      passed = false;
    }
  }
  if (typeof input.maxForbiddenViolations === "number") {
    const actualRaw = input.summary.forbidden_violations;
    const actual = typeof actualRaw === "number" ? Math.trunc(actualRaw) : 0;
    const checkPassed = actual <= input.maxForbiddenViolations;
    checks.push({
      name: "max_forbidden_violations",
      expected: input.maxForbiddenViolations,
      actual: actual,
      passed: checkPassed,
    });
    if (!checkPassed) {
      passed = false;
    }
  }

  return {
    passed,
    checks,
  };
}

export function evaluateSkillRouterTrend(input: {
  currentSummary: JsonObject;
  baselineSummary: JsonObject;
  maxAccuracyDrop: number | null;
  maxForbiddenIncrease: number | null;
}): JsonObject {
  const currentAccuracy =
    typeof input.currentSummary.accuracy === "number" ? input.currentSummary.accuracy : 0;
  const baselineAccuracy =
    typeof input.baselineSummary.accuracy === "number" ? input.baselineSummary.accuracy : 0;
  const currentForbiddenRaw = input.currentSummary.forbidden_violations;
  const baselineForbiddenRaw = input.baselineSummary.forbidden_violations;
  const currentForbidden = typeof currentForbiddenRaw === "number" ? Math.trunc(currentForbiddenRaw) : 0;
  const baselineForbidden = typeof baselineForbiddenRaw === "number" ? Math.trunc(baselineForbiddenRaw) : 0;
  const accuracyDrop = baselineAccuracy - currentAccuracy;
  const forbiddenIncrease = currentForbidden - baselineForbidden;
  const checks: JsonObject[] = [];
  let passed = true;

  if (typeof input.maxAccuracyDrop === "number") {
    const accuracyCheck = accuracyDrop <= input.maxAccuracyDrop;
    checks.push({
      name: "max_accuracy_drop",
      expected: input.maxAccuracyDrop,
      actual: accuracyDrop,
      passed: accuracyCheck,
    });
    if (!accuracyCheck) {
      passed = false;
    }
  }
  if (typeof input.maxForbiddenIncrease === "number") {
    const forbiddenCheck = forbiddenIncrease <= input.maxForbiddenIncrease;
    checks.push({
      name: "max_forbidden_increase",
      expected: input.maxForbiddenIncrease,
      actual: forbiddenIncrease,
      passed: forbiddenCheck,
    });
    if (!forbiddenCheck) {
      passed = false;
    }
  }

  return {
    passed,
    checks,
    current: {
      accuracy: currentAccuracy,
      forbidden_violations: currentForbidden,
    },
    baseline: {
      accuracy: baselineAccuracy,
      forbidden_violations: baselineForbidden,
    },
    deltas: {
      accuracy_drop: accuracyDrop,
      forbidden_increase: forbiddenIncrease,
    },
  };
}
