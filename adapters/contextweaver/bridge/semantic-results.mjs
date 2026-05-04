import { isAbsolute, relative, resolve } from "node:path";
import {
  MAX_EVIDENCE_TEXT_CHARS,
  isRecord,
  toPositiveInt,
  truncateText,
} from "./common.mjs";

export function normalizeContextWeaverPath(rootPath, filePath) {
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedPath) {
    return "";
  }
  if (!isAbsolute(normalizedPath)) {
    return normalizedPath;
  }
  const base = resolve(rootPath);
  const relativePath = relative(base, normalizedPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return normalizedPath;
  }
  return relativePath.split("\\").join("/");
}

export function normalizeSemanticScore(value) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (numeric <= 0) {
    return 0;
  }
  if (numeric <= 1) {
    return Number(numeric.toFixed(6));
  }
  return Number((numeric / (numeric + 1)).toFixed(6));
}

function deduplicateSemanticMatches(matches) {
  const dedup = new Map();
  for (const row of Array.isArray(matches) ? matches : []) {
    if (!isRecord(row)) {
      continue;
    }
    const source = String(row.source ?? "").trim();
    const rootPath = String(row.root_path ?? "").trim();
    const path = String(row.path ?? "").trim();
    const startLine = toPositiveInt(row.start_line, 1, 10 ** 8);
    const endLine = toPositiveInt(row.end_line, startLine, 10 ** 8);
    const lineEnd = endLine < startLine ? startLine : endLine;
    const key = `${source}:${rootPath}:${path}:${String(startLine)}:${String(lineEnd)}`;
    const normalized = {
      ...row,
      source,
      root_path: rootPath,
      path,
      start_line: startLine,
      end_line: lineEnd,
      score: normalizeSemanticScore(row.score),
      breadcrumb: String(row.breadcrumb ?? ""),
      text: truncateText(String(row.text ?? ""), MAX_EVIDENCE_TEXT_CHARS),
    };
    const previous = dedup.get(key);
    if (!previous || normalized.score > previous.score) {
      dedup.set(key, normalized);
    }
  }
  return [...dedup.values()];
}

export function rankSemanticMatches(matches, maxSegments) {
  const deduped = deduplicateSemanticMatches(matches);
  if (deduped.length === 0) {
    return [];
  }
  deduped.sort((left, right) => (
    normalizeSemanticScore(right.score) - normalizeSemanticScore(left.score)
  ) || (
    String(left.path ?? "").localeCompare(String(right.path ?? ""))
  ) || (
    toPositiveInt(left.start_line, 1, 10 ** 8) - toPositiveInt(right.start_line, 1, 10 ** 8)
  ));
  return deduped.slice(0, maxSegments);
}
