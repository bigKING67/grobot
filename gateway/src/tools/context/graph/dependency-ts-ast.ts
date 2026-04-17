import {
  callTypeGuard,
  createTypeScriptAstContext,
  isTypeScriptAstRuntimeAvailable as isAstRuntimeAvailable,
  readNodeText,
  isRecord,
  type TsNodeLike,
  type TypeScriptApiLike,
} from "./ts-ast-runtime";

export function isTypeScriptDependencyAstRuntimeAvailable(): boolean {
  return isAstRuntimeAvailable();
}

function pushTarget(rows: string[], targetRaw: string | undefined): void {
  if (!targetRaw) {
    return;
  }
  const target = targetRaw.trim();
  if (!target) {
    return;
  }
  rows.push(target);
}

function readModuleSpecifier(node: TsNodeLike): string | undefined {
  return readNodeText(node.moduleSpecifier);
}

function readCallExpressionImportTarget(
  ts: TypeScriptApiLike,
  node: TsNodeLike,
): string | undefined {
  if (!callTypeGuard(ts, "isCallExpression", node)) {
    return undefined;
  }
  const args = node.arguments;
  if (!Array.isArray(args) || args.length <= 0) {
    return undefined;
  }
  const firstArg = args[0];
  const importPath = readNodeText(firstArg);
  if (!importPath) {
    return undefined;
  }
  const expression = node.expression;
  if (!isRecord(expression)) {
    return undefined;
  }
  const expressionText = readNodeText(expression);
  if (expressionText === "require") {
    return importPath;
  }
  if (expressionText === "import") {
    return importPath;
  }
  const importKeyword = ts.SyntaxKind?.ImportKeyword;
  if (
    typeof importKeyword === "number"
    && typeof expression.kind === "number"
    && expression.kind === importKeyword
  ) {
    return importPath;
  }
  return undefined;
}

function dedupeTargets(rows: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of rows) {
    const normalized = raw.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 240) {
      break;
    }
  }
  return output;
}

export function extractTypeScriptAstDependencyTargets(
  filePath: string,
  content: string,
): string[] {
  const context = createTypeScriptAstContext(filePath, content);
  if (!context) {
    return [];
  }
  const { ts, sourceFile } = context;
  const targets: string[] = [];
  const walk = (node: TsNodeLike): void => {
    if (callTypeGuard(ts, "isImportDeclaration", node)) {
      pushTarget(targets, readModuleSpecifier(node));
    } else if (callTypeGuard(ts, "isExportDeclaration", node)) {
      pushTarget(targets, readModuleSpecifier(node));
    } else {
      pushTarget(targets, readCallExpressionImportTarget(ts, node));
    }
    const walker = ts.forEachChild;
    if (typeof walker === "function") {
      walker(node, (child) => {
        if (isRecord(child)) {
          walk(child);
        }
      });
    }
  };
  walk(sourceFile);
  return dedupeTargets(targets);
}
