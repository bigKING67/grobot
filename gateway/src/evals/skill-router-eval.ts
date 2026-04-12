import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { computeSkillRouterPolicyFingerprint, loadSkillRouterEvalPolicy } from "./skill-router-policy-guard";

type JsonObject = Record<string, unknown>;

export interface SkillRouterEvalCase {
  id: string;
  prompt: string;
  expectedSkill: string | null;
  forbiddenSkills: string[];
}

interface SkillRouterPolicyConfig {
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

interface SkillRouterConfig {
  enabled: boolean;
  descriptorScanLines: number;
  maxDescriptors: number;
  scoreThreshold: number;
  minScoreGap: number;
}

interface SkillDescriptor {
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

interface SkillRoutingResult {
  descriptor: SkillDescriptor;
  score: number;
  positiveHits: string[];
  negativeHits: string[];
  reason: string;
}

interface ParsedCliArgs {
  policyPath: string | null;
  casesPath: string | null;
  globalSkillsDir: string | null;
  projectSkillsDir: string | null;
  projectTomlPath: string | null;
  scoreThreshold: number | null;
  minScoreGap: number | null;
  maxDescriptors: number | null;
  descriptorScanLines: number | null;
  compareReportPath: string | null;
  maxAccuracyDrop: number | null;
  maxForbiddenIncrease: number | null;
  outputPath: string | null;
  printJson: boolean;
  failOnForbidden: boolean;
  minAccuracy: number | null;
  maxForbiddenViolations: number | null;
  failOnGate: boolean;
  dryValidateOnly: boolean;
  failOnTrend: boolean;
}

const SKILL_ROUTER_SCORE_THRESHOLD = 2.0;
const SKILL_ROUTER_MIN_SCORE_GAP = 0.8;
const SKILL_DESCRIPTOR_MAX_ITEMS = 64;
const SKILL_DESCRIPTOR_MAX_SCAN_LINES = 180;
const SKILL_DESCRIPTOR_MAX_OUTPUT_LEN = 240;
const SKILL_METADATA_FILENAME = "skill.meta.toml";
const SKILL_SIDE_EFFECT_KEYWORDS = ["deploy", "release", "push", "publish", "write", "delete", "修改", "写入", "发布"];
const SKILL_ROUTER_TOKEN_PATTERN = /[A-Za-z0-9_./:-]{2,}|[\u4e00-\u9fff]{1,8}/g;

function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path).replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function basename(path: string): string {
  const normalized = normalizePath(path).replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return normalized;
  }
  return normalized.slice(slash + 1);
}

function pathJoin(base: string, relative: string): string {
  const baseTrimmed = normalizePath(base).replace(/[\\/]+$/, "");
  const relTrimmed = normalizePath(relative).replace(/^[\\/]+/, "");
  return `${baseTrimmed}/${relTrimmed}`;
}

