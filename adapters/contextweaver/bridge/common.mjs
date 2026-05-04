export const DEFAULT_TIMEOUT_MS = 45_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 180_000;
export const MAX_EVIDENCE_TEXT_CHARS = 2_000;
export const MAX_WARNING_CHARS = 600;
export const DEFAULT_SOURCE_CONCURRENCY = 3;
export const MAX_SOURCE_CONCURRENCY = 8;

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function toStringArray(value, maxItems = 64) {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    rows.push(normalized);
    if (rows.length >= maxItems) {
      break;
    }
  }
  return rows;
}

export function toPositiveInt(value, fallback, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }
  return Math.min(normalized, max);
}

export function truncateText(value, maxChars) {
  if (typeof value !== "string") {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

export function stripAnsi(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

export function createError(errorClass, message, details) {
  const error = new Error(message);
  error.errorClass = errorClass;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

export function normalizeRefreshMode(value, fallback = "auto") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto") {
    return "auto";
  }
  if (normalized === "force" || normalized === "always") {
    return "force";
  }
  if (normalized === "skip" || normalized === "never") {
    return "skip";
  }
  return fallback;
}

export function shouldRetryWithRefresh(errorClass) {
  return errorClass === "semantic_index_required" || errorClass === "semantic_index_config_invalid";
}

export function normalizeToolErrorClass(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return [];
  }
  const runnerCount = Math.max(
    1,
    Math.min(toPositiveInt(concurrency, 1, MAX_SOURCE_CONCURRENCY), list.length),
  );
  const results = new Array(list.length);
  let nextIndex = 0;
  const runners = [];
  const launchRunner = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= list.length) {
        return;
      }
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  };
  for (let index = 0; index < runnerCount; index += 1) {
    runners.push(launchRunner());
  }
  await Promise.all(runners);
  return results;
}

export function pickDominantErrorClass(errorClasses, fallbackErrorClass) {
  const normalized = Array.isArray(errorClasses)
    ? errorClasses
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
  if (normalized.length === 0) {
    return fallbackErrorClass;
  }
  const priority = [
    "semantic_config_missing",
    "semantic_index_config_invalid",
    "semantic_index_confirmation_required",
    "semantic_index_required",
  ];
  for (const code of priority) {
    if (normalized.includes(code)) {
      return code;
    }
  }
  return normalized[0];
}

export function shouldDegradePromptEnhancerFailure(errorClass) {
  const normalized = typeof errorClass === "string" ? errorClass.trim() : "";
  if (!normalized) {
    return false;
  }
  return normalized === "semantic_index_config_invalid"
    || normalized === "semantic_index_confirmation_required"
    || normalized === "semantic_index_required";
}
