export type TsNodeLike = Record<string, unknown>;

export interface TypeScriptApiLike {
  ScriptKind?: {
    TS?: number;
    TSX?: number;
    JS?: number;
    JSX?: number;
  };
  ScriptTarget?: {
    Latest?: number;
  };
  SyntaxKind?: {
    ImportKeyword?: number;
  };
  createSourceFile?: (
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes?: boolean,
    scriptKind?: number,
  ) => TsNodeLike;
  forEachChild?: (node: TsNodeLike, cbNode: (node: TsNodeLike) => void) => void;
  isFunctionDeclaration?: (node: TsNodeLike) => boolean;
  isClassDeclaration?: (node: TsNodeLike) => boolean;
  isInterfaceDeclaration?: (node: TsNodeLike) => boolean;
  isTypeAliasDeclaration?: (node: TsNodeLike) => boolean;
  isEnumDeclaration?: (node: TsNodeLike) => boolean;
  isMethodDeclaration?: (node: TsNodeLike) => boolean;
  isVariableStatement?: (node: TsNodeLike) => boolean;
  isArrowFunction?: (node: TsNodeLike) => boolean;
  isFunctionExpression?: (node: TsNodeLike) => boolean;
  isImportDeclaration?: (node: TsNodeLike) => boolean;
  isExportDeclaration?: (node: TsNodeLike) => boolean;
  isCallExpression?: (node: TsNodeLike) => boolean;
}

export interface TypeScriptAstContext {
  ts: TypeScriptApiLike;
  sourceFile: TsNodeLike;
}

let cachedTypeScriptApi: TypeScriptApiLike | null | undefined;
const sourceFileCache = new Map<string, TypeScriptAstContext>();
const MAX_SOURCE_FILE_CACHE_ENTRIES = 256;

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").trim().toLowerCase();
}

function supportsTypeScriptAst(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    normalized.endsWith(".ts")
    || normalized.endsWith(".tsx")
    || normalized.endsWith(".js")
    || normalized.endsWith(".jsx")
    || normalized.endsWith(".mjs")
    || normalized.endsWith(".cjs")
  );
}

function resolveScriptKind(ts: TypeScriptApiLike, filePath: string): number | undefined {
  const kinds = ts.ScriptKind;
  if (!kinds) {
    return undefined;
  }
  const normalized = normalizePath(filePath);
  if (normalized.endsWith(".tsx") && typeof kinds.TSX === "number") {
    return kinds.TSX;
  }
  if (normalized.endsWith(".jsx") && typeof kinds.JSX === "number") {
    return kinds.JSX;
  }
  if (normalized.endsWith(".ts") && typeof kinds.TS === "number") {
    return kinds.TS;
  }
  if (typeof kinds.JS === "number") {
    return kinds.JS;
  }
  return undefined;
}

function hashContent(raw: string): string {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function setSourceFileCache(key: string, value: TypeScriptAstContext): void {
  if (sourceFileCache.has(key)) {
    sourceFileCache.delete(key);
  }
  sourceFileCache.set(key, value);
  while (sourceFileCache.size > MAX_SOURCE_FILE_CACHE_ENTRIES) {
    const oldestKey = sourceFileCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    sourceFileCache.delete(oldestKey);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveTypeScriptApi(): TypeScriptApiLike | null {
  if (cachedTypeScriptApi !== undefined) {
    return cachedTypeScriptApi;
  }
  const dynamicRequire = (() => {
    try {
      const resolver = Function("return (typeof require === 'function') ? require : undefined;");
      const candidate = resolver() as unknown;
      if (typeof candidate === "function") {
        return candidate as (id: string) => unknown;
      }
      return undefined;
    } catch {
      return undefined;
    }
  })();
  if (!dynamicRequire) {
    cachedTypeScriptApi = null;
    return null;
  }
  try {
    const required = dynamicRequire("typescript");
    if (!isRecord(required)) {
      cachedTypeScriptApi = null;
      return null;
    }
    cachedTypeScriptApi = required as unknown as TypeScriptApiLike;
    return cachedTypeScriptApi;
  } catch {
    cachedTypeScriptApi = null;
    return null;
  }
}

export function isTypeScriptAstRuntimeAvailable(): boolean {
  return resolveTypeScriptApi() !== null;
}

export function createTypeScriptAstContext(
  filePath: string,
  content: string,
): TypeScriptAstContext | undefined {
  if (!supportsTypeScriptAst(filePath)) {
    return undefined;
  }
  const ts = resolveTypeScriptApi();
  if (!ts || typeof ts.createSourceFile !== "function") {
    return undefined;
  }
  const scriptKind = resolveScriptKind(ts, filePath);
  const normalizedPath = normalizePath(filePath);
  const cacheKey = `${normalizedPath}::${String(content.length)}::${hashContent(content)}::${String(scriptKind ?? -1)}`;
  const cached = sourceFileCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const latest = ts.ScriptTarget?.Latest;
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    typeof latest === "number" ? latest : 99,
    true,
    scriptKind,
  );
  if (!isRecord(sourceFile)) {
    return undefined;
  }
  const context: TypeScriptAstContext = { ts, sourceFile };
  setSourceFileCache(cacheKey, context);
  return context;
}

export function readNodeText(node: unknown): string | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const escapedText = node.escapedText;
  if (typeof escapedText === "string" && escapedText.trim()) {
    return escapedText.trim();
  }
  const text = node.text;
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }
  return undefined;
}

export function callTypeGuard(
  ts: TypeScriptApiLike,
  name: keyof TypeScriptApiLike,
  node: TsNodeLike,
): boolean {
  const guard = ts[name];
  if (typeof guard !== "function") {
    return false;
  }
  return Boolean((guard as (target: TsNodeLike) => boolean)(node));
}
