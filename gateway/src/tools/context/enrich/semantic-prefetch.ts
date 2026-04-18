import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface SemanticPrefetchOptions {
  enabled: boolean;
  workDir: string;
  userText: string;
  timeoutMs: number;
  maxEvidence: number;
}

interface SemanticPrefetchResult {
  block?: string;
  evidenceCount: number;
  warning?: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 2_500;
const MIN_TIMEOUT_MS = 300;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_EVIDENCE = 6;
const MIN_MAX_EVIDENCE = 1;
const MAX_MAX_EVIDENCE = 24;
const MAX_WARN_CHARS = 240;
const MAX_BLOCK_LINES = 12;

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
  const compact = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) {
    return undefined;
  }
  if (compact.length <= MAX_WARN_CHARS) {
    return compact;
  }
  return `${compact.slice(0, MAX_WARN_CHARS - 1).trimEnd()}…`;
}

function stripAnsiSequences(raw: string): string {
  return raw.replace(/\u001b\[[0-9;]*m/g, "");
}

function toEvidenceLine(item: Record<string, unknown>): string | undefined {
  const path = typeof item.path === "string" ? item.path.trim() : "";
  if (!path) {
    return undefined;
  }
  const source = typeof item.source === "string" && item.source.trim()
    ? item.source.trim()
    : "code";
  const score = typeof item.score === "number" && Number.isFinite(item.score)
    ? item.score
    : undefined;
  const lineStart = typeof item.start_line === "number" && Number.isFinite(item.start_line)
    ? Math.max(1, Math.floor(item.start_line))
    : undefined;
  const lineEnd = typeof item.end_line === "number" && Number.isFinite(item.end_line)
    ? Math.max(1, Math.floor(item.end_line))
    : undefined;
  const lineRange = lineStart && lineEnd
    ? `:${String(lineStart)}-${String(lineEnd)}`
    : "";
  const scoreText = typeof score === "number"
    ? ` score=${score.toFixed(3)}`
    : "";
  return `- [${source}] ${path}${lineRange}${scoreText}`;
}

function parseBridgeResponse(stdout: string): {
  block?: string;
  evidenceCount: number;
  warning?: string;
} {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => stripAnsiSequences(line).trim())
    .filter((line) => line.length > 0);
  let parsedLine: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    if (line.includes("{") && line.includes("}")) {
      parsedLine = line;
      break;
    }
  }
  if (!parsedLine) {
    return {
      evidenceCount: 0,
      warning: "bridge returned empty stdout",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(parsedLine);
  } catch (error) {
    const firstBrace = parsedLine.indexOf("{");
    const lastBrace = parsedLine.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(parsedLine.slice(firstBrace, lastBrace + 1));
      } catch (innerError) {
        return {
          evidenceCount: 0,
          warning: normalizeWarning(`bridge returned invalid JSON: ${String(innerError)}`),
        };
      }
    } else {
      return {
        evidenceCount: 0,
        warning: normalizeWarning(`bridge returned invalid JSON: ${String(error)}`),
      };
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      evidenceCount: 0,
      warning: "bridge response is not an object",
    };
  }
  const payload = parsed as Record<string, unknown>;
  const evidenceRaw = Array.isArray(payload.evidence) ? payload.evidence : [];
  const evidenceLines = evidenceRaw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => toEvidenceLine(item))
    .filter((item): item is string => typeof item === "string")
    .slice(0, MAX_BLOCK_LINES);
  const technicalTerms = Array.isArray(payload.technical_terms)
    ? payload.technical_terms
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 16)
    : [];
  const topPaths = Array.isArray(payload.top_paths)
    ? payload.top_paths
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 8)
    : [];
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 2)
    : [];
  if (evidenceLines.length === 0 && topPaths.length === 0) {
    return {
      evidenceCount: 0,
      warning: warnings.length > 0 ? normalizeWarning(warnings.join("; ")) : undefined,
    };
  }
  const blockLines: string[] = ["[Proactive Semantic Evidence]"];
  if (technicalTerms.length > 0) {
    blockLines.push(`technical_terms=${technicalTerms.join(", ")}`);
  }
  if (topPaths.length > 0) {
    blockLines.push(`top_paths=${topPaths.join(" | ")}`);
  }
  blockLines.push(...evidenceLines);
  return {
    block: blockLines.join("\n"),
    evidenceCount: evidenceLines.length,
    warning: warnings.length > 0 ? normalizeWarning(warnings.join("; ")) : undefined,
  };
}

function resolveBridgeScriptPath(workDir: string): string | undefined {
  const bridgeRelativePath = ["adapters", "contextweaver", "bridge", "cli.mjs"];
  const probes = [resolve(process.cwd()), resolve(workDir)];
  for (const base of probes) {
    let cursor = base;
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
  }
  return undefined;
}

export function buildSemanticPrefetchBlock(options: SemanticPrefetchOptions): SemanticPrefetchResult {
  const startedAt = Date.now();
  if (!options.enabled) {
    return {
      evidenceCount: 0,
      durationMs: Date.now() - startedAt,
    };
  }
  const userText = options.userText.trim();
  if (userText.length < 6) {
    return {
      evidenceCount: 0,
      durationMs: Date.now() - startedAt,
    };
  }
  const workDir = resolve(options.workDir || process.cwd());
  const timeoutMs = clampInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const maxEvidence = clampInteger(
    options.maxEvidence,
    DEFAULT_MAX_EVIDENCE,
    MIN_MAX_EVIDENCE,
    MAX_MAX_EVIDENCE,
  );
  const payload = JSON.stringify({
    prompt: userText,
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
  const bridgeScriptPath = resolveBridgeScriptPath(workDir);
  if (!bridgeScriptPath) {
    return {
      evidenceCount: 0,
      warning: "semantic prefetch bridge not found",
      durationMs: Date.now() - startedAt,
    };
  }
  const nodeBinary = typeof process.argv[0] === "string" && process.argv[0].trim()
    ? process.argv[0].trim()
    : "node";
  const spawnOptions = {
    encoding: "utf8" as const,
    cwd: workDir,
    timeout: timeoutMs + 500,
    maxBuffer: 1_000_000,
    env: process.env,
  } as unknown as {
    input?: string;
    encoding?: "utf8";
    timeout?: number;
    maxBuffer?: number;
  };
  const run = spawnSync(nodeBinary, [
    bridgeScriptPath,
    "prompt-enhancer",
    "--payload",
    payload,
    "--timeout-ms",
    String(timeoutMs),
  ], spawnOptions);
  if (run.error || run.status !== 0) {
    const stderr = String(run.stderr ?? "").trim();
    const errorMessage = run.error instanceof Error
      ? run.error.message
      : "";
    return {
      evidenceCount: 0,
      warning: normalizeWarning(stderr || errorMessage || "semantic prefetch failed"),
      durationMs: Date.now() - startedAt,
    };
  }
  const parsed = parseBridgeResponse(String(run.stdout ?? ""));
  return {
    block: parsed.block,
    evidenceCount: parsed.evidenceCount,
    warning: parsed.warning,
    durationMs: Date.now() - startedAt,
  };
}
