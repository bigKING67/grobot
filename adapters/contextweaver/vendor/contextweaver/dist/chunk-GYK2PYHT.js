import {
  closeAllIndexers,
  closeAllVectorStores,
  getIndexer
} from "./chunk-WQHSYTJN.js";
import {
  batchDelete,
  batchUpdateMtime,
  batchUpsert,
  clear,
  closeDb,
  generateProjectId,
  getAllFileMeta,
  getAllPaths,
  getFilesNeedingVectorIndex,
  getStoredEmbeddingDimensions,
  initDb,
  setStoredEmbeddingDimensions
} from "./chunk-35HO3GPM.js";
import {
  logger
} from "./chunk-44FXLQ5V.js";
import {
  getEmbeddingConfig,
  getExcludePatterns
} from "./chunk-CA4WQHZS.js";

// src/scanner/index.ts
import path4 from "path";

// src/scanner/crawler.ts
import { fdir } from "fdir";

// src/scanner/filter.ts
import fs2 from "fs/promises";
import path2 from "path";
import ignore from "ignore";

// src/projectConfig.ts
import fs from "fs/promises";
import path from "path";
var DEFAULT_PROJECT_CONFIG = {
  indexing: {
    includePatterns: null,
    ignorePatterns: []
  }
};
function getDefaultProjectConfig() {
  return {
    indexing: {
      includePatterns: DEFAULT_PROJECT_CONFIG.indexing.includePatterns,
      ignorePatterns: [...DEFAULT_PROJECT_CONFIG.indexing.ignorePatterns]
    }
  };
}
function getRecommendedProjectConfigTemplate() {
  return {
    indexing: {
      includePatterns: ["src/**"],
      ignorePatterns: []
    }
  };
}
function stringifyProjectConfig(config) {
  return `${JSON.stringify(
    {
      indexing: {
        ...config.indexing.includePatterns === null ? {} : { includePatterns: config.indexing.includePatterns },
        ignorePatterns: config.indexing.ignorePatterns
      }
    },
    null,
    2
  )}
`;
}
function formatProjectIndexingScope(config) {
  const include = config.indexing.includePatterns;
  return {
    includeSummary: include === null ? "<all files>" : include.length === 0 ? "<empty>" : include.join(", "),
    ignoreSummary: config.indexing.ignorePatterns.length === 0 ? "<none>" : config.indexing.ignorePatterns.join(", "),
    hasEmptyIncludeScope: Array.isArray(include) && include.length === 0
  };
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validatePatterns(value, fieldName, configPath) {
  if (value === void 0) {
    return fieldName === "includePatterns" ? null : [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${configPath}: indexing.${fieldName} must be an array of strings`);
  }
  for (const pattern of value) {
    if (typeof pattern !== "string") {
      throw new Error(`Invalid ${configPath}: indexing.${fieldName} must be an array of strings`);
    }
    if (pattern.startsWith("!")) {
      throw new Error(
        `Invalid ${configPath}: indexing.${fieldName} does not support negated patterns`
      );
    }
  }
  return value;
}
async function loadProjectConfig(rootPath) {
  const configPath = path.join(rootPath, "cwconfig.json");
  let content;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    const err = error;
    if (err.code === "ENOENT") {
      return getDefaultProjectConfig();
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const err = error;
    throw new Error(`Invalid ${configPath}: failed to parse JSON (${err.message})`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid ${configPath}: top-level value must be an object`);
  }
  const indexingValue = parsed.indexing;
  if (indexingValue === void 0) {
    return getDefaultProjectConfig();
  }
  if (!isPlainObject(indexingValue)) {
    throw new Error(`Invalid ${configPath}: indexing must be an object`);
  }
  return {
    indexing: {
      includePatterns: validatePatterns(
        indexingValue.includePatterns,
        "includePatterns",
        configPath
      ),
      ignorePatterns: validatePatterns(indexingValue.ignorePatterns, "ignorePatterns", configPath) ?? []
    }
  };
}

// src/scanner/language.ts
var LANGUAGE_MAP = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "cpp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".md": "markdown",
  ".json": "json"
};
var ALLOWED_EXTENSIONS = new Set(Object.keys(LANGUAGE_MAP));
function getLanguage(filePath) {
  const ext = getFileExtension(filePath);
  return LANGUAGE_MAP[ext] || "unknown";
}
function isAllowedExtension(filePath) {
  const ext = getFileExtension(filePath);
  return ALLOWED_EXTENSIONS.has(ext);
}
function getFileExtension(filePath) {
  const ext = filePath.split(".").pop();
  return ext ? `.${ext.toLowerCase()}` : "";
}

// src/scanner/filter.ts
var includeInstance = null;
var defaultIgnoreInstance = null;
var projectIgnoreInstance = null;
var gitignoreInstance = null;
var includeAll = true;
var lastConfigHash = null;
async function generateConfigHash(rootPath) {
  const crypto2 = await import("crypto");
  const hashes = [];
  const configPath = path2.join(rootPath, "cwconfig.json");
  try {
    const content = await fs2.readFile(configPath, "utf-8");
    hashes.push(`cwconfig:${crypto2.createHash("sha256").update(content).digest("hex")}`);
  } catch {
    hashes.push("cwconfig:missing");
  }
  const gitignorePath = path2.join(rootPath, ".gitignore");
  try {
    const content = await fs2.readFile(gitignorePath, "utf-8");
    hashes.push(`gitignore:${crypto2.createHash("sha256").update(content).digest("hex")}`);
  } catch {
    hashes.push("gitignore:missing");
  }
  const combined = hashes.join("|");
  return crypto2.createHash("sha256").update(combined).digest("hex");
}
async function initFilter(rootPath) {
  const currentHash = await generateConfigHash(rootPath);
  if (lastConfigHash === currentHash && defaultIgnoreInstance && projectIgnoreInstance && gitignoreInstance && (includeAll || includeInstance)) {
    return;
  }
  const projectConfig = await loadProjectConfig(rootPath);
  if (projectConfig.indexing.includePatterns === null) {
    includeAll = true;
    includeInstance = null;
  } else {
    includeAll = false;
    includeInstance = ignore().add(projectConfig.indexing.includePatterns);
  }
  defaultIgnoreInstance = ignore().add(getExcludePatterns());
  projectIgnoreInstance = ignore().add(projectConfig.indexing.ignorePatterns);
  const gitignorePath = path2.join(rootPath, ".gitignore");
  const gitignore = ignore();
  try {
    await fs2.access(gitignorePath);
    gitignore.add(await fs2.readFile(gitignorePath, "utf-8"));
  } catch {
  }
  gitignoreInstance = gitignore;
  lastConfigHash = currentHash;
}
function isFiltered(relativePath) {
  if (!defaultIgnoreInstance || !projectIgnoreInstance || !gitignoreInstance) {
    throw new Error("Filter not initialized. Call initFilter() first.");
  }
  return relativePath === "cwconfig.json" || defaultIgnoreInstance.ignores(relativePath) || projectIgnoreInstance.ignores(relativePath) || gitignoreInstance.ignores(relativePath);
}
function isIncluded(relativePath) {
  if (includeAll) {
    return true;
  }
  if (!includeInstance) {
    throw new Error("Filter not initialized. Call initFilter() first.");
  }
  return includeInstance.ignores(relativePath);
}
function isAllowedFile(filePath) {
  return isAllowedExtension(filePath);
}

