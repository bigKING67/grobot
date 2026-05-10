import {
  type OptionValue,
  readEnvOptionalNonEmptyString,
  readExplicitOptionalNonEmptyString,
} from "../cli-args";

export type ExperiencePublishMode = "auto" | "off";

export class ExperienceControlInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "ExperienceControlInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isExperienceControlInputError(
  error: unknown,
): error is ExperienceControlInputError {
  return error instanceof ExperienceControlInputError;
}

export function resolveExperiencePublishMode(
  raw = process.env.GROBOT_EXPERIENCE_PUBLISH_MODE,
): ExperiencePublishMode {
  if (raw === undefined) {
    return "auto";
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new ExperienceControlInputError(
      "experience-publish-mode",
      "experience-publish-mode must be auto or off",
    );
  }
  if (normalized === "auto" || normalized === "off") {
    return normalized;
  }
  throw new ExperienceControlInputError(
    "experience-publish-mode",
    "experience-publish-mode must be auto or off",
  );
}

export function readExperiencePublishModeFromEnv(
  env: Record<string, string | undefined> = process.env,
): ExperiencePublishMode | undefined {
  return env.GROBOT_EXPERIENCE_PUBLISH_MODE === undefined
    ? undefined
    : resolveExperiencePublishMode(env.GROBOT_EXPERIENCE_PUBLISH_MODE);
}

export function resolveExperienceRecallLimit(
  raw = process.env.GROBOT_EXPERIENCE_RECALL_LIMIT,
): number {
  if (raw === undefined) {
    return 2;
  }
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ExperienceControlInputError(
      "experience-recall-limit",
      "experience-recall-limit must be an integer between 1 and 6",
    );
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 6) {
    throw new ExperienceControlInputError(
      "experience-recall-limit",
      "experience-recall-limit must be an integer between 1 and 6",
    );
  }
  return parsed;
}

export function readExperienceRecallLimitFromEnv(
  env: Record<string, string | undefined> = process.env,
): number | undefined {
  return env.GROBOT_EXPERIENCE_RECALL_LIMIT === undefined
    ? undefined
    : resolveExperienceRecallLimit(env.GROBOT_EXPERIENCE_RECALL_LIMIT);
}

export function resolveExperienceTeam(
  options?: Record<string, OptionValue>,
  env: Record<string, string | undefined> = process.env,
): string {
  const fromOption = options
    ? readExplicitOptionalNonEmptyString(options, "team")
    : undefined;
  if (typeof fromOption === "string") {
    return fromOption;
  }
  return readEnvOptionalNonEmptyString(env, "GROBOT_TEAM", "team") ?? "default";
}

export function readExperienceTeamFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return readEnvOptionalNonEmptyString(env, "GROBOT_TEAM", "team");
}

export function resolveExperiencePoolPathOverride(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return readEnvOptionalNonEmptyString(
    env,
    "GROBOT_EXPERIENCE_POOL_PATH",
    "experience-pool-path",
  );
}

export function readExperiencePoolPathOverrideFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return resolveExperiencePoolPathOverride(env);
}
