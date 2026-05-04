import type { MemoryStrategyAutotuneProfile } from "../../tools/memory";

function normalizeMemoryStrategyProfile(
  raw: string | undefined,
): MemoryStrategyAutotuneProfile | undefined {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "general" ||
    normalized === "debug_heavy" ||
    normalized === "delivery" ||
    normalized === "docs"
  ) {
    return normalized;
  }
  return undefined;
}

export function resolveMemoryStrategyProfile(input: {
  envProfile: string | undefined;
  activeSessionKey: string;
  activeSessionPreview: string | undefined;
}): MemoryStrategyAutotuneProfile {
  const envProfile = normalizeMemoryStrategyProfile(input.envProfile);
  if (envProfile) {
    return envProfile;
  }
  const text =
    `${input.activeSessionKey} ${input.activeSessionPreview ?? ""}`.toLowerCase();
  if (/(debug|bug|fix|故障|排查|报错|修复|flaky)/.test(text)) {
    return "debug_heavy";
  }
  if (/(release|deploy|上线|发版|交付|deadline)/.test(text)) {
    return "delivery";
  }
  if (/(doc|readme|文档|总结|报告|spec)/.test(text)) {
    return "docs";
  }
  return "general";
}
