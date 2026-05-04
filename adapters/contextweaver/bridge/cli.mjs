#!/usr/bin/env node
import { existsSync } from "node:fs";
import { parseArgs } from "./cli-args.mjs";
import {
  DEFAULT_SOURCE_CONCURRENCY,
  MAX_EVIDENCE_TEXT_CHARS,
  MAX_SOURCE_CONCURRENCY,
  MAX_WARNING_CHARS,
  createError,
  isRecord,
  mapWithConcurrency,
  normalizeRefreshMode,
  normalizeToolErrorClass,
  pickDominantErrorClass,
  shouldDegradePromptEnhancerFailure,
  toPositiveInt,
  toStringArray,
  truncateText,
} from "./common.mjs";
import {
  classifyContextWeaverFailure,
  resolveContextWeaverRuntime,
  runContextWeaverLocalPromptContext,
  runContextWeaverLocalSearch,
  runContextWeaverLocalWithRefresh,
  runContextWeaverWithRefresh,
} from "./contextweaver-runtime.mjs";
import {
  buildContextWeaverEnv,
} from "./retrieval-config.mjs";
import { normalizeContextWeaverPath, normalizeSemanticScore, rankSemanticMatches } from "./semantic-results.mjs";
import { resolveSourceRoots } from "./source-roots.mjs";
function extractTechnicalTerms(text, maxItems = 24) {
  const terms = [];
  const seen = new Set();
  const push = (term) => {
    const normalized = String(term ?? "").trim();
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    terms.push(normalized);
  };
  for (const token of String(text ?? "").match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) {
    push(token);
    if (terms.length >= maxItems) {
      break;
    }
  }
  return terms;
}

async function runSemanticSearch(payload, timeoutMs) {
  const query = String(payload.query ?? "").trim();
  if (!query) {
    throw createError("semantic_invalid_request", "semantic-search requires query");
  }
  const technicalTerms = toStringArray(payload.technicalTerms, 32);
  const perSourceLimit = toPositiveInt(payload.perSourceLimit, 6, 50);
  const maxSegments = toPositiveInt(payload.maxSegments, 24, 200);
  const sourceConcurrency = toPositiveInt(payload.sourceConcurrency, DEFAULT_SOURCE_CONCURRENCY, MAX_SOURCE_CONCURRENCY);
  const refreshMode = normalizeRefreshMode(payload.refresh, "auto");
  const sourceRoots = resolveSourceRoots(payload);
  if (sourceRoots.length === 0) {
    throw createError("semantic_no_source_available", "no source roots provided");
  }

  const env = buildContextWeaverEnv(sourceRoots);
  const runtime = await resolveContextWeaverRuntime(env);
  const sourceStats = [];
  const matches = [];
  const warnings = [];
  if (runtime.warning) {
    warnings.push(runtime.warning);
  }
  const errorClasses = [];
  const sourceResults = await mapWithConcurrency(sourceRoots, sourceConcurrency, async (sourceRoot) => {
    const { source, rootPath } = sourceRoot;
    if (!existsSync(rootPath)) {
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "skipped",
          count: 0,
        },
        matches: [],
        warnings: [`skip ${source}: root not found (${rootPath})`],
        errorClass: "",
      };
    }
    try {
      const args = [
        "search",
        "--repo-path",
        rootPath,
        "--information-request",
        query,
        "--format",
        "json",
      ];
      if (technicalTerms.length > 0) {
        args.push("--technical-terms", technicalTerms.join(","));
      }
      const result = runtime.mode === "local"
        ? await runContextWeaverLocalWithRefresh({
          localApi: runtime.localApi,
          rootPath,
          refreshMode,
          errorClass: "semantic_search_failed",
          runOperation: () => runContextWeaverLocalSearch(runtime.localApi, {
            rootPath,
            query,
            technicalTerms,
            errorClass: "semantic_search_failed",
          }),
        })
        : await runContextWeaverWithRefresh({
          execRef: runtime.execRef,
          args,
          rootPath,
          refreshMode,
          timeoutMs,
          env,
          cwd: rootPath,
          errorClass: "semantic_search_failed",
        });
      const files = Array.isArray(result.files) ? result.files : [];
      const flattened = [];
      for (const file of files) {
        if (!isRecord(file)) {
          continue;
        }
        const filePath = String(file.path ?? "").trim();
        const normalizedFilePath = normalizeContextWeaverPath(rootPath, filePath);
        const segments = Array.isArray(file.segments) ? file.segments : [];
        for (const segment of segments) {
          if (!isRecord(segment)) {
            continue;
          }
          flattened.push({
            source,
            root_path: rootPath,
            path: normalizedFilePath,
            start_line: toPositiveInt(segment.startLine, 1, 10 ** 8),
            end_line: toPositiveInt(segment.endLine, 1, 10 ** 8),
            score: normalizeSemanticScore(segment.score),
            breadcrumb: String(segment.breadcrumb ?? ""),
            text: truncateText(String(segment.text ?? ""), MAX_EVIDENCE_TEXT_CHARS),
          });
        }
      }
      flattened.sort((left, right) => right.score - left.score);
      const selected = flattened.slice(0, perSourceLimit);
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "ok",
          count: selected.length,
          semantic_count: selected.length,
        },
        matches: selected,
        warnings: [],
        errorClass: "",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = normalizeToolErrorClass(error?.errorClass, "semantic_search_failed");
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "error",
          error_class: errorClass,
          count: 0,
        },
        matches: [],
        warnings: [`source ${source} failed: ${truncateText(message, MAX_WARNING_CHARS)}`],
        errorClass,
      };
    }
  });

  for (const row of sourceResults) {
    sourceStats.push(row.sourceStat);
    matches.push(...row.matches);
    warnings.push(...row.warnings);
    if (row.errorClass) {
      errorClasses.push(row.errorClass);
    }
  }

  const okCount = sourceStats.filter((row) => row.status === "ok").length;
  if (okCount === 0) {
    const errorClass = pickDominantErrorClass(errorClasses, "semantic_search_failed");
    throw createError(
      errorClass,
      warnings.join("; ") || "semantic search failed for all sources",
      {
        source_count: sourceStats.length,
        error_classes: Array.from(new Set(errorClasses)).slice(0, 8),
        source_stats: sourceStats.slice(0, 8),
        warnings: warnings.slice(0, 8),
      },
    );
  }

  const selectedMatches = rankSemanticMatches(matches, maxSegments);
  return {
    tool: "semantic_search",
    query,
    count: selectedMatches.length,
    source_stats: sourceStats,
    matches: selectedMatches,
    warnings,
    duration_ms: 0,
  };
}