function isAbsolutePath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function readArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1] ?? "";
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be int`);
  }
  return parsed;
}

function parseFloatNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be number`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    policyPath: null,
    casesPath: null,
    globalSkillsDir: null,
    projectSkillsDir: null,
    projectTomlPath: null,
    scoreThreshold: null,
    minScoreGap: null,
    maxDescriptors: null,
    descriptorScanLines: null,
    compareReportPath: null,
    maxAccuracyDrop: null,
    maxForbiddenIncrease: null,
    outputPath: null,
    printJson: false,
    failOnForbidden: false,
    minAccuracy: null,
    maxForbiddenViolations: null,
    failOnGate: false,
    dryValidateOnly: false,
    failOnTrend: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--policy":
        args.policyPath = readArgValue(argv, index, "--policy");
        index += 1;
        break;
      case "--cases":
        args.casesPath = readArgValue(argv, index, "--cases");
        index += 1;
        break;
      case "--global-skills-dir":
        args.globalSkillsDir = readArgValue(argv, index, "--global-skills-dir");
        index += 1;
        break;
      case "--project-skills-dir":
        args.projectSkillsDir = readArgValue(argv, index, "--project-skills-dir");
        index += 1;
        break;
      case "--project-toml":
        args.projectTomlPath = readArgValue(argv, index, "--project-toml");
        index += 1;
        break;
      case "--score-threshold":
        args.scoreThreshold = parseFloatNumber(readArgValue(argv, index, "--score-threshold"), "--score-threshold");
        index += 1;
        break;
      case "--min-score-gap":
        args.minScoreGap = parseFloatNumber(readArgValue(argv, index, "--min-score-gap"), "--min-score-gap");
        index += 1;
        break;
      case "--max-descriptors":
        args.maxDescriptors = parseInteger(readArgValue(argv, index, "--max-descriptors"), "--max-descriptors");
        index += 1;
        break;
      case "--descriptor-scan-lines":
        args.descriptorScanLines = parseInteger(
          readArgValue(argv, index, "--descriptor-scan-lines"),
          "--descriptor-scan-lines",
        );
        index += 1;
        break;
      case "--compare-report":
        args.compareReportPath = readArgValue(argv, index, "--compare-report");
        index += 1;
        break;
      case "--max-accuracy-drop":
        args.maxAccuracyDrop = parseFloatNumber(readArgValue(argv, index, "--max-accuracy-drop"), "--max-accuracy-drop");
        index += 1;
        break;
      case "--max-forbidden-increase":
        args.maxForbiddenIncrease = parseInteger(
          readArgValue(argv, index, "--max-forbidden-increase"),
          "--max-forbidden-increase",
        );
        index += 1;
        break;
      case "--output":
        args.outputPath = readArgValue(argv, index, "--output");
        index += 1;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      case "--fail-on-forbidden":
        args.failOnForbidden = true;
        break;
      case "--min-accuracy":
        args.minAccuracy = parseFloatNumber(readArgValue(argv, index, "--min-accuracy"), "--min-accuracy");
        index += 1;
        break;
      case "--max-forbidden-violations":
        args.maxForbiddenViolations = parseInteger(
          readArgValue(argv, index, "--max-forbidden-violations"),
          "--max-forbidden-violations",
        );
        index += 1;
        break;
      case "--fail-on-gate":
        args.failOnGate = true;
        break;
      case "--dry-validate-only":
        args.dryValidateOnly = true;
        break;
      case "--fail-on-trend":
        args.failOnTrend = true;
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  return args;
}

function parseBoolOption(rawValue: unknown, defaultValue: boolean): boolean {
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

function parsePositiveIntOption(rawValue: unknown, defaultValue: number, minValue: number, maxValue: number): number {
  if (typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue > 0) {
    return Math.max(minValue, Math.min(maxValue, rawValue));
  }
  return Math.max(minValue, Math.min(maxValue, defaultValue));
}

function parseFloatOption(rawValue: unknown, defaultValue: number, minValue: number, maxValue: number): number {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return Math.max(minValue, Math.min(maxValue, rawValue));
  }
  return Math.max(minValue, Math.min(maxValue, defaultValue));
}

function stripTomlComments(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const prev = index > 0 ? line[index - 1] : "";
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === "\"" && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
      continue;
    }
    if (char === "#" && !inSingle && !inDouble) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlScalar(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1);
  }
  const lowered = value.toLowerCase();
  if (lowered === "true") {
    return true;
  }
  if (lowered === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }
  return value;
}

function setNestedValue(root: JsonObject, section: string[], key: string, value: unknown): void {
  let target: JsonObject = root;
  for (const segment of section) {
    const existing = target[segment];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      const created: JsonObject = {};
      target[segment] = created;
      target = created;
      continue;
    }
    target = existing as JsonObject;
  }
  target[key] = value;
}

function loadToml(path: string | null): JsonObject {
  if (path === null || !existsSync(path)) {
    return {};
  }
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const payload: JsonObject = {};
  let section: string[] = [];
  const lines = raw.split(/\r?\n/);
  for (const lineRaw of lines) {
    const strippedLine = stripTomlComments(lineRaw).trim();
    if (!strippedLine) {
      continue;
    }
    const sectionMatch = strippedLine.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1]
        .split(".")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      continue;
    }
    const keyValueMatch = strippedLine.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!keyValueMatch) {
      continue;
    }
    const key = keyValueMatch[1].trim();
    const value = parseTomlScalar(keyValueMatch[2]);
    setNestedValue(payload, section, key, value);
  }
  return payload;
}

