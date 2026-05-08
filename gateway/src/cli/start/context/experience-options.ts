import { readOptionString, type OptionValue } from "../../cli-args";
export {
  resolveExperiencePublishMode,
  resolveExperienceRecallLimit,
} from "../../services/experience-controls";

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
