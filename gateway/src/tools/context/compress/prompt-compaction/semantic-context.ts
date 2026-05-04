import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type PromptSemanticGenerationContext } from "./contract";

const SNAPSHOT_GENERATIVE_DEFAULT_TIMEOUT_MS = 1_200;
const SNAPSHOT_GENERATIVE_MIN_TIMEOUT_MS = 300;
const SNAPSHOT_GENERATIVE_MAX_TIMEOUT_MS = 8_000;
const SNAPSHOT_GENERATIVE_DEFAULT_MAX_EVIDENCE = 6;
const SNAPSHOT_GENERATIVE_MAX_EVIDENCE = 16;

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function normalizeWarning(raw: string): string | undefined {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  if (compact.length <= 220) {
    return compact;
  }
  return `${compact.slice(0, 219).trimEnd()}...`;
}

function toStringArray(raw: unknown, maxRows: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxRows) {
      break;
    }
  }
  return output;
}

function resolveContextWeaverBridgeScriptPath(workDir: string): string | undefined {
  const bridgeRelativePath = ["adapters", "contextweaver", "bridge", "cli.mjs"];
  let cursor = resolve(workDir);
  while (true) {
    const candidate = resolve(cursor, ...bridgeRelativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return undefined;
}

function stripAnsiSequences(raw: string): string {
  return raw.replace(/\u001b\[[0-9;]*m/g, "");
}

function readFirstJsonObjectLine(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((item) => stripAnsiSequences(item).trim())
    .filter((item) => item.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      const firstBrace = line.indexOf("{");
      const lastBrace = line.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = line.slice(firstBrace, lastBrace + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // Ignore and continue scanning lines.
        }
      }
    }
  }
  return undefined;
}

function collectPathHintsFromEvidence(raw: unknown, maxRows: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!path) {
      continue;
    }
    const key = path.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(path);
    if (output.length >= maxRows) {
      break;
    }
  }
  return output;
}

export function loadPromptSemanticGenerationContext(args: {
  workDir?: string;
  prompt: string;
  timeoutMs?: number;
  maxEvidence?: number;
}): PromptSemanticGenerationContext {
  const workDir = typeof args.workDir === "string" ? args.workDir.trim() : "";
  if (!workDir) {
    return {
      available: false,
      warning: "semantic generation skipped: missing work dir",
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const bridgeScriptPath = resolveContextWeaverBridgeScriptPath(workDir);
  if (!bridgeScriptPath) {
    return {
      available: false,
      warning: "semantic generation skipped: contextweaver bridge not found",
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const timeoutMs = clampInteger(
    typeof args.timeoutMs === "number" ? args.timeoutMs : SNAPSHOT_GENERATIVE_DEFAULT_TIMEOUT_MS,
    SNAPSHOT_GENERATIVE_DEFAULT_TIMEOUT_MS,
    SNAPSHOT_GENERATIVE_MIN_TIMEOUT_MS,
    SNAPSHOT_GENERATIVE_MAX_TIMEOUT_MS,
  );
  const maxEvidence = clampInteger(
    typeof args.maxEvidence === "number" ? args.maxEvidence : SNAPSHOT_GENERATIVE_DEFAULT_MAX_EVIDENCE,
    SNAPSHOT_GENERATIVE_DEFAULT_MAX_EVIDENCE,
    1,
    SNAPSHOT_GENERATIVE_MAX_EVIDENCE,
  );
  const payload = JSON.stringify({
    prompt: args.prompt.trim(),
    maxEvidence,
    sourceConcurrency: 1,
    refresh: "auto",
    sourceRoots: [
      {
        source: "code",
        rootPath: workDir,
      },
    ],
  });
  const nodeBinary = typeof process.argv[0] === "string" && process.argv[0].trim().length > 0
    ? process.argv[0].trim()
    : "node";
  const spawnOptions = {
    cwd: workDir,
    encoding: "utf8",
    timeout: timeoutMs + 500,
    maxBuffer: 1_000_000,
    env: process.env,
  } as unknown as Parameters<typeof spawnSync>[2];
  const run = spawnSync(nodeBinary, [
    bridgeScriptPath,
    "prompt-enhancer",
    "--payload",
    payload,
    "--timeout-ms",
    String(timeoutMs),
  ], spawnOptions);
  if (run.error || run.status !== 0) {
    const runErrorMessage = run.error instanceof Error ? run.error.message : "";
    return {
      available: false,
      warning: normalizeWarning(String((run.stderr ?? runErrorMessage) || "semantic generation bridge failed")),
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const parsed = readFirstJsonObjectLine(String(run.stdout ?? ""));
  if (!parsed) {
    return {
      available: false,
      warning: "semantic generation skipped: bridge returned empty JSON",
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const technicalTerms = toStringArray(parsed.technical_terms, 8);
  const topPaths = toStringArray(parsed.top_paths, 8);
  const evidencePaths = collectPathHintsFromEvidence(parsed.evidence, 8);
  const warnings = toStringArray(parsed.warnings, 2);
  return {
    available: true,
    warning: warnings[0],
    technicalTerms,
    topPaths,
    evidencePaths,
  };
}