function resolveSkillRouterConfig(projectToml: JsonObject): SkillRouterConfig {
  const skillsCfg = asObject(projectToml.skills);
  const routerCfg = asObject(skillsCfg.router);
  const runtimeCfg = asObject(skillsCfg.runtime);
  return {
    enabled: parseBoolOption(routerCfg.enabled, true),
    descriptorScanLines: parsePositiveIntOption(
      runtimeCfg.descriptor_scan_lines,
      SKILL_DESCRIPTOR_MAX_SCAN_LINES,
      40,
      500,
    ),
    maxDescriptors: parsePositiveIntOption(runtimeCfg.max_descriptors, SKILL_DESCRIPTOR_MAX_ITEMS, 1, 256),
    scoreThreshold: parseFloatOption(routerCfg.score_threshold, SKILL_ROUTER_SCORE_THRESHOLD, 0.0, 10.0),
    minScoreGap: parseFloatOption(routerCfg.min_score_gap, SKILL_ROUTER_MIN_SCORE_GAP, 0.0, 5.0),
  };
}

function tokenizeSkillText(rawText: string): Set<string> {
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

function normalizeDescriptorItems(rawValue: unknown): string[] {
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

interface ParsedMarkdownDescriptor {
  description: string;
  useWhen: string[];
  dontUseWhen: string[];
  output: string;
  rateLimit: string | null;
  sideEffect: boolean | null;
}

function parseSkillMarkdownDescriptor(markdownText: string, maxScanLines: number): ParsedMarkdownDescriptor {
  const lines = markdownText.split(/\r?\n/);
  const maxLines = Math.min(lines.length, Math.max(1, maxScanLines));
  let description = "";
  const useWhen: string[] = [];
  const dontUseWhen: string[] = [];
  let output = "";
  let rateLimit: string | null = null;
  let sideEffect: boolean | null = null;

  const headingMap: Record<string, "use" | "dont" | "output" | "rate" | "side"> = {
    "use when": "use",
    "when to use": "use",
    "适用场景": "use",
    "何时使用": "use",
    "don't use when": "dont",
    "do not use when": "dont",
    "avoid when": "dont",
    "不适用": "dont",
    "何时不要使用": "dont",
    output: "output",
    产出物: "output",
    输出: "output",
    "rate limit": "rate",
    限流: "rate",
    "side effect": "side",
    副作用: "side",
  };

  let index = 0;
  while (index < maxLines) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }
    const lowered = line.toLowerCase();
    if (!description && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("*") && !line.startsWith("+")) {
      if (!/^\d+\.\s+/.test(line)) {
        description = line;
      }
    }
    const inlineMatch = line.match(
      /^\s*(use when|when to use|适用场景|何时使用|don't use when|do not use when|avoid when|不适用|何时不要使用|output|产出物|输出|rate limit|限流|side effect|副作用)\s*[:：]\s*(.+)\s*$/i,
    );
    if (inlineMatch) {
      const key = headingMap[inlineMatch[1].trim().toLowerCase()];
      const content = inlineMatch[2].trim();
      if (key === "use") {
        useWhen.push(...normalizeDescriptorItems(content));
      } else if (key === "dont") {
        dontUseWhen.push(...normalizeDescriptorItems(content));
      } else if (key === "output") {
        if (!output) {
          output = content.slice(0, SKILL_DESCRIPTOR_MAX_OUTPUT_LEN);
        }
      } else if (key === "rate") {
        rateLimit = content.slice(0, SKILL_DESCRIPTOR_MAX_OUTPUT_LEN);
      } else if (key === "side") {
        const sideLowered = content.toLowerCase();
        sideEffect = ["true", "yes", "on", "1", "enabled"].includes(sideLowered);
      }
      index += 1;
      continue;
    }

    if (line.startsWith("#")) {
      const headingName = line.replace(/^#+/, "").trim().toLowerCase();
      const sectionKey = headingMap[headingName];
      if (!sectionKey) {
        index += 1;
        continue;
      }
      const sectionItems: string[] = [];
      index += 1;
      while (index < maxLines) {
        const child = lines[index].trim();
        if (child.startsWith("#")) {
          break;
        }
        if (child.startsWith("-") || child.startsWith("*") || child.startsWith("+")) {
          const value = child.slice(1).trim();
          if (value) {
            sectionItems.push(...normalizeDescriptorItems(value));
          }
        } else if (/^\d+\.\s+/.test(child)) {
          const value = child.replace(/^\d+\.\s+/, "").trim();
          if (value) {
            sectionItems.push(...normalizeDescriptorItems(value));
          }
        } else if (child && (sectionKey === "output" || sectionKey === "rate")) {
          sectionItems.push(child);
        }
        index += 1;
      }
      if (sectionKey === "use") {
        useWhen.push(...sectionItems);
      } else if (sectionKey === "dont") {
        dontUseWhen.push(...sectionItems);
      } else if (sectionKey === "output" && sectionItems.length > 0 && !output) {
        output = sectionItems[0].slice(0, SKILL_DESCRIPTOR_MAX_OUTPUT_LEN);
      } else if (sectionKey === "rate" && sectionItems.length > 0) {
        rateLimit = sectionItems[0].slice(0, SKILL_DESCRIPTOR_MAX_OUTPUT_LEN);
      } else if (sectionKey === "side" && sectionItems.length > 0) {
        const sideLowered = sectionItems[0].toLowerCase();
        sideEffect = ["true", "yes", "on", "1", "enabled"].includes(sideLowered);
      }
      continue;
    }
    index += 1;
  }

  return {
    description,
    useWhen,
    dontUseWhen,
    output,
    rateLimit,
    sideEffect,
  };
}

function loadSkillMetadata(skillDir: string): JsonObject {
  const metadataFile = pathJoin(skillDir, SKILL_METADATA_FILENAME);
  if (!existsSync(metadataFile)) {
    return {};
  }
  return loadToml(metadataFile);
}

function buildSkillKeywords(input: {
  name: string;
  description: string;
  useWhen: string[];
  dontUseWhen: string[];
  output: string;
}): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  const sources = [
    input.name,
    input.description,
    input.output,
    ...input.useWhen,
    ...input.dontUseWhen,
  ];
  for (const source of sources) {
    for (const token of tokenizeSkillText(source)) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      keywords.push(token);
      if (keywords.length >= 80) {
        return keywords;
      }
    }
  }
  return keywords;
}

