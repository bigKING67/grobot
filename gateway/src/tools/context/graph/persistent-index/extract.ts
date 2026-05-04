import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { hashContentFNV } from "../cache-utils";
import { extractTypeScriptAstDependencyTargets } from "../dependency-ts-ast";
import { extractTypeScriptAstSymbols, type AstSymbolDeclaration } from "../symbol-ts-ast";
import {
  MAX_FILE_BYTES,
  MAX_IDENTIFIER_OCCURRENCES,
  MAX_IDENTIFIERS_PER_FILE,
  MAX_IMPORTS_PER_FILE,
  MAX_SYMBOLS_PER_FILE,
  STOP_IDENTIFIERS,
  type PersistentGraphFileRecord,
  type PersistentGraphSymbolRecord,
  type SafeFileStats,
} from "./contract";
import {
  clampInteger,
  dedupeStrings,
  normalizePath,
} from "./utils";

export function dedupeSymbols(rows: readonly PersistentGraphSymbolRecord[]): PersistentGraphSymbolRecord[] {
  const output: PersistentGraphSymbolRecord[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const symbol = row.symbol.trim();
    if (!symbol) {
      continue;
    }
    const line = clampInteger(row.line, 1, 1, 999_999);
    const key = `${row.kind.toLowerCase()}::${symbol.toLowerCase()}::${String(line)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({
      symbol,
      kind: row.kind.trim() || "symbol",
      line,
    });
    if (output.length >= MAX_SYMBOLS_PER_FILE) {
      break;
    }
  }
  return output;
}

function addRegexSymbolRows(
  rows: PersistentGraphSymbolRecord[],
  content: string,
  regex: RegExp,
  kind: string,
): void {
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    const symbolRaw = String(match[1] ?? "").trim();
    const symbol = symbolRaw.replace(/[^A-Za-z0-9_$]/g, "");
    if (symbol.length >= 2) {
      const before = content.slice(0, match.index);
      const line = before.split("\n").length;
      rows.push({
        symbol,
        kind,
        line,
      });
    }
    match = regex.exec(content);
  }
}

function extractRegexSymbolDeclarations(content: string): PersistentGraphSymbolRecord[] {
  const rows: PersistentGraphSymbolRecord[] = [];
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g, "fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "class");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "interface");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "type");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g, "const-fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/g, "class");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "struct");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "enum");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "trait");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  return dedupeSymbols(rows);
}

function extractSymbols(filePath: string, content: string): PersistentGraphSymbolRecord[] {
  const astRows = extractTypeScriptAstSymbols(filePath, content).map((row: AstSymbolDeclaration) => ({
    symbol: row.symbol,
    kind: row.kind,
    line: row.line,
  }));
  if (astRows.length > 0) {
    return dedupeSymbols(astRows);
  }
  return extractRegexSymbolDeclarations(content);
}

function extractRegexImports(content: string): string[] {
  const rows: string[] = [];
  const push = (value: string): void => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    rows.push(normalized);
  };
  const esmRegex = /from\s+["']([^"']+)["']/g;
  let esmMatch: RegExpExecArray | null = esmRegex.exec(content);
  while (esmMatch) {
    if (typeof esmMatch[1] === "string") {
      push(esmMatch[1]);
    }
    esmMatch = esmRegex.exec(content);
  }
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
  let requireMatch: RegExpExecArray | null = requireRegex.exec(content);
  while (requireMatch) {
    if (typeof requireMatch[1] === "string") {
      push(requireMatch[1]);
    }
    requireMatch = requireRegex.exec(content);
  }
  const pythonFromRegex = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/gm;
  let pythonFromMatch: RegExpExecArray | null = pythonFromRegex.exec(content);
  while (pythonFromMatch) {
    if (typeof pythonFromMatch[1] === "string") {
      push(pythonFromMatch[1]);
    }
    pythonFromMatch = pythonFromRegex.exec(content);
  }
  const pythonImportRegex = /^\s*import\s+([A-Za-z0-9_.]+)/gm;
  let pythonImportMatch: RegExpExecArray | null = pythonImportRegex.exec(content);
  while (pythonImportMatch) {
    if (typeof pythonImportMatch[1] === "string") {
      push(pythonImportMatch[1]);
    }
    pythonImportMatch = pythonImportRegex.exec(content);
  }
  const rustUseRegex = /^\s*use\s+([A-Za-z0-9_:]+)/gm;
  let rustUseMatch: RegExpExecArray | null = rustUseRegex.exec(content);
  while (rustUseMatch) {
    if (typeof rustUseMatch[1] === "string") {
      push(rustUseMatch[1]);
    }
    rustUseMatch = rustUseRegex.exec(content);
  }
  return dedupeStrings(rows, MAX_IMPORTS_PER_FILE);
}

function extractImports(filePath: string, content: string): string[] {
  const astTargets = extractTypeScriptAstDependencyTargets(filePath, content);
  if (astTargets.length > 0) {
    return dedupeStrings(astTargets, MAX_IMPORTS_PER_FILE);
  }
  return extractRegexImports(content);
}

function extractIdentifierHints(content: string): string[] {
  const counts = new Map<string, number>();
  const regex = /\b[A-Za-z_][A-Za-z0-9_$]{1,63}\b/g;
  let match: RegExpExecArray | null = regex.exec(content);
  let observed = 0;
  while (match) {
    const raw = String(match[0] ?? "").trim();
    const token = raw.toLowerCase();
    if (!token || STOP_IDENTIFIERS.has(token)) {
      match = regex.exec(content);
      continue;
    }
    observed += 1;
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (observed >= MAX_IDENTIFIER_OCCURRENCES) {
      break;
    }
    match = regex.exec(content);
  }
  return Array.from(counts.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, MAX_IDENTIFIERS_PER_FILE)
    .map((item) => item[0]);
}

export function readSafeFileStats(path: string): SafeFileStats | undefined {
  let raw: unknown;
  try {
    raw = statSync(path) as unknown;
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined;
  }
  const stats = raw as {
    size?: unknown;
    mtimeMs?: unknown;
    isFile?: unknown;
  };
  const size = typeof stats.size === "number" && Number.isFinite(stats.size)
    ? Math.max(0, Math.floor(stats.size))
    : 0;
  const mtimeMs = typeof stats.mtimeMs === "number" && Number.isFinite(stats.mtimeMs)
    ? Math.max(0, Math.floor(stats.mtimeMs))
    : 0;
  const isFile = typeof stats.isFile === "function"
    ? Boolean((stats.isFile as () => unknown).call(stats))
    : true;
  return {
    size,
    mtimeMs,
    isFile,
  };
}

export function parseCodeFile(rootPath: string, filePath: string): PersistentGraphFileRecord | undefined {
  const absolutePath = resolve(rootPath, filePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  const stats = readSafeFileStats(absolutePath);
  if (!stats || !stats.isFile) {
    return undefined;
  }
  if (stats.size > MAX_FILE_BYTES) {
    return undefined;
  }
  let content = "";
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
  return {
    path: normalizePath(filePath),
    hash: hashContentFNV(content),
    size: Math.max(0, Math.floor(stats.size)),
    mtimeMs: Math.max(0, Math.floor(stats.mtimeMs)),
    imports: extractImports(filePath, content),
    symbols: extractSymbols(filePath, content),
    identifiers: extractIdentifierHints(content),
  };
}
