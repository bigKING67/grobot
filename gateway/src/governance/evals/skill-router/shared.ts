export type JsonObject = Record<string, unknown>;

export interface SkillRouterEvalCase {
  id: string;
  prompt: string;
  expectedSkill: string | null;
  forbiddenSkills: string[];
}

export interface SkillRouterPolicyConfig {
  sourcePath: string;
  cases: string;
  globalSkillsDir: string;
  projectSkillsDir: string;
  projectToml: string | null;
  scoreThreshold: number | null;
  minScoreGap: number | null;
  maxDescriptors: number | null;
  descriptorScanLines: number | null;
  minAccuracy: number | null;
  maxForbiddenViolations: number | null;
  maxAccuracyDrop: number | null;
  maxForbiddenIncrease: number | null;
}

export interface SkillRouterConfig {
  enabled: boolean;
  descriptorScanLines: number;
  maxDescriptors: number;
  scoreThreshold: number;
  minScoreGap: number;
}

export interface SkillDescriptor {
  name: string;
  scope: "global" | "project";
  source: string;
  skillFile: string;
  description: string;
  useWhen: string[];
  dontUseWhen: string[];
  output: string;
  sideEffect: boolean;
  rateLimit: string | null;
  keywords: string[];
  specificity: number;
}

export interface SkillRoutingResult {
  descriptor: SkillDescriptor;
  score: number;
  positiveHits: string[];
  negativeHits: string[];
  reason: string;
}

export const SKILL_ROUTER_SCORE_THRESHOLD = 2.0;
export const SKILL_ROUTER_MIN_SCORE_GAP = 0.8;
export const SKILL_DESCRIPTOR_MAX_ITEMS = 64;
export const SKILL_DESCRIPTOR_MAX_SCAN_LINES = 180;
export const SKILL_DESCRIPTOR_MAX_OUTPUT_LEN = 240;
export const SKILL_METADATA_FILENAME = "skill.meta.toml";
export const SKILL_SIDE_EFFECT_KEYWORDS = ["deploy", "release", "push", "publish", "write", "delete", "修改", "写入", "发布"];

const SKILL_ROUTER_TOKEN_PATTERN = /[A-Za-z0-9_./:-]{2,}|[\u4e00-\u9fff]{1,8}/g;

export function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function dirname(path: string): string {
  const normalized = normalizePath(path).replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function basename(path: string): string {
  const normalized = normalizePath(path).replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return normalized;
  }
  return normalized.slice(slash + 1);
}

export function pathJoin(base: string, relative: string): string {
  const baseTrimmed = normalizePath(base).replace(/[\\/]+$/, "");
  const relTrimmed = normalizePath(relative).replace(/^[\\/]+/, "");
  return `${baseTrimmed}/${relTrimmed}`;
}

export function parseBoolOption(rawValue: unknown, defaultValue: boolean): boolean {
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

export function parsePositiveIntOption(rawValue: unknown, defaultValue: number, minValue: number, maxValue: number): number {
  if (typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue > 0) {
    return Math.max(minValue, Math.min(maxValue, rawValue));
  }
  return Math.max(minValue, Math.min(maxValue, defaultValue));
}

export function parseFloatOption(rawValue: unknown, defaultValue: number, minValue: number, maxValue: number): number {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return Math.max(minValue, Math.min(maxValue, rawValue));
  }
  return Math.max(minValue, Math.min(maxValue, defaultValue));
}

export function tokenizeSkillText(rawText: string): Set<string> {
  if (typeof rawText !== "string") {
    return new Set<string>();
  }
  const lowered = rawText.toLowerCase();
  const tokens = new Set<string>();
  for (const match of lowered.matchAll(SKILL_ROUTER_TOKEN_PATTERN)) {
    const token = match[0];
    if (token) {
      tokens.add(token);
    }
  }
  for (const chunkMatch of lowered.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const chunk = chunkMatch[0];
    const length = chunk.length;
    for (const width of [2, 3, 4]) {
      if (length < width) {
        continue;
      }
      for (let index = 0; index <= length - width; index += 1) {
        tokens.add(chunk.slice(index, index + width));
      }
    }
  }
  return tokens;
}

export function normalizeDescriptorItems(rawValue: unknown): string[] {
  if (typeof rawValue === "string") {
    const values: string[] = [];
    const chunks = rawValue.split(/[;\n；]/);
    for (const chunk of chunks) {
      for (const piece of chunk.split(/[，,、]/)) {
        const item = piece.trim();
        if (item) {
          values.push(item);
        }
      }
    }
    return values;
  }
  if (Array.isArray(rawValue)) {
    const values: string[] = [];
    for (const item of rawValue) {
      if (typeof item !== "string") {
        continue;
      }
      const stripped = item.trim();
      if (stripped) {
        values.push(stripped);
      }
    }
    return values;
  }
  return [];
}