function inferSkillSideEffect(input: {
  explicitSideEffect: unknown;
  name: string;
  description: string;
  useWhen: string[];
  output: string;
}): boolean {
  if (typeof input.explicitSideEffect === "boolean") {
    return input.explicitSideEffect;
  }
  const text = [input.name, input.description, input.output, ...input.useWhen].join(" ").toLowerCase();
  return SKILL_SIDE_EFFECT_KEYWORDS.some((keyword) => text.includes(keyword));
}

function collectSkillFiles(root: string): string[] {
  const rootNormalized = normalizePath(root);
  if (!existsSync(rootNormalized)) {
    return [];
  }
  const files: string[] = [];
  const stack: string[] = [rootNormalized];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let names: string[] = [];
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const fullPath = pathJoin(current, name);
      let isDirectory = false;
      try {
        isDirectory = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        stack.push(fullPath);
        continue;
      }
      if (name === "SKILL.md") {
        files.push(fullPath);
      }
    }
  }
  files.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
  return files;
}

function discoverSkillDescriptors(
  globalSkillsDir: string,
  projectSkillsDir: string,
  options: { maxDescriptors: number; descriptorScanLines: number },
): SkillDescriptor[] {
  const descriptors: SkillDescriptor[] = [];
  const scopePairs: Array<{ scope: "global" | "project"; root: string }> = [
    { scope: "global", root: globalSkillsDir },
    { scope: "project", root: projectSkillsDir },
  ];
  for (const pair of scopePairs) {
    const skillFiles = collectSkillFiles(pair.root);
    for (const skillFile of skillFiles) {
      if (descriptors.length >= Math.max(1, options.maxDescriptors)) {
        return descriptors;
      }
      let markdown = "";
      try {
        markdown = readFileSync(skillFile, "utf8");
      } catch {
        continue;
      }
      const parsed = parseSkillMarkdownDescriptor(markdown, options.descriptorScanLines);
      const skillDir = dirname(skillFile);
      const metadata = loadSkillMetadata(skillDir);
      const metadataDescription = metadata.description;
      const description =
        typeof metadataDescription === "string" && metadataDescription.trim().length > 0
          ? metadataDescription.trim()
          : parsed.description.trim();
      const metadataUseWhen = normalizeDescriptorItems(metadata.use_when);
      const useWhen = metadataUseWhen.length > 0 ? metadataUseWhen : parsed.useWhen;
      const metadataDontUseWhen = normalizeDescriptorItems(metadata.dont_use_when);
      const dontUseWhen = metadataDontUseWhen.length > 0 ? metadataDontUseWhen : parsed.dontUseWhen;
      const metadataOutput = metadata.output;
      const output =
        typeof metadataOutput === "string" && metadataOutput.trim().length > 0
          ? metadataOutput.trim().slice(0, SKILL_DESCRIPTOR_MAX_OUTPUT_LEN)
          : parsed.output.trim().slice(0, SKILL_DESCRIPTOR_MAX_OUTPUT_LEN);
      const rawRateLimit = metadata.rate_limit ?? parsed.rateLimit;
      let rateLimit: string | null = null;
      if (typeof rawRateLimit === "string") {
        const stripped = rawRateLimit.trim();
        if (stripped) {
          rateLimit = stripped.slice(0, SKILL_DESCRIPTOR_MAX_OUTPUT_LEN);
        }
      }
      const name = basename(skillDir).trim() || basename(skillFile).replace(/\.md$/i, "");
      const sideEffect = inferSkillSideEffect({
        explicitSideEffect: metadata.side_effect ?? parsed.sideEffect,
        name,
        description,
        useWhen,
        output,
      });
      const keywords = buildSkillKeywords({
        name,
        description,
        useWhen,
        dontUseWhen,
        output,
      });
      const specificity = Number(useWhen.length) + Number(dontUseWhen.length) * 1.5 + (output ? 1 : 0);
      descriptors.push({
        name,
        scope: pair.scope,
        source: `${pair.scope}:${skillFile}`,
        skillFile,
        description,
        useWhen,
        dontUseWhen,
        output,
        sideEffect,
        rateLimit,
        keywords,
        specificity,
      });
    }
  }
  return descriptors;
}

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

