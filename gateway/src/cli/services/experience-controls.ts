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
  if (raw === undefined || raw.trim().length === 0) {
    return "auto";
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "auto" || normalized === "off") {
    return normalized;
  }
  throw new ExperienceControlInputError(
    "experience-publish-mode",
    "experience-publish-mode must be auto or off",
  );
}

export function resolveExperienceRecallLimit(
  raw = process.env.GROBOT_EXPERIENCE_RECALL_LIMIT,
): number {
  if (raw === undefined || raw.trim().length === 0) {
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
