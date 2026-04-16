import { applyLearnedPromptContext, buildGaSkillCardPrompt } from "../../tools/ga-skill";

const now = Date.now();
const cards = [
  {
    taskSignature: "domain:example.com | intent:login | topic:session",
    confidence: 0.82,
    preconditions: ["same runtime environment", "target domain matches example.com"],
    steps: [
      "Open target login page",
      "Fill username/password fields",
      "Submit login and verify authenticated state",
    ],
    failureSignals: ["still on login page after submit"],
    rollback: ["fallback to previous verified strategy"],
    updatedAt: new Date(now - 30 * 60 * 1000).toISOString(),
  },
  {
    taskSignature: "domain:docs.example.org | intent:search | topic:api",
    confidence: 0.5,
    preconditions: ["network available"],
    steps: ["run web search"],
    failureSignals: ["search timeout"],
    rollback: ["retry with fallback"],
    updatedAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
  },
] as const;

const directPrompt = buildGaSkillCardPrompt({
  userText: "请帮我在 example.com 登录并保持会话",
  cards,
});
const applied = applyLearnedPromptContext({
  promptParts: ["[Base Prompt]"],
  userText: "请帮我在 example.com 登录并保持会话",
  gaSkillCards: cards,
  experienceRecall: {
    prompt: "[Experience Recall]\nreuse previous verified flow",
    matched: 1,
    candidates: 3,
  },
});
const coldCards = cards.map((card) => ({
  ...card,
  confidence: 0.2,
  updatedAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
}));
const noMatch = applyLearnedPromptContext({
  promptParts: ["base prompt"],
  userText: "完全不相关的话题",
  gaSkillCards: coldCards,
  experienceRecall: {
    prompt: "",
    matched: 0,
    candidates: 0,
  },
});

const payload = {
  direct_has_header: directPrompt.prompt.includes("[GA Learned Skill Cards]"),
  direct_matched: directPrompt.matched,
  direct_total: directPrompt.total,
  apply_keeps_existing_prefix: applied.promptParts[0] === "[Base Prompt]",
  apply_has_ga_prompt: applied.promptParts.some((part) => part.includes("[GA Learned Skill Cards]")),
  apply_has_experience_prompt: applied.promptParts.some((part) => part.includes("[Experience Recall]")),
  apply_has_ga_event: applied.stderrEvents.some((line) => line.includes("[ga-skill] event=prompt_injected")),
  apply_has_experience_event: applied.stderrEvents.some((line) => line.includes("[experience] event=prompt_injected")),
  no_match_skips_ga_prompt: noMatch.promptParts.includes("base prompt") && !noMatch.promptParts.some((part) => part.includes("[GA Learned Skill Cards]")),
  no_match_no_events: noMatch.stderrEvents.length === 0,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