function loadReportSummary(path: string): JsonObject {
  const payloadRaw = JSON.parse(readFileSync(path, "utf8"));
  if (typeof payloadRaw !== "object" || payloadRaw === null || Array.isArray(payloadRaw)) {
    throw new Error("compare report must be JSON object");
  }
  const payload = payloadRaw as JsonObject;
  const summaryRaw = payload.summary;
  if (typeof summaryRaw === "object" && summaryRaw !== null && !Array.isArray(summaryRaw)) {
    return summaryRaw as JsonObject;
  }
  if ("accuracy" in payload || "forbidden_violations" in payload) {
    return payload;
  }
  throw new Error("compare report must include summary or top-level accuracy/forbidden_violations");
}

function withSource(value: unknown, source: string): JsonObject {
  return { value, source };
}

function loadPolicyConfig(path: string): SkillRouterPolicyConfig {
  const policy = loadSkillRouterEvalPolicy(path) as unknown as JsonObject;
  const routerOverrides = asObject(policy.router_overrides);
  const gates = asObject(policy.gates);
  const sourcePath = normalizePath(resolvePath(path));
  const cases = typeof policy.cases === "string" ? policy.cases : "";
  const globalSkillsDir = typeof policy.global_skills_dir === "string" ? policy.global_skills_dir : "";
  const projectSkillsDir = typeof policy.project_skills_dir === "string" ? policy.project_skills_dir : "";
  const projectToml = typeof policy.project_toml === "string" ? policy.project_toml : null;
  const scoreThreshold = typeof routerOverrides.score_threshold === "number" ? routerOverrides.score_threshold : null;
  const minScoreGap = typeof routerOverrides.min_score_gap === "number" ? routerOverrides.min_score_gap : null;
  const maxDescriptors =
    typeof routerOverrides.max_descriptors === "number" && Number.isInteger(routerOverrides.max_descriptors)
      ? routerOverrides.max_descriptors
      : null;
  const descriptorScanLines =
    typeof routerOverrides.descriptor_scan_lines === "number" &&
    Number.isInteger(routerOverrides.descriptor_scan_lines)
      ? routerOverrides.descriptor_scan_lines
      : null;
  const minAccuracy = typeof gates.min_accuracy === "number" ? gates.min_accuracy : null;
  const maxForbiddenViolations =
    typeof gates.max_forbidden_violations === "number" && Number.isInteger(gates.max_forbidden_violations)
      ? gates.max_forbidden_violations
      : null;
  const maxAccuracyDrop = typeof gates.max_accuracy_drop === "number" ? gates.max_accuracy_drop : null;
  const maxForbiddenIncrease =
    typeof gates.max_forbidden_increase === "number" && Number.isInteger(gates.max_forbidden_increase)
      ? gates.max_forbidden_increase
      : null;
  return {
    sourcePath,
    cases,
    globalSkillsDir,
    projectSkillsDir,
    projectToml,
    scoreThreshold,
    minScoreGap,
    maxDescriptors,
    descriptorScanLines,
    minAccuracy,
    maxForbiddenViolations,
    maxAccuracyDrop,
    maxForbiddenIncrease,
  };
}