// src/scanner/crawler.ts
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function crawl(rootPath) {
  const relativePaths = [];
  const api = new fdir().withFullPaths().withErrors().filter((filePath) => {
    const normalizedFilePath = filePath.replace(/\\/g, "/");
    const normalizedRootPath = rootPath.replace(/\\/g, "/");
    const relativePath = normalizedFilePath.replace(
      new RegExp(`^${escapeRegExp(normalizedRootPath)}/?`),
      ""
    );
    const matched = isIncluded(relativePath) && !isFiltered(relativePath) && isAllowedFile(relativePath);
    if (matched) {
      relativePaths.push(relativePath);
    }
    return matched;
  });
  const filePaths = await api.crawl(rootPath).withPromise();
  return { filePaths, relativePaths };
}

// src/scanner/processor.ts
import fs4 from "fs/promises";
import os from "os";
import path3 from "path";
import pLimit from "p-limit";

// src/chunking/ParserPool.ts
import Parser from "@keqingmoe/tree-sitter";
var GRAMMAR_MODULES = {
  typescript: "tree-sitter-typescript",
  javascript: "tree-sitter-javascript",
  python: "tree-sitter-python",
  go: "tree-sitter-go",
  rust: "tree-sitter-rust",
  java: "tree-sitter-java",
  c: "tree-sitter-c",
  cpp: "tree-sitter-cpp",
  c_sharp: "tree-sitter-c-sharp"
};
var loadedGrammars = /* @__PURE__ */ new Map();
var parserCache = /* @__PURE__ */ new Map();
async function loadGrammar(language) {
  const cached = loadedGrammars.get(language);
  if (cached) return cached;
  const moduleName = GRAMMAR_MODULES[language];
  if (!moduleName) return null;
  try {
    const grammarModule = await import(moduleName);
    let grammar = null;
    if (language === "typescript") {
      grammar = grammarModule.default?.typescript ?? grammarModule.typescript;
    } else {
      const exported = grammarModule.default ?? grammarModule;
      if (exported && typeof exported === "object" && "nodeTypeInfo" in exported) {
        grammar = exported;
      } else if (exported?.language) {
        grammar = exported.language;
      } else if (exported?.[language]) {
        grammar = exported[language];
      }
    }
    if (!grammar) {
      console.error(
        `[ParserPool] Could not extract grammar for ${language} from module ${moduleName}`
      );
      return null;
    }
    loadedGrammars.set(language, grammar);
    return grammar;
  } catch (err) {
    console.error(`[ParserPool] Failed to load grammar for ${language}:`, err);
    return null;
  }
}
async function getParser(language) {
  const cached = parserCache.get(language);
  if (cached) return cached;
  const grammar = await loadGrammar(language);
  if (!grammar) return null;
  const parser = new Parser();
  parser.setLanguage(grammar);
  parserCache.set(language, parser);
  return parser;
}
function isLanguageSupported(language) {
  return language in GRAMMAR_MODULES;
}