async function runPromptEnhancer(payload, timeoutMs) {
  const prompt = String(payload.prompt ?? "").trim();
  if (!prompt) {
    throw createError("semantic_invalid_request", "prompt-enhancer requires prompt");
  }
  const explicitPaths = toStringArray(payload.explicitPaths, 32);
  const explicitSymbols = toStringArray(payload.explicitSymbols, 32);
  const maxEvidence = toPositiveInt(payload.maxEvidence, 16, 200);
  const sourceConcurrency = toPositiveInt(payload.sourceConcurrency, DEFAULT_SOURCE_CONCURRENCY, MAX_SOURCE_CONCURRENCY);
  const refreshMode = normalizeRefreshMode(payload.refresh, "auto");
  const sourceRoots = resolveSourceRoots(payload);
  if (sourceRoots.length === 0) {
    throw createError("semantic_no_source_available", "no source roots provided");
  }

  const env = buildContextWeaverEnv(sourceRoots);
  const runtime = await resolveContextWeaverRuntime(env);
  const technicalTerms = new Set();
  const topPaths = [];
  const evidence = [];
  const sourceStats = [];
  const warnings = [];
  if (runtime.warning) {
    warnings.push(runtime.warning);
  }
  const errorClasses = [];
  let language = "en";
  const sourceResults = await mapWithConcurrency(sourceRoots, sourceConcurrency, async (sourceRoot) => {
    const { source, rootPath } = sourceRoot;
    if (!existsSync(rootPath)) {
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "skipped",
        },
        evidence: [],
        topPaths: [],
        technicalTerms: [],
        warnings: [`skip ${source}: root not found (${rootPath})`],
        errorClass: "",
        language: "",
      };
    }
    try {
      const args = [
        "prompt-context",
        prompt,
        "--repo-path",
        rootPath,
        "--format",
        "json",
      ];
      if (explicitPaths.length > 0) {
        args.push("--paths", explicitPaths.join(","));
      }
      if (explicitSymbols.length > 0) {
        args.push("--symbols", explicitSymbols.join(","));
      }
      const result = runtime.mode === "local"
        ? await runContextWeaverLocalWithRefresh({
          localApi: runtime.localApi,
          rootPath,
          refreshMode,
          errorClass: "prompt_enhancer_failed",
          runOperation: () => runContextWeaverLocalPromptContext(runtime.localApi, {
            prompt,
            rootPath,
            explicitPaths,
            explicitSymbols,
            errorClass: "prompt_enhancer_failed",
          }),
        })
        : await runContextWeaverWithRefresh({
          execRef: runtime.execRef,
          args,
          rootPath,
          refreshMode,
          timeoutMs,
          env,
          cwd: rootPath,
          errorClass: "prompt_enhancer_failed",
        });

      const languageHint = typeof result.language === "string" && result.language.trim()
        ? result.language.trim()
        : "";
      const termRows = toStringArray(result.technicalTerms, 32);
      const retrieval = isRecord(result.retrieval) ? result.retrieval : {};
      const pathRows = toStringArray(retrieval.topPaths, 64)
        .map((rawPath) => normalizeContextWeaverPath(rootPath, rawPath))
        .map((normalizedPath) => `[${source}] ${normalizedPath}`);
      const evidenceRows = [];
      const rawEvidence = Array.isArray(retrieval.evidence) ? retrieval.evidence : [];
      for (const row of rawEvidence) {
        if (!isRecord(row)) {
          continue;
        }
        const normalizedPath = normalizeContextWeaverPath(rootPath, String(row.path ?? ""));
        evidenceRows.push({
          source,
          root_path: rootPath,
          path: normalizedPath,
          start_line: toPositiveInt(row.startLine, 1, 10 ** 8),
          end_line: toPositiveInt(row.endLine, 1, 10 ** 8),
          score: normalizeSemanticScore(row.score),
          breadcrumb: String(row.breadcrumb ?? ""),
          text: truncateText(String(row.text ?? ""), MAX_EVIDENCE_TEXT_CHARS),
        });
      }
      const retrievalStatus = String(retrieval.status ?? "ok").trim() || "ok";
      const normalizedRetrievalStatus = retrievalStatus.toLowerCase();
      const retrievalWarnings = [];
      const retrievalError = typeof retrieval.error === "string" ? retrieval.error.trim() : "";
      if (retrievalError || normalizedRetrievalStatus !== "ok") {
        const rawFailure = retrievalError || `contextweaver retrieval status=${retrievalStatus}`;
        const classified = classifyContextWeaverFailure(rawFailure, "prompt_enhancer_failed");
        retrievalWarnings.push(`source ${source} retrieval failed: ${truncateText(classified.message, MAX_WARNING_CHARS)}`);
        return {
          sourceStat: {
            source,
            root_path: rootPath,
            status: "error",
            error_class: classified.errorClass,
          },
          evidence: [],
          topPaths: [],
          technicalTerms: [],
          warnings: retrievalWarnings,
          errorClass: classified.errorClass,
          language: languageHint,
        };
      }
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "ok",
        },
        evidence: evidenceRows,
        topPaths: pathRows,
        technicalTerms: termRows,
        warnings: retrievalWarnings,
        errorClass: "",
        language: languageHint,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = normalizeToolErrorClass(error?.errorClass, "prompt_enhancer_failed");
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "error",
          error_class: errorClass,
        },
        evidence: [],
        topPaths: [],
        technicalTerms: [],
        warnings: [`source ${source} failed: ${truncateText(message, MAX_WARNING_CHARS)}`],
        errorClass,
        language: "",
      };
    }
  });

  for (const row of sourceResults) {
    sourceStats.push(row.sourceStat);
    evidence.push(...row.evidence);
    topPaths.push(...row.topPaths);
    warnings.push(...row.warnings);
    for (const term of row.technicalTerms) {
      technicalTerms.add(term);
    }
    if (row.language && row.language.trim()) {
      language = row.language;
    }
    if (row.errorClass) {
      errorClasses.push(row.errorClass);
    }
  }

  const okCount = sourceStats.filter((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    return status === "ok";
  }).length;
  if (okCount === 0) {
    const errorClass = pickDominantErrorClass(errorClasses, "prompt_enhancer_failed");
    if (shouldDegradePromptEnhancerFailure(errorClass)) {
      const degradedWarning = `prompt enhancer degraded due to ${errorClass}`;
      const degradedWarnings = warnings.length > 0
        ? [...warnings, degradedWarning]
        : [degradedWarning];
      return {
        tool: "prompt_enhancer",
        language: "unknown",
        technical_terms: [],
        top_paths: [],
        evidence: [],
        context_block: "[Enhanced Context]\nlanguage=unknown\ntechnical_terms=<none>",
        source_stats: sourceStats,
        warnings: degradedWarnings,
        duration_ms: 0,
      };
    }
    throw createError(
      errorClass,
      warnings.join("; ") || "prompt enhancer failed for all sources",
      {
        source_count: sourceStats.length,
        error_classes: Array.from(new Set(errorClasses)).slice(0, 8),
        source_stats: sourceStats.slice(0, 8),
        warnings: warnings.slice(0, 8),
      },
    );
  }

  evidence.sort((left, right) => right.score - left.score);
  const selectedEvidence = evidence.slice(0, maxEvidence);
  const dedupTopPaths = [];
  const topPathSeen = new Set();
  for (const row of topPaths) {
    const normalized = String(row ?? "").trim();
    if (!normalized || topPathSeen.has(normalized)) {
      continue;
    }
    topPathSeen.add(normalized);
    dedupTopPaths.push(normalized);
    if (dedupTopPaths.length >= maxEvidence) {
      break;
    }
  }
  const contextLines = [];
  contextLines.push("[Enhanced Context]");
  contextLines.push(`language=${language}`);
  contextLines.push(`technical_terms=${Array.from(technicalTerms).join(", ") || "<none>"}`);
  for (const item of selectedEvidence.slice(0, 8)) {
    const location = `${item.path}:L${String(item.start_line)}-${String(item.end_line)}`;
    contextLines.push(`- [${item.source}] ${location} score=${item.score.toFixed(3)}`);
  }

  return {
    tool: "prompt_enhancer",
    language,
    technical_terms: Array.from(technicalTerms),
    top_paths: dedupTopPaths,
    evidence: selectedEvidence,
    context_block: contextLines.join("\n"),
    source_stats: sourceStats,
    warnings,
    duration_ms: 0,
  };
}