function formatSummaryLine(input: {
  total: number;
  passed: number;
  accuracy: number;
  precision: number;
  recall: number;
  forbiddenViolations: number;
  gatePassed: boolean;
  trendState: string;
}): string {
  return (
    `cases=${input.total} passed=${input.passed} accuracy=${input.accuracy.toFixed(3)} ` +
    `precision=${input.precision.toFixed(3)} recall=${input.recall.toFixed(3)} ` +
    `forbidden_violations=${input.forbiddenViolations} gate=${input.gatePassed ? "pass" : "fail"} trend=${input.trendState}`
  );
}

function writeJsonFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, undefined, 2)}\n`);
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);

  let policy: SkillRouterPolicyConfig | null = null;
  let policyHash: string | null = null;
  let policyCanonical: JsonObject | null = null;
  if (args.policyPath !== null) {
    policy = loadPolicyConfig(args.policyPath);
    const fingerprint = computeSkillRouterPolicyFingerprint(args.policyPath);
    policyHash = fingerprint.policyHash;
    policyCanonical = fingerprint.canonical;
  }

  const cwd = normalizePath(process.cwd());
  const home = typeof process.env.HOME === "string" ? normalizePath(process.env.HOME) : "";
  const defaultGlobalSkillsDir = home ? pathJoin(home, ".grobot/skills") : ".grobot/skills";
  const defaultProjectSkillsDir = pathJoin(cwd, ".grobot/skills");
  const defaultProjectToml = pathJoin(cwd, ".grobot/project.toml");

  const casesPath = args.casesPath ?? policy?.cases ?? null;
  if (!casesPath) {
    throw new Error("Either --cases or --policy must provide cases path");
  }
  const globalSkillsDir = args.globalSkillsDir ?? policy?.globalSkillsDir ?? defaultGlobalSkillsDir;
  const projectSkillsDir = args.projectSkillsDir ?? policy?.projectSkillsDir ?? defaultProjectSkillsDir;
  const projectTomlPath = args.projectTomlPath ?? policy?.projectToml ?? defaultProjectToml;
  const projectToml = loadToml(projectTomlPath);
  const routerConfig = resolveSkillRouterConfig(projectToml);

  let maxDescriptors = routerConfig.maxDescriptors;
  let maxDescriptorsSource = "project_toml_default";
  if (typeof args.maxDescriptors === "number" && args.maxDescriptors > 0) {
    maxDescriptors = args.maxDescriptors;
    maxDescriptorsSource = "cli";
  } else if (policy !== null && typeof policy.maxDescriptors === "number") {
    maxDescriptors = policy.maxDescriptors;
    maxDescriptorsSource = "policy";
  }

  let descriptorScanLines = routerConfig.descriptorScanLines;
  let descriptorScanLinesSource = "project_toml_default";
  if (typeof args.descriptorScanLines === "number" && args.descriptorScanLines > 0) {
    descriptorScanLines = args.descriptorScanLines;
    descriptorScanLinesSource = "cli";
  } else if (policy !== null && typeof policy.descriptorScanLines === "number") {
    descriptorScanLines = policy.descriptorScanLines;
    descriptorScanLinesSource = "policy";
  }

  let scoreThreshold = routerConfig.scoreThreshold;
  let scoreThresholdSource = "project_toml_default";
  if (typeof args.scoreThreshold === "number") {
    scoreThreshold = args.scoreThreshold;
    scoreThresholdSource = "cli";
  } else if (policy !== null && typeof policy.scoreThreshold === "number") {
    scoreThreshold = policy.scoreThreshold;
    scoreThresholdSource = "policy";
  }

  let minScoreGap = routerConfig.minScoreGap;
  let minScoreGapSource = "project_toml_default";
  if (typeof args.minScoreGap === "number") {
    minScoreGap = args.minScoreGap;
    minScoreGapSource = "cli";
  } else if (policy !== null && typeof policy.minScoreGap === "number") {
    minScoreGap = policy.minScoreGap;
    minScoreGapSource = "policy";
  }

  let minAccuracy = args.minAccuracy;
  let minAccuracySource = "unset";
  if (typeof minAccuracy === "number") {
    minAccuracySource = "cli";
  } else if (policy !== null && typeof policy.minAccuracy === "number") {
    minAccuracy = policy.minAccuracy;
    minAccuracySource = "policy";
  }

  let maxForbiddenViolations = args.maxForbiddenViolations;
  let maxForbiddenViolationsSource = "unset";
  if (typeof maxForbiddenViolations === "number") {
    maxForbiddenViolationsSource = "cli";
  } else if (policy !== null && typeof policy.maxForbiddenViolations === "number") {
    maxForbiddenViolations = policy.maxForbiddenViolations;
    maxForbiddenViolationsSource = "policy";
  }
  if (args.failOnForbidden && maxForbiddenViolations === null) {
    maxForbiddenViolations = 0;
    maxForbiddenViolationsSource = "fail_on_forbidden_flag";
  }

  let maxAccuracyDrop = args.maxAccuracyDrop;
  let maxAccuracyDropSource = "unset";
  if (typeof maxAccuracyDrop === "number") {
    maxAccuracyDropSource = "cli";
  } else if (policy !== null && typeof policy.maxAccuracyDrop === "number") {
    maxAccuracyDrop = policy.maxAccuracyDrop;
    maxAccuracyDropSource = "policy";
  }

  let maxForbiddenIncrease = args.maxForbiddenIncrease;
  let maxForbiddenIncreaseSource = "unset";
  if (typeof maxForbiddenIncrease === "number") {
    maxForbiddenIncreaseSource = "cli";
  } else if (policy !== null && typeof policy.maxForbiddenIncrease === "number") {
    maxForbiddenIncrease = policy.maxForbiddenIncrease;
    maxForbiddenIncreaseSource = "policy";
  }
  if (args.failOnTrend) {
    if (maxAccuracyDrop === null) {
      maxAccuracyDrop = 0.0;
      maxAccuracyDropSource = "fail_on_trend_default";
    }
    if (maxForbiddenIncrease === null) {
      maxForbiddenIncrease = 0;
      maxForbiddenIncreaseSource = "fail_on_trend_default";
    }
  }

  const effectiveSources: JsonObject = {
    score_threshold: withSource(scoreThreshold, scoreThresholdSource),
    min_score_gap: withSource(minScoreGap, minScoreGapSource),
    max_descriptors: withSource(maxDescriptors, maxDescriptorsSource),
    descriptor_scan_lines: withSource(descriptorScanLines, descriptorScanLinesSource),
    min_accuracy: withSource(minAccuracy, minAccuracySource),
    max_forbidden_violations: withSource(maxForbiddenViolations, maxForbiddenViolationsSource),
  };
  const trendConfig: JsonObject = {
    compare_report: args.compareReportPath,
    max_accuracy_drop: maxAccuracyDrop,
    max_forbidden_increase: maxForbiddenIncrease,
  };
  const trendSources: JsonObject = {
    max_accuracy_drop: withSource(maxAccuracyDrop, maxAccuracyDropSource),
    max_forbidden_increase: withSource(maxForbiddenIncrease, maxForbiddenIncreaseSource),
  };

  if (args.dryValidateOnly) {
    const payload: JsonObject = {
      status: "ok",
      effective: {
        cases: casesPath,
        global_skills_dir: globalSkillsDir,
        project_skills_dir: projectSkillsDir,
        project_toml: projectTomlPath,
        score_threshold: scoreThreshold,
        min_score_gap: minScoreGap,
        max_descriptors: maxDescriptors,
        descriptor_scan_lines: descriptorScanLines,
        min_accuracy: minAccuracy,
        max_forbidden_violations: maxForbiddenViolations,
      },
      effective_sources: effectiveSources,
      trend_config: trendConfig,
      trend_sources: trendSources,
      policy: {
        path: policy?.sourcePath ?? null,
        hash: policyHash,
        canonical: policyCanonical,
      },
    };
    if (args.printJson) {
      printJson(payload);
    } else {
      process.stdout.write(
        `validated policy=${policy?.sourcePath ?? "none"} cases=${casesPath} global_skills=${globalSkillsDir} project_skills=${projectSkillsDir}\n`,
      );
    }
    return 0;
  }

  const descriptors = routerConfig.enabled
    ? discoverSkillDescriptors(globalSkillsDir, projectSkillsDir, {
        maxDescriptors,
        descriptorScanLines,
      })
    : [];
  const cases = loadSkillRouterCases(casesPath);
  const report = evaluateSkillRouterCases({
    cases,
    descriptors,
    scoreThreshold,
    minScoreGap,
  });
  const summaryRaw = report.summary;
  const summary =
    typeof summaryRaw === "object" && summaryRaw !== null && !Array.isArray(summaryRaw)
      ? (summaryRaw as JsonObject)
      : {};
  const gate = evaluateSkillRouterGate({
    summary,
    minAccuracy,
    maxForbiddenViolations,
  });

  let trend: JsonObject | null = null;
  if (args.compareReportPath !== null) {
    const baselineSummary = loadReportSummary(args.compareReportPath);
    trend = evaluateSkillRouterTrend({
      currentSummary: summary,
      baselineSummary,
      maxAccuracyDrop,
      maxForbiddenIncrease,
    });
  }

  report.gate = gate;
  report.effective = {
    cases: casesPath,
    global_skills_dir: globalSkillsDir,
    project_skills_dir: projectSkillsDir,
    project_toml: projectTomlPath,
    score_threshold: scoreThreshold,
    min_score_gap: minScoreGap,
    max_descriptors: maxDescriptors,
    descriptor_scan_lines: descriptorScanLines,
    min_accuracy: minAccuracy,
    max_forbidden_violations: maxForbiddenViolations,
  };
  report.effective_sources = effectiveSources;
  report.trend_config = trendConfig;
  report.trend_sources = trendSources;
  report.trend = trend;
  report.policy = {
    path: policy?.sourcePath ?? null,
    hash: policyHash,
    canonical: policyCanonical,
  };

  const trendState = trend === null ? "n/a" : (trend.passed === true ? "pass" : "fail");
  const totalCases = typeof summary.total_cases === "number" ? Math.trunc(summary.total_cases) : 0;
  const passedCases = typeof summary.passed_cases === "number" ? Math.trunc(summary.passed_cases) : 0;
  const accuracy = typeof summary.accuracy === "number" ? summary.accuracy : 0;
  const precision = typeof summary.precision === "number" ? summary.precision : 0;
  const recall = typeof summary.recall === "number" ? summary.recall : 0;
  const forbiddenViolations =
    typeof summary.forbidden_violations === "number" ? Math.trunc(summary.forbidden_violations) : 0;
  const gatePassed = gate.passed === true;
  process.stdout.write(
    `${formatSummaryLine({
      total: totalCases,
      passed: passedCases,
      accuracy,
      precision,
      recall,
      forbiddenViolations,
      gatePassed,
      trendState,
    })}\n`,
  );

  if (args.printJson) {
    printJson(report);
  }
  if (args.outputPath !== null) {
    writeJsonFile(args.outputPath, report);
  }

  if (args.failOnForbidden && forbiddenViolations > 0) {
    return 2;
  }
  if (typeof args.minAccuracy === "number" && accuracy < args.minAccuracy) {
    return 3;
  }
  if (typeof args.maxForbiddenViolations === "number" && forbiddenViolations > args.maxForbiddenViolations) {
    return 5;
  }
  if (args.failOnTrend) {
    if (trend === null) {
      throw new Error("--fail-on-trend requires --compare-report");
    }
    if (trend.passed !== true) {
      return 6;
    }
  }
  if (args.failOnGate && gatePassed !== true) {
    return 4;
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("skill-router-eval");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`skill-router-eval fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