// src/chunking/LanguageSpec.ts
var LANGUAGE_SPECS = {
  typescript: {
    hierarchy: /* @__PURE__ */ new Set([
      "class_declaration",
      "abstract_class_declaration",
      "interface_declaration",
      "function_declaration",
      "generator_function_declaration",
      "method_definition",
      "arrow_function",
      "export_statement",
      "import_statement"
    ]),
    nameFields: ["name", "id"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier", "type_identifier", "property_identifier"]),
    prefixMap: {
      class_declaration: "class ",
      abstract_class_declaration: "abstract class ",
      interface_declaration: "interface ",
      function_declaration: "fn ",
      generator_function_declaration: "fn* ",
      method_definition: "",
      arrow_function: ""
    },
    commentTypes: /* @__PURE__ */ new Set(["comment"])
  },
  javascript: {
    hierarchy: /* @__PURE__ */ new Set([
      "class_declaration",
      "function_declaration",
      "generator_function_declaration",
      "method_definition",
      "arrow_function"
    ]),
    nameFields: ["name", "id"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier", "property_identifier"]),
    prefixMap: {
      class_declaration: "class ",
      function_declaration: "fn ",
      generator_function_declaration: "fn* ",
      method_definition: "",
      arrow_function: ""
    },
    commentTypes: /* @__PURE__ */ new Set(["comment"])
  },
  python: {
    hierarchy: /* @__PURE__ */ new Set(["class_definition", "function_definition", "decorated_definition"]),
    nameFields: ["name"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier"]),
    prefixMap: {
      class_definition: "class ",
      function_definition: "def ",
      decorated_definition: ""
    },
    commentTypes: /* @__PURE__ */ new Set(["comment"])
  },
  go: {
    hierarchy: /* @__PURE__ */ new Set([
      "function_declaration",
      "method_declaration",
      "type_spec",
      "type_declaration",
      "struct_type",
      "interface_type"
    ]),
    nameFields: ["name"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier", "type_identifier", "field_identifier"]),
    prefixMap: {
      function_declaration: "func ",
      method_declaration: "func ",
      type_spec: "type ",
      type_declaration: "type ",
      struct_type: "struct ",
      interface_type: "interface "
    },
    commentTypes: /* @__PURE__ */ new Set(["comment"])
  },
  rust: {
    hierarchy: /* @__PURE__ */ new Set([
      "function_item",
      "struct_item",
      "enum_item",
      "trait_item",
      "impl_item",
      "mod_item",
      "type_item"
    ]),
    nameFields: ["name"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier", "type_identifier"]),
    prefixMap: {
      function_item: "fn ",
      struct_item: "struct ",
      enum_item: "enum ",
      trait_item: "trait ",
      impl_item: "impl ",
      mod_item: "mod ",
      type_item: "type "
    },
    commentTypes: /* @__PURE__ */ new Set(["line_comment", "block_comment"])
  },
  java: {
    hierarchy: /* @__PURE__ */ new Set([
      "class_declaration",
      "interface_declaration",
      "enum_declaration",
      "annotation_type_declaration",
      "method_declaration",
      "constructor_declaration",
      "record_declaration"
    ]),
    nameFields: ["name", "identifier"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier"]),
    prefixMap: {
      class_declaration: "class ",
      interface_declaration: "interface ",
      enum_declaration: "enum ",
      annotation_type_declaration: "@interface ",
      method_declaration: "",
      constructor_declaration: "",
      record_declaration: "record "
    },
    commentTypes: /* @__PURE__ */ new Set(["line_comment", "block_comment"])
  },
  c: {
    hierarchy: /* @__PURE__ */ new Set([
      "function_definition",
      "struct_specifier",
      "union_specifier",
      "enum_specifier",
      "type_definition"
    ]),
    nameFields: ["declarator", "name"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier", "type_identifier", "field_identifier"]),
    prefixMap: {
      function_definition: "",
      struct_specifier: "struct ",
      union_specifier: "union ",
      enum_specifier: "enum ",
      type_definition: "typedef "
    },
    commentTypes: /* @__PURE__ */ new Set(["comment"])
  },
  cpp: {
    hierarchy: /* @__PURE__ */ new Set([
      "function_definition",
      "class_specifier",
      "struct_specifier",
      "union_specifier",
      "enum_specifier",
      "namespace_definition",
      "template_declaration",
      "type_definition"
    ]),
    nameFields: ["declarator", "name"],
    nameNodeTypes: /* @__PURE__ */ new Set([
      "identifier",
      "type_identifier",
      "field_identifier",
      "namespace_identifier"
    ]),
    prefixMap: {
      function_definition: "",
      class_specifier: "class ",
      struct_specifier: "struct ",
      union_specifier: "union ",
      enum_specifier: "enum ",
      namespace_definition: "namespace ",
      template_declaration: "template ",
      type_definition: "typedef "
    },
    commentTypes: /* @__PURE__ */ new Set(["comment"])
  },
  c_sharp: {
    hierarchy: /* @__PURE__ */ new Set([
      "class_declaration",
      "interface_declaration",
      "struct_declaration",
      "enum_declaration",
      "record_declaration",
      "method_declaration",
      "constructor_declaration",
      "property_declaration",
      "namespace_declaration"
    ]),
    nameFields: ["name", "identifier"],
    nameNodeTypes: /* @__PURE__ */ new Set(["identifier"]),
    prefixMap: {
      class_declaration: "class ",
      interface_declaration: "interface ",
      struct_declaration: "struct ",
      enum_declaration: "enum ",
      record_declaration: "record ",
      method_declaration: "",
      constructor_declaration: "",
      property_declaration: "",
      namespace_declaration: "namespace "
    },
    commentTypes: /* @__PURE__ */ new Set(["comment"])
  }
};
function getLanguageSpec(language) {
  return LANGUAGE_SPECS[language] ?? null;
}

// src/chunking/SourceAdapter.ts
var SourceAdapter = class {
  code;
  domain;
  buffer;
  // UTF-8 字节偏移 -> 字符偏移的映射表（仅 UTF-8 域使用）
  byteToCharMap;
  // UTF-16 前缀和（用于 NWS 计算）
  nwsPrefixSum;
  constructor(config) {
    this.code = config.code;
    const lenUtf16 = config.code.length;
    const lenUtf8 = Buffer.byteLength(config.code, "utf8");
    if (config.endIndex === lenUtf16) {
      this.domain = "utf16";
      this.buffer = null;
      this.byteToCharMap = null;
    } else if (config.endIndex === lenUtf8) {
      this.domain = "utf8";
      this.buffer = Buffer.from(config.code, "utf8");
      this.byteToCharMap = this.buildByteToCharMap();
    } else {
      this.domain = "unknown";
      this.buffer = null;
      this.byteToCharMap = null;
      console.warn(
        `[SourceAdapter] Index domain unclear: endIndex=${config.endIndex}, utf16Len=${lenUtf16}, utf8Len=${lenUtf8}`
      );
    }
    this.nwsPrefixSum = this.buildNwsPrefixSum();
  }
  /**
   * 获取检测到的索引域
   */
  getDomain() {
    return this.domain;
  }
  /**
   * 安全切片：根据索引域选择正确的切片方式
   *
   * 对于 UTF-8 域，先将字节边界对齐到字符边界，再进行切片
   *
   * @param start Tree-sitter 返回的 startIndex
   * @param end Tree-sitter 返回的 endIndex
   * @returns 切片后的字符串
   */
  slice(start, end) {
    if (this.domain === "utf16" || this.domain === "unknown") {
      return this.code.slice(start, end);
    }
    if (!this.byteToCharMap) {
      return this.code.slice(start, end);
    }
    const charStart = this.byteToChar(start);
    const charEnd = this.byteToChar(end);
    return this.code.slice(charStart, charEnd);
  }
  /**
   * 计算区间的非空白字符数
   *
   * 注意：NWS 始终在字符域计算，保持语义一致性
   * 如果索引域是 UTF-8，需要先将字节偏移转换为字符偏移
   *
   * @param start Tree-sitter 返回的 startIndex
   * @param end Tree-sitter 返回的 endIndex
   * @returns 非空白字符数
   */
  nws(start, end) {
    let charStart;
    let charEnd;
    if (this.domain === "utf8" && this.byteToCharMap) {
      charStart = this.byteToChar(start);
      charEnd = this.byteToChar(end);
    } else {
      charStart = start;
      charEnd = end;
    }
    const maxIndex = this.nwsPrefixSum.length - 1;
    const s = Math.max(0, Math.min(maxIndex, charStart));
    const e = Math.max(0, Math.min(maxIndex, charEnd));
    return this.nwsPrefixSum[e] - this.nwsPrefixSum[s];
  }
  /**
   * 获取总的非空白字符数
   */
  getTotalNws() {
    return this.nwsPrefixSum[this.nwsPrefixSum.length - 1];
  }
  /**
   * 将字节偏移转换为字符偏移
   */
  byteToChar(byteOffset) {
    if (!this.byteToCharMap) return byteOffset;
    const safeOffset = Math.max(0, Math.min(this.byteToCharMap.length - 1, byteOffset));
    return this.byteToCharMap[safeOffset];
  }
  /**
   * 构建字节偏移到字符偏移的映射表
   *
   * 对于 UTF-8 编码，一个字符可能占用 1-4 个字节
   * 此映射表允许 O(1) 查找任意字节偏移对应的字符偏移
   */
  buildByteToCharMap() {
    const buffer = this.buffer;
    const map = new Uint32Array(buffer.length + 1);
    let charIndex = 0;
    let byteIndex = 0;
    while (byteIndex < buffer.length) {
      map[byteIndex] = charIndex;
      const byte = buffer[byteIndex];
      let charBytes;
      if ((byte & 128) === 0) {
        charBytes = 1;
      } else if ((byte & 224) === 192) {
        charBytes = 2;
      } else if ((byte & 240) === 224) {
        charBytes = 3;
      } else if ((byte & 248) === 240) {
        charBytes = 4;
      } else {
        charBytes = 1;
      }
      for (let i = 1; i < charBytes && byteIndex + i < buffer.length; i++) {
        map[byteIndex + i] = charIndex;
      }
      byteIndex += charBytes;
      if (charBytes === 4) {
        charIndex += 2;
      } else {
        charIndex += 1;
      }
    }
    map[buffer.length] = charIndex;
    return map;
  }
  /**
   * 构建字符域的 NWS 前缀和
   */
  buildNwsPrefixSum() {
    const prefixSum = new Uint32Array(this.code.length + 1);
    let count = 0;
    for (let i = 0; i < this.code.length; i++) {
      const cc = this.code.charCodeAt(i);
      if (!(cc === 32 || cc === 9 || cc === 10 || cc === 13)) {
        count++;
      }
      prefixSum[i + 1] = count;
    }
    return prefixSum;
  }
};

// src/chunking/SemanticSplitter.ts
var SemanticSplitter = class {
  config;
  adapter;
  code;
  language;
  constructor(config = {}) {
    const maxChunkSize = config.maxChunkSize ?? 2500;
    this.config = {
      maxChunkSize,
      minChunkSize: config.minChunkSize ?? 100,
      chunkOverlap: config.chunkOverlap ?? 200,
      // 物理字符硬上限只服务于粗粒度分片；embedding 请求安全由 embedding 层单独复核。
      maxRawChars: config.maxRawChars ?? maxChunkSize * 4
    };
  }
  /**
   * 对代码进行语义分片
   * @param tree Tree-sitter 解析树
   * @param code 源代码字符串
   * @param filePath 文件路径
   * @param language 语言标识
   * @returns 处理后的分片数组
   */
  split(tree, code, filePath, language) {
    this.adapter = new SourceAdapter({
      code,
      endIndex: tree.rootNode.endIndex
    });
    const domain = this.adapter.getDomain();
    if (domain === "unknown") {
      console.warn(
        `[SemanticSplitter] Unknown index domain for ${filePath}, falling back to simple split`
      );
      return this.fallbackSplit(code, filePath, language);
    }
    if (domain === "utf8") {
      console.info(`[SemanticSplitter] Using UTF-8 byte indexing for ${filePath}`);
    }
    this.code = code;
    this.language = language;
    const initialContext = [filePath];
    const windows = this.visitNode(tree.rootNode, initialContext);
    return this.windowsToChunks(windows, filePath, language);
  }
  /**
   * 公开的纯文本分片接口
   *
   * 用于不支持 AST 解析的语言，或作为 AST 解析失败时的降级方案。
   * 使用 UTF-16 索引（JS 原生字符串），按行切分。
   *
   * @param code 源代码字符串
   * @param filePath 文件路径
   * @param language 语言标识
   * @returns 处理后的分片数组
   */
  splitPlainText(code, filePath, language) {
    return this.fallbackSplit(code, filePath, language);
  }
  /**
   * 降级分片：当索引域不明确时使用
   *
   * 使用 UTF-16 索引（JS 原生字符串），按行切分
   * 注意：fallback 模式不支持 overlap
   */
  fallbackSplit(code, filePath, language) {
    const adapter = new SourceAdapter({
      code,
      endIndex: code.length
    });
    const totalSize = adapter.getTotalNws();
    if (totalSize <= this.config.maxChunkSize) {
      return [
        {
          displayCode: code,
          vectorText: `// Context: ${filePath}
${code}`,
          nwsSize: totalSize,
          metadata: {
            startIndex: 0,
            endIndex: code.length,
            rawSpan: { start: 0, end: code.length },
            vectorSpan: { start: 0, end: code.length },
            filePath,
            language,
            contextPath: [filePath]
          }
        }
      ];
    }
    const lines = code.split("\n");
    const chunks = [];
    let currentLines = [];
    let currentSize = 0;
    let lineStartIndex = 0;
    let chunkStartIndex = 0;
    let chunkRawStart = 0;
    for (const line of lines) {
      const lineEndIndex = lineStartIndex + line.length;
      const lineNws = adapter.nws(lineStartIndex, lineEndIndex);
      if (currentSize + lineNws > this.config.maxChunkSize && currentLines.length > 0) {
        const displayCode = currentLines.join("\n");
        const chunkEndIndex = chunkStartIndex + displayCode.length;
        chunks.push({
          displayCode,
          vectorText: `// Context: ${filePath}
${displayCode}`,
          nwsSize: currentSize,
          metadata: {
            startIndex: chunkStartIndex,
            endIndex: chunkEndIndex,
            rawSpan: { start: chunkRawStart, end: chunkEndIndex + 1 },
            // +1 for newline gap
            vectorSpan: { start: chunkStartIndex, end: chunkEndIndex },
            filePath,
            language,
            contextPath: [filePath]
          }
        });
        chunkRawStart = chunkEndIndex + 1;
        chunkStartIndex += displayCode.length + 1;
        currentLines = [line];
        currentSize = lineNws;
      } else {
        currentLines.push(line);
        currentSize += lineNws;
      }
      lineStartIndex = lineEndIndex + 1;
    }
    if (currentLines.length > 0) {
      const displayCode = currentLines.join("\n");
      const chunkEndIndex = chunkStartIndex + displayCode.length;
      chunks.push({
        displayCode,
        vectorText: `// Context: ${filePath}
${displayCode}`,
        nwsSize: currentSize,
        metadata: {
          startIndex: chunkStartIndex,
          endIndex: chunkEndIndex,
          rawSpan: { start: chunkRawStart, end: code.length },
          vectorSpan: { start: chunkStartIndex, end: chunkEndIndex },
          filePath,
          language,
          contextPath: [filePath]
        }
      });
    }
    return chunks;
  }
  /**
   * 递归遍历 AST 节点
   */
  visitNode(node, context) {
    const start = node.startIndex;
    const end = node.endIndex;
    const nodeSize = this.adapter.nws(start, end);
    let nextContext = context;
    const spec = getLanguageSpec(this.language);
    if (spec?.hierarchy.has(node.type)) {
      const name = this.extractNodeName(node, spec);
      if (name) {
        const prefix = spec.prefixMap[node.type] ?? "";
        nextContext = [...context, `${prefix}${name}`];
      }
    }
    if (nodeSize <= this.config.maxChunkSize) {
      return [{ nodes: [node], size: nodeSize, contextPath: nextContext }];
    }
    const children = node.children;
    if (children.length === 0) {
      return [{ nodes: [node], size: nodeSize, contextPath: nextContext }];
    }
    const childWindows = [];
    for (const child of children) {
      childWindows.push(...this.visitNode(child, nextContext));
    }
    return this.mergeAdjacentWindows(childWindows);
  }
  /**
   * 从节点中提取名称（数据驱动）
   */
  extractNodeName(node, spec) {
    for (const child of node.namedChildren) {
      if (spec.nameNodeTypes.has(child.type)) {
        return child.text;
      }
    }
    if (node.firstNamedChild) {
      const firstChild = node.firstNamedChild;
      if (firstChild.text.length <= 100 && !firstChild.text.includes("\n")) {
        return firstChild.text;
      }
    }
    return null;
  }
  /**
   * Gap-Aware 相邻窗口合并
   *
   * 使用三重预算策略：
   * - NWS 预算：控制有效代码量
   * - Raw 预算：控制物理字符数，防止大量注释撑爆 Token
   * - 语义边界惩罚：不同 contextPath 的窗口合并门槛更高
   *
   * 前向吸附策略：
   * - 如果当前窗口以 comment 结尾，将 comment 推到下一个窗口
   * - 保证 JSDoc/注释与其描述的代码在同一个 chunk
   */
  mergeAdjacentWindows(windows) {
    if (windows.length === 0) return [];
    const merged = [];
    let current = windows[0];
    for (let i = 1; i < windows.length; i++) {
      const next = windows[i];
      this.forwardAbsorbComments(current, next);
      if (current.nodes.length === 0) {
        current = next;
        continue;
      }
      const currentStart = current.nodes[0].startIndex;
      const currentEnd = current.nodes[current.nodes.length - 1].endIndex;
      const nextStart = next.nodes[0].startIndex;
      const nextEnd = next.nodes[next.nodes.length - 1].endIndex;
      const gapNws = this.adapter.nws(currentEnd, nextStart);
      const combinedNws = current.size + gapNws + next.size;
      const combinedRawLen = nextEnd - currentStart;
      const sameContext = this.isSameContext(current.contextPath, next.contextPath);
      const boundaryPenalty = sameContext ? 1 : 0.7;
      const isTiny = current.size < this.config.minChunkSize;
      const effectiveBudget = this.config.maxChunkSize * boundaryPenalty;
      const fitsNwsBudget = combinedNws <= effectiveBudget || isTiny && combinedNws < effectiveBudget * 1.5;
      const fitsRawBudget = combinedRawLen <= this.config.maxRawChars * boundaryPenalty;
      if (fitsNwsBudget && fitsRawBudget) {
        current.nodes.push(...next.nodes);
        current.size = combinedNws;
        if (next.contextPath.length > current.contextPath.length) {
          current.contextPath = next.contextPath;
        }
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
    return merged;
  }
  /**
   * 前向吸附：将 current 尾部的 comment 节点推到 next 头部
   *
   * 这确保 JSDoc/docstring/注释与其描述的函数/方法在同一个 chunk 中，
   * 而不是被切到前一个 chunk 的末尾。
   *
   * 注意：此方法会直接修改 current 和 next
   */
  forwardAbsorbComments(current, next) {
    const spec = getLanguageSpec(this.language);
    const commentTypes = spec?.commentTypes ?? /* @__PURE__ */ new Set(["comment"]);
    const absorbedNodes = [];
    let absorbedNws = 0;
    while (current.nodes.length > 0) {
      const lastNode = current.nodes[current.nodes.length - 1];
      if (commentTypes.has(lastNode.type)) {
        current.nodes.pop();
        const nodeNws = this.adapter.nws(lastNode.startIndex, lastNode.endIndex);
        absorbedNodes.unshift(lastNode);
        absorbedNws += nodeNws;
        current.size -= nodeNws;
      } else {
        break;
      }
    }
    if (absorbedNodes.length > 0) {
      const gapNws = next.nodes.length > 0 ? this.adapter.nws(
        absorbedNodes[absorbedNodes.length - 1].endIndex,
        next.nodes[0].startIndex
      ) : 0;
      next.nodes.unshift(...absorbedNodes);
      next.size += absorbedNws + gapNws;
    }
  }
  /**
   * 检查两个 contextPath 是否属于同一语义单元
   *
   * 规则：如果两者的公共前缀长度 >= 较短路径长度，认为是同一单元
   * 例如：
   * - ["file", "class A", "method foo"] 和 ["file", "class A", "method bar"] -> false（不同方法）
   * - ["file", "class A"] 和 ["file", "class A", "method foo"] -> true（父子关系）
   */
  isSameContext(a, b) {
    const minLen = Math.min(a.length, b.length);
    let commonLen = 0;
    for (let i = 0; i < minLen; i++) {
      if (a[i] === b[i]) {
        commonLen++;
      } else {
        break;
      }
    }
    return commonLen >= minLen;
  }
  /**
   * 将窗口转换为最终的 ProcessedChunk
   *
   * Gap 归属策略：gap 归属到后一个 chunk（即 chunk 的 rawSpan.start 向前延伸到前一个 chunk 的 endIndex）
   * Overlap 策略：vectorSpan 向前延伸 chunkOverlap 个 NWS 字符，提升语义检索召回率
   *
   * 保证：所有 rawSpan 拼接后 === 完整文件（不重叠）
   */
  windowsToChunks(windows, filePath, language) {
    if (windows.length === 0) return [];
    const chunks = [];
    let prevEnd = 0;
    const overlap = this.config.chunkOverlap;
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      const start = w.nodes[0].startIndex;
      const end = w.nodes[w.nodes.length - 1].endIndex;
      const isLast = i === windows.length - 1;
      const codeEndIndex = this.adapter.getDomain() === "utf8" ? Buffer.byteLength(this.code, "utf8") : this.code.length;
      const rawSpanEnd = isLast ? codeEndIndex : end;
      let vectorStart = start;
      if (i > 0 && overlap > 0) {
        const candidateStart = this.findOverlapStart(start, overlap);
        const overlapRawLen = start - candidateStart;
        if (overlapRawLen <= this.config.maxRawChars * 0.25) {
          vectorStart = candidateStart;
        }
      }
      const vectorEnd = end;
      const displayCode = this.adapter.slice(start, end);
      const vectorCode = this.adapter.slice(vectorStart, vectorEnd);
      const metadata = {
        startIndex: start,
        endIndex: end,
        rawSpan: { start: prevEnd, end: rawSpanEnd },
        vectorSpan: { start: vectorStart, end: vectorEnd },
        filePath,
        language,
        contextPath: w.contextPath
      };
      chunks.push({
        displayCode,
        vectorText: generateVectorText(vectorCode, w.contextPath),
        nwsSize: w.size,
        metadata
      });
      prevEnd = end;
    }
    return chunks;
  }
  /**
   * 找到 overlap 的起始位置
   *
   * 从 start 位置向前搜索，找到包含 targetNws 个非空白字符的位置
   *
   * @param start 当前 chunk 的起始位置
   * @param targetNws 目标 overlap 大小（NWS 字符数）
   * @returns overlap 起始位置
   */
  findOverlapStart(start, targetNws) {
    if (start <= 0 || targetNws <= 0) return start;
    let low = 0;
    let high = start;
    let result = start;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const nwsInRange = this.adapter.nws(mid, start);
      if (nwsInRange >= targetNws) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(0, result);
  }
};
function generateVectorText(code, contextPath) {
  const breadcrumb = contextPath.join(" > ");
  return `// Context: ${breadcrumb}
${code}`;
}

// src/utils/encoding.ts
import fs3 from "fs/promises";
import chardet from "chardet";
import iconv from "iconv-lite";
function normalizeEncoding(encoding) {
  const map = {
    "UTF-8": "utf8",
    "UTF-16 LE": "utf16le",
    "UTF-16 BE": "utf16be",
    "UTF-32 LE": "utf32le",
    "UTF-32 BE": "utf32be",
    GB18030: "gb18030",
    GBK: "gbk",
    GB2312: "gb2312",
    Big5: "big5",
    Shift_JIS: "shiftjis",
    "EUC-JP": "eucjp",
    "EUC-KR": "euckr",
    "ISO-8859-1": "iso88591",
    "windows-1252": "win1252",
    ASCII: "utf8"
    // ASCII 是 UTF-8 的子集
  };
  return map[encoding] || encoding.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function detectBOM(buffer) {
  if (buffer.length >= 3) {
    if (buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191) {
      return "UTF-8";
    }
  }
  if (buffer.length >= 4) {
    if (buffer[0] === 255 && buffer[1] === 254 && buffer[2] === 0 && buffer[3] === 0) {
      return "UTF-32 LE";
    }
    if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 254 && buffer[3] === 255) {
      return "UTF-32 BE";
    }
  }
  if (buffer.length >= 2) {
    if (buffer[0] === 255 && buffer[1] === 254) {
      return "UTF-16 LE";
    }
    if (buffer[0] === 254 && buffer[1] === 255) {
      return "UTF-16 BE";
    }
  }
  return null;
}
async function readFileWithEncoding(filePath) {
  const buffer = await fs3.readFile(filePath);
  const bom = detectBOM(buffer);
  let encoding = bom;
  if (!encoding) {
    const detected = chardet.detect(buffer);
    encoding = detected || "UTF-8";
  }
  const normalizedEncoding = normalizeEncoding(encoding);
  let content;
  try {
    if (iconv.encodingExists(normalizedEncoding)) {
      content = iconv.decode(buffer, normalizedEncoding);
    } else {
      content = buffer.toString("utf-8");
    }
  } catch {
    content = buffer.toString("utf-8");
  }
  return {
    content,
    encoding: "utf-8",
    // 输出始终是 UTF-8
    originalEncoding: encoding
  };
}

// src/scanner/hash.ts
import crypto from "crypto";
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// src/scanner/processor.ts
var MAX_FILE_SIZE = 100 * 1024;
var FALLBACK_LANGS = /* @__PURE__ */ new Set(["python", "go", "rust", "java", "markdown", "json"]);
function shouldSkipJson(relPath) {
  if (relPath.endsWith("-lock.json") || relPath.endsWith("package-lock.json")) {
    return true;
  }
  if (relPath.includes("node_modules/") || relPath.includes("node_modules\\")) {
    return true;
  }
  return false;
}
function getAdaptiveConcurrency() {
  const cpuCount = os.cpus().length;
  const concurrency = Math.max(4, Math.min(cpuCount - 1, 32));
  return concurrency;
}
var splitter = new SemanticSplitter({
  maxChunkSize: 500,
  minChunkSize: 50,
  chunkOverlap: 40
  // 混合检索(BM25+向量+rerank)下的保守 overlap
});
function classifySkipReason(options) {
  if (options.status === "error") {
    return "processing_error";
  }
  if (options.status === "added" || options.status === "modified") {
    if (options.chunks.length === 0) {
      return "no_indexable_chunks";
    }
    return void 0;
  }
  if (options.status !== "skipped") {
    return void 0;
  }
  const message = options.error ?? "";
  if (message.startsWith("File too large")) {
    return "large_file";
  }
  if (message.startsWith("Binary file detected")) {
    return "binary_file";
  }
  if (message === "Lock file or node_modules JSON") {
    return "ignored_json";
  }
  return "processing_error";
}
async function processFile(absPath, relPath, known) {
  const language = getLanguage(relPath);
  try {
    const stat = await fs4.stat(absPath);
    const mtime = stat.mtimeMs;
    const size = stat.size;
    if (size > MAX_FILE_SIZE) {
      return {
        absPath,
        relPath,
        hash: "",
        content: null,
        chunks: [],
        language,
        mtime,
        size,
        status: "skipped",
        error: `File too large (${size} bytes > ${MAX_FILE_SIZE} bytes)`,
        skipReason: "large_file"
      };
    }
    if (known && known.mtime === mtime && known.size === size) {
      return {
        absPath,
        relPath,
        hash: known.hash,
        content: null,
        chunks: [],
        language,
        mtime,
        size,
        status: "unchanged"
      };
    }
    const { content, originalEncoding } = await readFileWithEncoding(absPath);
    if (content.includes("\0")) {
      return {
        absPath,
        relPath,
        hash: "",
        content: null,
        chunks: [],
        language,
        mtime,
        size,
        status: "skipped",
        error: `Binary file detected (original encoding: ${originalEncoding})`,
        skipReason: "binary_file"
      };
    }
    const hash = sha256(content);
    if (known && known.hash === hash) {
      return {
        absPath,
        relPath,
        hash,
        content,
        chunks: [],
        language,
        mtime,
        size,
        status: "unchanged"
      };
    }
    if (language === "json" && shouldSkipJson(relPath)) {
      return {
        absPath,
        relPath,
        hash,
        content: null,
        chunks: [],
        language,
        mtime,
        size,
        status: "skipped",
        error: "Lock file or node_modules JSON",
        skipReason: "ignored_json"
      };
    }
    let chunks = [];
    if (isLanguageSupported(language)) {
      try {
        const parser = await getParser(language);
        if (parser) {
          const tree = parser.parse(content);
          chunks = splitter.split(tree, content, relPath, language);
        }
      } catch (err) {
        const error = err;
        console.warn(`[Chunking] AST failed for ${relPath}: ${error.message}`);
      }
    }
    if (chunks.length === 0 && FALLBACK_LANGS.has(language)) {
      chunks = splitter.splitPlainText(content, relPath, language);
    }
    const status = known ? "modified" : "added";
    return {
      absPath,
      relPath,
      hash,
      content,
      chunks,
      language,
      mtime,
      size,
      status,
      skipReason: classifySkipReason({ status, chunks })
    };
  } catch (err) {
    const error = err;
    return {
      absPath,
      relPath,
      hash: "",
      content: null,
      chunks: [],
      language,
      mtime: 0,
      size: 0,
      status: "error",
      error: error.message,
      skipReason: "processing_error"
    };
  }
}
async function processFiles(rootPath, filePaths, knownFiles) {
  const concurrency = getAdaptiveConcurrency();
  const limit = pLimit(concurrency);
  const tasks = filePaths.map((filePath) => {
    const relPath = path3.relative(rootPath, filePath).replace(/\\/g, "/");
    const known = knownFiles.get(relPath);
    return limit(() => processFile(filePath, relPath, known));
  });
  return Promise.all(tasks);
}

// src/scanner/index.ts
var ScanStageError = class extends Error {
  stage;
  partialStats;
  constructor(stage, message, partialStats, options) {
    super(message, options);
    this.name = "ScanStageError";
    this.stage = stage;
    this.partialStats = partialStats;
  }
};
function reportStageProgress(onProgress, options) {
  onProgress?.(options.current, options.total, `\u9636\u6BB5 ${options.stage}: ${options.detail}`);
}
function incrementSkipBucket(skippedByReason, bucket) {
  if (!bucket) {
    return;
  }
  skippedByReason[bucket] = (skippedByReason[bucket] ?? 0) + 1;
}
function isNoIndexableChunkResult(result) {
  return (result.status === "added" || result.status === "modified") && result.skipReason === "no_indexable_chunks";
}
function buildScanStats(fileCount, results, deletedPaths, visibility) {
  const skippedByReason = {};
  let skipped = 0;
  for (const result of results) {
    if (result.status === "skipped" || result.status === "error" || isNoIndexableChunkResult(result)) {
      skipped += 1;
      incrementSkipBucket(skippedByReason, result.skipReason);
    }
  }
  return {
    totalFiles: fileCount,
    added: results.filter((r) => r.status === "added").length,
    modified: results.filter((r) => r.status === "modified").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    deleted: deletedPaths.length,
    skipped,
    errors: results.filter((r) => r.status === "error").length,
    skippedByReason,
    visibility: {
      candidateFiles: fileCount,
      processedFiles: results.length,
      embeddingFiles: 0,
      selfHealFiles: 0,
      deletedPaths: deletedPaths.length,
      ...visibility
    }
  };
}
function asScanStageError(stage, error, partialStats) {
  if (error instanceof ScanStageError) {
    return error;
  }
  const source = error;
  return new ScanStageError(stage, source.message || "\u672A\u77E5\u9519\u8BEF", partialStats, {
    cause: error
  });
}
async function scan(rootPath, options = {}) {
  const projectId = generateProjectId(rootPath);
  const db = initDb(projectId);
  try {
    await initFilter(rootPath);
    let forceReindex = options.force ?? false;
    if (options.vectorIndex !== false) {
      const currentDimensions = getEmbeddingConfig().dimensions;
      const storedDimensions = getStoredEmbeddingDimensions(db);
      if (storedDimensions !== null && storedDimensions !== currentDimensions) {
        logger.warn(
          { stored: storedDimensions, current: currentDimensions },
          "Embedding \u7EF4\u5EA6\u53D8\u5316\uFF0C\u5F3A\u5236\u91CD\u65B0\u7D22\u5F15"
        );
        forceReindex = true;
      }
      setStoredEmbeddingDimensions(db, currentDimensions);
    }
    if (forceReindex) {
      clear(db);
      if (options.vectorIndex !== false) {
        const embeddingConfig = getEmbeddingConfig();
        const indexer = await getIndexer(projectId, embeddingConfig.dimensions);
        await indexer.clear();
      }
    }
    const knownFiles = getAllFileMeta(db);
    let filePaths;
    try {
      filePaths = options.precomputedFilePaths ?? (await crawl(rootPath)).filePaths;
    } catch (error) {
      throw asScanStageError("crawl", error, buildScanStats(0, [], []));
    }
    reportStageProgress(options.onProgress, {
      current: 5,
      total: 100,
      stage: "crawl",
      detail: `\u53D1\u73B0 ${filePaths.length} \u4E2A\u5019\u9009\u6587\u4EF6`
    });
    const scannedPaths = new Set(
      filePaths.map((p) => path4.relative(rootPath, p).replace(/\\/g, "/"))
    );
    const results = [];
    const batchSize = 100;
    try {
      for (let i = 0; i < filePaths.length; i += batchSize) {
        const batch = filePaths.slice(i, i + batchSize);
        const batchResults = await processFiles(rootPath, batch, knownFiles);
        results.push(...batchResults);
        reportStageProgress(options.onProgress, {
          current: 10 + Math.floor(results.length / Math.max(filePaths.length, 1) * 30),
          total: 100,
          stage: "process",
          detail: `\u5DF2\u5904\u7406 ${results.length}/${filePaths.length} \u4E2A\u6587\u4EF6`
        });
      }
    } catch (error) {
      throw asScanStageError("process", error, buildScanStats(filePaths.length, results, []));
    }
    const toAdd = [];
    const toUpdateMtime = [];
    const deletedPaths = [];
    for (const result of results) {
      switch (result.status) {
        case "added":
        case "modified":
          toAdd.push({
            path: result.relPath,
            hash: result.hash,
            mtime: result.mtime,
            size: result.size,
            content: result.content,
            language: result.language,
            vectorIndexHash: null
            // 新文件/修改的文件需要重新索引
          });
          break;
        case "unchanged":
          toUpdateMtime.push({ path: result.relPath, mtime: result.mtime });
          break;
        case "skipped":
          logger.debug({ path: result.relPath, reason: result.error }, "\u8DF3\u8FC7\u6587\u4EF6");
          break;
        case "error":
          logger.error({ path: result.relPath, error: result.error }, "\u5904\u7406\u6587\u4EF6\u9519\u8BEF");
          break;
      }
    }
    const allIndexedPaths = getAllPaths(db);
    for (const indexedPath of allIndexedPaths) {
      const normalizedIndexedPath = indexedPath.replace(/\\/g, "/");
      if (!scannedPaths.has(normalizedIndexedPath)) {
        deletedPaths.push(indexedPath);
      }
    }
    let stats = buildScanStats(filePaths.length, results, deletedPaths);
    try {
      reportStageProgress(options.onProgress, {
        current: 75,
        total: 100,
        stage: "persist",
        detail: "\u6B63\u5728\u540C\u6B65 SQLite / LanceDB / FTS"
      });
      batchUpsert(db, toAdd);
      batchUpdateMtime(db, toUpdateMtime);
      batchDelete(db, deletedPaths);
    } catch (error) {
      throw asScanStageError("persist", error, stats);
    }
    stats = {
      ...stats,
      visibility: {
        ...stats.visibility,
        candidateFiles: filePaths.length,
        processedFiles: results.length,
        deletedPaths: deletedPaths.length
      }
    };
    if (options.vectorIndex !== false) {
      const embeddingConfig = getEmbeddingConfig();
      const indexer = await getIndexer(projectId, embeddingConfig.dimensions);
      const needsVectorIndex = results.filter(
        (r) => r.status === "added" || r.status === "modified"
      );
      const healingPathSet = new Set(getFilesNeedingVectorIndex(db));
      const healingFilePaths = results.filter((r) => r.status === "unchanged" && healingPathSet.has(r.relPath)).map((r) => r.absPath);
      const hasVectorWorkCandidates = needsVectorIndex.length > 0 || deletedPaths.length > 0 || healingFilePaths.length > 0;
      if (hasVectorWorkCandidates) {
        reportStageProgress(options.onProgress, {
          current: 45,
          total: 100,
          stage: "chunk/embed",
          detail: `\u5F85\u5D4C\u5165 ${needsVectorIndex.length} \u4E2A\u6587\u4EF6`
        });
      }
      let healingFiles = [];
      if (healingFilePaths.length > 0) {
        let processedHealingFiles;
        try {
          processedHealingFiles = await processFiles(rootPath, healingFilePaths, /* @__PURE__ */ new Map());
        } catch (error) {
          throw asScanStageError("process", error, stats);
        }
        const healingIndexableCount = processedHealingFiles.filter(
          (r) => (r.status === "added" || r.status === "modified") && r.chunks.length > 0
        ).length;
        const healingSkippedCount = processedHealingFiles.filter(
          (r) => (r.status === "added" || r.status === "modified") && r.chunks.length === 0
        ).length;
        if (healingIndexableCount > 0) {
          logger.info({ count: healingIndexableCount }, "\u81EA\u6108\uFF1A\u53D1\u73B0\u9700\u8981\u8865\u7D22\u5F15\u7684\u6587\u4EF6");
        }
        if (healingSkippedCount > 0) {
          logger.info({ count: healingSkippedCount }, "\u81EA\u6108\uFF1A\u6587\u4EF6\u65E0\u53EF\u7D22\u5F15 chunk\uFF0C\u6807\u8BB0\u4E3A\u8DF3\u8FC7");
        }
        healingFiles = processedHealingFiles.filter((r) => r.status === "added" || r.status === "modified").map((r) => ({ ...r, status: "modified" }));
        stats = buildScanStats(
          filePaths.length,
          [...results, ...processedHealingFiles],
          deletedPaths,
          {
            candidateFiles: filePaths.length,
            processedFiles: results.length,
            embeddingFiles: stats.visibility.embeddingFiles,
            selfHealFiles: healingFiles.length,
            deletedPaths: deletedPaths.length
          }
        );
      }
      const deletedResults = deletedPaths.map((path5) => ({
        absPath: "",
        relPath: path5,
        hash: "",
        content: null,
        chunks: [],
        language: "",
        mtime: 0,
        size: 0,
        status: "deleted"
      }));
      const allToIndex = [...needsVectorIndex, ...healingFiles, ...deletedResults];
      if (allToIndex.length > 0) {
        stats = {
          ...stats,
          visibility: {
            ...stats.visibility,
            embeddingFiles: allToIndex.filter(
              (r) => (r.status === "added" || r.status === "modified") && r.chunks.length > 0
            ).length,
            selfHealFiles: healingFiles.length,
            deletedPaths: deletedPaths.length
          }
        };
        try {
          const embeddingFileCount = allToIndex.filter(
            (r) => (r.status === "added" || r.status === "modified") && r.chunks.length > 0
          ).length;
          if (embeddingFileCount > 0) {
            reportStageProgress(options.onProgress, {
              current: 45,
              total: 100,
              stage: "chunk/embed",
              detail: `\u5F85\u5D4C\u5165 ${embeddingFileCount} \u4E2A\u6587\u4EF6`
            });
          } else {
            reportStageProgress(options.onProgress, {
              current: 75,
              total: 100,
              stage: "persist",
              detail: "\u6B63\u5728\u540C\u6B65 SQLite / LanceDB / FTS"
            });
          }
          const indexStats = await indexer.indexFiles(db, allToIndex, (completed, total) => {
            const progress = 45 + Math.floor(completed / total * 54);
            reportStageProgress(options.onProgress, {
              current: progress,
              total: 100,
              stage: "chunk/embed",
              detail: `\u5DF2\u5B8C\u6210 ${completed}/${total} \u4E2A\u6279\u6B21`
            });
          });
          stats.vectorIndex = {
            indexed: indexStats.indexed,
            deleted: indexStats.deleted,
            errors: indexStats.errors
          };
        } catch (err) {
          const error = err;
          if ((error.message || "").includes("\u5411\u91CF\u5D4C\u5165\u9636\u6BB5\u5931\u8D25")) {
            throw asScanStageError("chunk/embed", err, stats);
          }
          throw asScanStageError(
            "chunk/embed",
            new Error(`\u5411\u91CF\u5D4C\u5165\u9636\u6BB5\u5931\u8D25: ${error.message || "\u672A\u77E5\u9519\u8BEF"}`),
            stats
          );
        }
      }
    }
    options.onProgress?.(100, 100, "\u7D22\u5F15\u5B8C\u6210");
    return stats;
  } finally {
    closeDb(db);
    closeAllIndexers();
    await closeAllVectorStores();
  }
}

export {
  getRecommendedProjectConfigTemplate,
  stringifyProjectConfig,
  formatProjectIndexingScope,
  loadProjectConfig,
  initFilter,
  crawl,
  ScanStageError,
  scan
};
//# sourceMappingURL=chunk-GYK2PYHT.js.map