function runMock(command, payload) {
  if (command === "semantic-search") {
    return {
      tool: "semantic_search",
      query: String(payload.query ?? ""),
      count: 1,
      source_stats: [{ source: "code", root_path: String(process.cwd()), status: "ok", count: 1 }],
      matches: [{
        source: "code",
        root_path: String(process.cwd()),
        path: "src/main.ts",
        start_line: 10,
        end_line: 20,
        score: 0.91,
        breadcrumb: "main > handler",
        text: "mock semantic search result",
      }],
      warnings: [],
      duration_ms: 0,
    };
  }
  return {
    tool: "prompt_enhancer",
    language: "en",
    technical_terms: ["mockTerm"],
    top_paths: ["[code] src/main.ts"],
    evidence: [{
      source: "code",
      root_path: String(process.cwd()),
      path: "src/main.ts",
      start_line: 10,
      end_line: 20,
      score: 0.87,
      breadcrumb: "main > handler",
      text: "mock prompt enhancer evidence",
    }],
    context_block: "[Enhanced Context]\nlanguage=en\ntechnical_terms=mockTerm",
    source_stats: [{ source: "code", root_path: String(process.cwd()), status: "ok" }],
    warnings: [],
    duration_ms: 0,
  };
}

async function runMain(argv) {
  const startedAt = Date.now();
  const { command, payload, timeoutMs } = parseArgs(argv);
  if (command !== "semantic-search" && command !== "prompt-enhancer") {
    throw createError("semantic_invalid_request", `unsupported bridge command: ${command}`);
  }
  const useMock = String(process.env.GROBOT_CONTEXTWEAVER_BRIDGE_MOCK ?? "").trim() === "1";
  const result = useMock
    ? runMock(command, payload)
    : command === "semantic-search"
      ? await runSemanticSearch(payload, timeoutMs)
      : await runPromptEnhancer(payload, timeoutMs);
  result.duration_ms = Date.now() - startedAt;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

runMain(process.argv.slice(2)).catch((error) => {
  const errorClass = typeof error?.errorClass === "string" && error.errorClass.trim()
    ? error.errorClass.trim()
    : "semantic_search_failed";
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    error_class: errorClass,
    message,
  };
  if (isRecord(error?.details)) {
    payload.details = error.details;
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
