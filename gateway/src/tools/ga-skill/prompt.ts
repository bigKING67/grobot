export interface GaSkillCardPromptSource {
  taskSignature: string;
  confidence: number;
  preconditions: readonly string[];
  steps: readonly string[];
  failureSignals: readonly string[];
  rollback: readonly string[];
  updatedAt: string;
}

export interface ExperienceRecallPromptSource {
  prompt: string;
  matched: number;
  candidates: number;
}

export interface GaSkillCardPromptResult {
  prompt: string;
  matched: number;
  total: number;
}

export interface ApplyLearnedPromptContextInput {
  promptParts: readonly string[];
  userText: string;
  gaSkillCards: readonly GaSkillCardPromptSource[];
  experienceRecall: ExperienceRecallPromptSource;
}

export interface ApplyLearnedPromptContextResult {
  promptParts: string[];
  stderrEvents: string[];
  gaSkillCardPrompt: GaSkillCardPromptResult;
}

function collectPromptMatchDomains(raw: string): string[] {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return [];
  }
  const rows: string[] = [];
  const push = (candidate: string): void => {
    const normalized = candidate.replace(/^www\./, "").trim();
    if (!normalized) {
      return;
    }
    if (!rows.includes(normalized)) {
      rows.push(normalized);
    }
  };
  const urlHostPattern = /https?:\/\/([^/\s?#]+)/gi;
  let urlMatch = urlHostPattern.exec(text);
  while (urlMatch) {
    push(urlMatch[1] ?? "");
    urlMatch = urlHostPattern.exec(text);
  }
  const domainPattern = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi;
  let domainMatch = domainPattern.exec(text);
  while (domainMatch) {
    push(domainMatch[1] ?? "");
    domainMatch = domainPattern.exec(text);
  }
  return rows.slice(0, 4);
}

function collectPromptMatchTokens(raw: string): string[] {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return [];
  }
  const rows: string[] = [];
  const push = (value: string): void => {
    if (!value || rows.includes(value)) {
      return;
    }
    rows.push(value);
  };
  const latin = text.match(/[a-z0-9_]{3,}/g) ?? [];
  for (const token of latin) {
    push(token);
  }
  const han = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const token of han) {
    push(token);
  }
  return rows.slice(0, 12);
}

function scoreSkillCardRelevance(input: {
  userText: string;
  card: GaSkillCardPromptSource;
}): number {
  const normalizedUserText = input.userText.trim().toLowerCase();
  const signature = input.card.taskSignature.trim().toLowerCase();
  const domains = collectPromptMatchDomains(normalizedUserText);
  const tokens = collectPromptMatchTokens(normalizedUserText);
  let score = input.card.confidence * 100;
  if (signature.length > 0 && normalizedUserText.includes(signature)) {
    score += 140;
  }
  for (const domain of domains) {
    if (signature.includes(domain)) {
      score += 60;
    }
  }
  let overlapScore = 0;
  for (const token of tokens) {
    if (signature.includes(token)) {
      overlapScore += 14;
    }
  }
  score += Math.min(70, overlapScore);
  const cardText = [
    ...input.card.preconditions,
    ...input.card.steps,
    ...input.card.failureSignals,
    ...input.card.rollback,
  ].join(" ").toLowerCase();
  if (cardText.length > 0) {
    let detailOverlap = 0;
    for (const token of tokens) {
      if (cardText.includes(token)) {
        detailOverlap += 5;
      }
    }
    score += Math.min(45, detailOverlap);
  }
  const updatedAtMs = Date.parse(input.card.updatedAt);
  if (Number.isFinite(updatedAtMs)) {
    const ageHours = Math.max(0, (Date.now() - updatedAtMs) / 3_600_000);
    score += Math.max(0, 24 - ageHours) * 0.4;
  }
  return Number(score.toFixed(4));
}

export function buildGaSkillCardPrompt(input: {
  userText: string;
  cards: readonly GaSkillCardPromptSource[];
}): GaSkillCardPromptResult {
  if (input.cards.length === 0) {
    return { prompt: "", matched: 0, total: 0 };
  }
  const ranked = input.cards
    .map((card) => ({
      card,
      score: scoreSkillCardRelevance({
        userText: input.userText,
        card,
      }),
    }))
    .filter((item) => item.score >= 55)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) {
    return { prompt: "", matched: 0, total: input.cards.length };
  }
  const selected = ranked.slice(0, 2);
  const lines: string[] = [
    "[GA Learned Skill Cards]",
    "Reuse these previously verified strategies when they match current intent.",
  ];
  for (let index = 0; index < selected.length; index += 1) {
    const row = selected[index];
    lines.push(`- card#${String(index + 1)} signature="${row.card.taskSignature}" confidence=${row.card.confidence.toFixed(2)} score=${row.score.toFixed(2)}`);
    if (row.card.preconditions.length > 0) {
      lines.push(`  preconditions: ${row.card.preconditions.slice(0, 3).join(" ; ")}`);
    }
    if (row.card.steps.length > 0) {
      lines.push(`  steps: ${row.card.steps.slice(0, 4).join(" -> ")}`);
    }
    if (row.card.failureSignals.length > 0) {
      lines.push(`  failure_signals: ${row.card.failureSignals.slice(0, 3).join(" ; ")}`);
    }
    if (row.card.rollback.length > 0) {
      lines.push(`  rollback: ${row.card.rollback.slice(0, 2).join(" ; ")}`);
    }
  }
  return {
    prompt: lines.join("\n"),
    matched: selected.length,
    total: input.cards.length,
  };
}

export function applyLearnedPromptContext(
  input: ApplyLearnedPromptContextInput,
): ApplyLearnedPromptContextResult {
  const promptParts = [...input.promptParts];
  const stderrEvents: string[] = [];
  const gaSkillCardPrompt = buildGaSkillCardPrompt({
    userText: input.userText,
    cards: input.gaSkillCards,
  });
  if (gaSkillCardPrompt.prompt.length > 0) {
    promptParts.push(gaSkillCardPrompt.prompt);
    stderrEvents.push(
      `[ga-skill] event=prompt_injected matched=${String(gaSkillCardPrompt.matched)} total=${String(gaSkillCardPrompt.total)}\n`,
    );
  }
  if (input.experienceRecall.prompt.length > 0) {
    promptParts.push(input.experienceRecall.prompt);
    stderrEvents.push(
      `[experience] event=prompt_injected matched=${String(input.experienceRecall.matched)} candidates=${String(input.experienceRecall.candidates)}\n`,
    );
  }
  return {
    promptParts,
    stderrEvents,
    gaSkillCardPrompt,
  };
}
