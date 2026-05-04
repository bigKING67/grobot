import { type PromptSemanticGenerationContext } from "./contract";

export const SNAPSHOT_SECTION_SEMANTIC_MAX_CHARS = 160;
export const SNAPSHOT_GENERATIVE_SUMMARY_MAX_CHARS = 128;

export function compactSemanticLine(raw: string, maxChars: number): string {
  const normalized = raw.replace(/\s+/g, " ").trim().replace(/^[-*]\s+/, "");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const headLength = Math.max(40, Math.floor(maxChars * 0.72));
  const tailLength = Math.max(24, maxChars - headLength - 5);
  const head = normalized.slice(0, headLength).trimEnd();
  const tail = normalized.slice(Math.max(0, normalized.length - tailLength)).trimStart();
  return `${head} ... ${tail}`;
}

export function collectSemanticSignalTokens(lines: readonly string[]): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g,
    /\b[a-f0-9]{7,40}\b/gi,
    /\b(?:PASS|FAIL|TODO|WARN|ERROR|SKIP)\b/g,
    /[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/g,
  ];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    for (const pattern of patterns) {
      const matched = line.match(pattern) ?? [];
      for (const candidate of matched) {
        const token = candidate.trim();
        if (!token) {
          continue;
        }
        const key = token.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        tokens.push(token);
        if (tokens.length >= 8) {
          return tokens;
        }
      }
    }
  }
  return tokens;
}

function tokenizeText(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function collectPathHintsFromLines(lines: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const pattern = /[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g;
  for (const row of lines) {
    const matches = row.match(pattern) ?? [];
    for (const matched of matches) {
      const value = matched.trim();
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(value);
      if (output.length >= 8) {
        return output;
      }
    }
  }
  return output;
}

function collectIdentifierHints(lines: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const pattern = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (const row of lines) {
    const matches = row.match(pattern) ?? [];
    for (const matched of matches) {
      const value = matched.trim();
      if (value.length < 3) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(value);
      if (output.length >= 12) {
        return output;
      }
    }
  }
  return output;
}

function scoreSectionLineForSynthesis(args: {
  row: string;
  terms: ReadonlySet<string>;
  paths: ReadonlySet<string>;
}): number {
  const normalized = args.row.replace(/^[-*]\s+/, "").trim();
  if (!normalized) {
    return 0;
  }
  const tokens = new Set(tokenizeText(normalized));
  let score = 1;
  for (const token of tokens) {
    if (args.terms.has(token)) {
      score += 2;
    }
  }
  for (const path of args.paths) {
    if (normalized.toLowerCase().includes(path)) {
      score += 3;
    }
  }
  if (/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/.test(normalized)) {
    score += 2;
  }
  if (/\b(pass|fail|warn|error|todo)\b/i.test(normalized)) {
    score += 1;
  }
  return score;
}

export function synthesizeSnapshotSectionLines(args: {
  sectionKey: string;
  lines: readonly string[];
  generationContext: PromptSemanticGenerationContext;
}): {
  lines: string[];
  changed: boolean;
} {
  if (args.lines.length <= 1) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const header = args.lines[0] ?? "";
  const rawContentRows = args.lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rawContentRows.length <= 1) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  if (
    rawContentRows.some((line) => line.includes("[generated]"))
    || rawContentRows.some((line) => line.includes("[synth]"))
  ) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const topPathHints = [
    ...args.generationContext.topPaths,
    ...args.generationContext.evidencePaths,
    ...collectPathHintsFromLines(rawContentRows),
  ].slice(0, 8);
  const topPathSet = new Set(topPathHints.map((item) => item.toLowerCase()));
  const termHints = [
    ...args.generationContext.technicalTerms,
    ...collectIdentifierHints(rawContentRows),
  ].slice(0, 12);
  const termSet = new Set(termHints.map((item) => item.toLowerCase()));
  const scoredRows = rawContentRows
    .map((row) => ({
      row,
      score: scoreSectionLineForSynthesis({
        row,
        terms: termSet,
        paths: topPathSet,
      }),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
  if (scoredRows.length === 0) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const summaryRows = scoredRows.map((item) =>
    `- [synth] ${compactSemanticLine(item.row, SNAPSHOT_GENERATIVE_SUMMARY_MAX_CHARS)}`
  );
  const sectionHint = args.sectionKey.replace(/\s+/g, "_");
  const pathFocus = topPathHints.slice(0, 3);
  const termFocus = termHints.slice(0, 4);
  const focusParts: string[] = [];
  focusParts.push(`section=${sectionHint}`);
  if (pathFocus.length > 0) {
    focusParts.push(`paths=${pathFocus.join(" | ")}`);
  }
  if (termFocus.length > 0) {
    focusParts.push(`terms=${termFocus.join(", ")}`);
  }
  if (focusParts.length > 0) {
    summaryRows.push(`- [generated] ${focusParts.join("; ")}`);
  }
  const rebuilt = [header, ...summaryRows];
  const changed =
    rebuilt.join("\n").length < args.lines.join("\n").length
    || rebuilt.length < args.lines.length;
  return {
    lines: changed ? rebuilt : [...args.lines],
    changed,
  };
}
