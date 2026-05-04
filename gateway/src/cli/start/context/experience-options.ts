import { readOptionString, type OptionValue } from "../../cli-args";

export function resolveExperiencePublishMode(): "auto" | "off" {
  const raw = process.env.GROBOT_EXPERIENCE_PUBLISH_MODE?.trim().toLowerCase();
  if (raw === "off") {
    return "off";
  }
  return "auto";
}

export function resolveExperienceRecallLimit(): number {
  const raw = process.env.GROBOT_EXPERIENCE_RECALL_LIMIT?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return 2;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 2;
  }
  return Math.min(Math.max(parsed, 1), 6);
}

export function resolveExperienceTeam(
  options: Record<string, OptionValue>,
): string {
  const fromOption = readOptionString(options, "team");
  if (typeof fromOption === "string" && fromOption.trim().length > 0) {
    return fromOption.trim();
  }
  const fromEnv = process.env.GROBOT_TEAM;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return "default";
}
