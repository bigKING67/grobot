import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  SKILL_DESCRIPTOR_MAX_ITEMS,
  SKILL_DESCRIPTOR_MAX_OUTPUT_LEN,
  SKILL_DESCRIPTOR_MAX_SCAN_LINES,
  SKILL_METADATA_FILENAME,
  SKILL_ROUTER_MIN_SCORE_GAP,
  SKILL_ROUTER_SCORE_THRESHOLD,
  SKILL_SIDE_EFFECT_KEYWORDS,
  asObject,
  basename,
  dirname,
  normalizeDescriptorItems,
  normalizePath,
  parseBoolOption,
  parseFloatOption,
  parsePositiveIntOption,
  pathJoin,
  tokenizeSkillText,
  type JsonObject,
  type SkillDescriptor,
  type SkillRouterConfig,
} from "./shared";

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

export function loadToml(path: string | null): JsonObject {
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

export function resolveSkillRouterConfig(projectToml: JsonObject): SkillRouterConfig {
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

export function discoverSkillDescriptors(
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
