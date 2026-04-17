import {
  callTypeGuard,
  createTypeScriptAstContext,
  isTypeScriptAstRuntimeAvailable as isAstRuntimeAvailable,
  readNodeText,
  isRecord,
  type TsNodeLike,
  type TypeScriptApiLike,
} from "./ts-ast-runtime";

export interface AstSymbolDeclaration {
  symbol: string;
  kind: string;
  line: number;
}

export function isTypeScriptAstRuntimeAvailable(): boolean {
  return isAstRuntimeAvailable();
}

function readNodeName(node: TsNodeLike): string | undefined {
  return readNodeText(node.name);
}

function safeGetLine(sourceFile: TsNodeLike, pos: number): number {
  const getter = sourceFile.getLineAndCharacterOfPosition;
  if (typeof getter === "function") {
    const lineChar = getter.call(sourceFile, pos) as unknown;
    if (isRecord(lineChar) && typeof lineChar.line === "number") {
      return Math.max(1, Math.floor(lineChar.line) + 1);
    }
  }
  return 1;
}

function pushSymbol(rows: AstSymbolDeclaration[], symbolRaw: string | undefined, kind: string, line: number): void {
  if (!symbolRaw) {
    return;
  }
  const symbol = symbolRaw.replace(/[^A-Za-z0-9_$]/g, "");
  if (symbol.length < 2) {
    return;
  }
  rows.push({
    symbol,
    kind,
    line: Math.max(1, line),
  });
}

function extractVariableFunctionDeclarations(ts: TypeScriptApiLike, node: TsNodeLike): AstSymbolDeclaration[] {
  const rows: AstSymbolDeclaration[] = [];
  const declarationList = node.declarationList;
  if (!isRecord(declarationList)) {
    return rows;
  }
  const declarations = declarationList.declarations;
  if (!Array.isArray(declarations)) {
    return rows;
  }
  for (const declarationRaw of declarations) {
    if (!isRecord(declarationRaw)) {
      continue;
    }
    const name = readNodeText(declarationRaw.name);
    if (!name) {
      continue;
    }
    const initializer = declarationRaw.initializer;
    if (!isRecord(initializer)) {
      continue;
    }
    const isArrow = callTypeGuard(ts, "isArrowFunction", initializer);
    const isFnExpr = callTypeGuard(ts, "isFunctionExpression", initializer);
    if (!isArrow && !isFnExpr) {
      continue;
    }
    const posRaw = declarationRaw.pos;
    const line = typeof posRaw === "number" ? Math.max(1, Math.floor(posRaw)) : 0;
    rows.push({
      symbol: name,
      kind: "const-fn",
      line,
    });
  }
  return rows;
}

function dedupeSymbols(rows: readonly AstSymbolDeclaration[]): AstSymbolDeclaration[] {
  const seen = new Set<string>();
  const output: AstSymbolDeclaration[] = [];
  for (const row of rows) {
    const key = `${row.kind}::${row.symbol}::${String(row.line)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(row);
    if (output.length >= 300) {
      break;
    }
  }
  return output;
}

export function extractTypeScriptAstSymbols(
  filePath: string,
  content: string,
): AstSymbolDeclaration[] {
  const context = createTypeScriptAstContext(filePath, content);
  if (!context) {
    return [];
  }
  const { ts, sourceFile } = context;
  const rows: AstSymbolDeclaration[] = [];
  const walk = (node: TsNodeLike): void => {
    const posRaw = node.pos;
    const line = safeGetLine(
      sourceFile,
      typeof posRaw === "number" && Number.isFinite(posRaw) ? posRaw : 0,
    );
    if (callTypeGuard(ts, "isFunctionDeclaration", node)) {
      pushSymbol(rows, readNodeName(node), "fn", line);
    } else if (callTypeGuard(ts, "isClassDeclaration", node)) {
      pushSymbol(rows, readNodeName(node), "class", line);
    } else if (callTypeGuard(ts, "isInterfaceDeclaration", node)) {
      pushSymbol(rows, readNodeName(node), "interface", line);
    } else if (callTypeGuard(ts, "isTypeAliasDeclaration", node)) {
      pushSymbol(rows, readNodeName(node), "type", line);
    } else if (callTypeGuard(ts, "isEnumDeclaration", node)) {
      pushSymbol(rows, readNodeName(node), "enum", line);
    } else if (callTypeGuard(ts, "isMethodDeclaration", node)) {
      pushSymbol(rows, readNodeName(node), "method", line);
    } else if (callTypeGuard(ts, "isVariableStatement", node)) {
      const extracted = extractVariableFunctionDeclarations(ts, node);
      for (const row of extracted) {
        pushSymbol(rows, row.symbol, row.kind, safeGetLine(sourceFile, row.line));
      }
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
  return dedupeSymbols(rows);
}
