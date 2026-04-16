import {
  getIndexer,
  getVectorStore,
  sleep
} from "./chunk-WQHSYTJN.js";
import {
  initDb,
  isChunksFtsInitialized,
  isFtsInitialized,
  searchChunksFts,
  searchFilesFts,
  segmentQuery
} from "./chunk-35HO3GPM.js";
import {
  isDebugEnabled,
  logger
} from "./chunk-44FXLQ5V.js";
import {
  getEmbeddingConfig,
  getRerankerConfig
} from "./chunk-CA4WQHZS.js";

// src/api/reranker/transport.ts
async function requestRerank(config, requestBody) {
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || `HTTP ${response.status}`;
    throw new Error(`Rerank API \u9519\u8BEF: ${errorMsg}`);
  }
  return data;
}

// src/api/reranker/client.ts
var RerankerClient = class {
  config;
  constructor(config) {
    this.config = config || getRerankerConfig();
  }
  async rerank(query, documents, options = {}) {
    if (documents.length === 0) {
      return [];
    }
    const { topN = this.config.topN, maxChunksPerDoc, chunkOverlap, retries = 3 } = options;
    const requestBody = {
      model: this.config.model,
      query,
      documents,
      top_n: Math.min(topN, documents.length),
      return_documents: false
    };
    if (maxChunksPerDoc !== void 0) {
      requestBody.max_chunks_per_doc = maxChunksPerDoc;
    }
    if (chunkOverlap !== void 0) {
      requestBody.overlap = chunkOverlap;
    }
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const data = await requestRerank(this.config, requestBody);
        const results = data.results.map((item) => ({
          originalIndex: item.index,
          score: item.relevance_score,
          text: documents[item.index]
        }));
        logger.debug(
          {
            query: query.slice(0, 50),
            inputCount: documents.length,
            outputCount: results.length
          },
          "Rerank \u5B8C\u6210"
        );
        return results;
      } catch (err) {
        const error = err;
        const isRateLimited = error.message?.includes("429") || error.message?.includes("rate");
        if (attempt < retries) {
          const delay = isRateLimited ? 1e3 * attempt : 500 * attempt;
          logger.warn(
            { attempt, maxRetries: retries, delay, error: error.message },
            "Rerank \u8BF7\u6C42\u5931\u8D25\uFF0C\u51C6\u5907\u91CD\u8BD5"
          );
          await sleep(delay);
        } else {
          logger.error(
            {
              error: error.message,
              stack: error.stack,
              query: query.slice(0, 50)
            },
            "Rerank \u8BF7\u6C42\u6700\u7EC8\u5931\u8D25"
          );
          throw err;
        }
      }
    }
    throw new Error("Rerank \u5904\u7406\u5F02\u5E38");
  }
  async rerankWithData(query, items, textExtractor, options = {}) {
    if (items.length === 0) {
      return [];
    }
    const texts = items.map(textExtractor);
    const results = await this.rerank(query, texts, options);
    return results.map((result) => ({
      ...result,
      data: items[result.originalIndex]
    }));
  }
  getConfig() {
    return { ...this.config };
  }
};
var defaultClient = null;
function getRerankerClient() {
  if (!defaultClient) {
    defaultClient = new RerankerClient();
  }
  return defaultClient;
}

// src/search/ContextPacker.ts
var ContextPacker = class {
  projectId;
  config;
  constructor(projectId, config) {
    this.projectId = projectId;
    this.config = config;
  }
  /**
   * 打包：合并 chunks → 按文件聚合段落 → 预算裁剪
   */
  async pack(chunks) {
    if (chunks.length === 0) return [];
    const byFile = this.groupByFile(chunks);
    const db = initDb(this.projectId);
    const result = [];
    let totalChars = 0;
    const sortedFiles = Object.entries(byFile).map(([filePath, fileChunks]) => ({
      filePath,
      chunks: fileChunks,
      maxScore: Math.max(...fileChunks.map((c) => c.score))
    })).sort((a, b) => b.maxScore - a.maxScore);
    const allFilePaths = sortedFiles.map((f) => f.filePath);
    const placeholders = allFilePaths.map(() => "?").join(",");
    const rows = db.prepare(`SELECT path, content FROM files WHERE path IN (${placeholders})`).all(...allFilePaths);
    const contentMap = new Map(rows.map((r) => [r.path, r.content]));
    for (const { filePath, chunks: fileChunks } of sortedFiles) {
      const content = contentMap.get(filePath);
      if (!content) continue;
      const segments = this.mergeAndSlice(fileChunks, content);
      const topSegments = segments.sort((a, b) => b.score - a.score).slice(0, this.config.maxSegmentsPerFile).sort((a, b) => a.rawStart - b.rawStart);
      const budgetedSegments = [];
      for (const seg of topSegments) {
        if (totalChars + seg.text.length > this.config.maxTotalChars) {
          break;
        }
        totalChars += seg.text.length;
        budgetedSegments.push(seg);
      }
      if (budgetedSegments.length > 0) {
        result.push({ filePath, segments: budgetedSegments });
      }
      if (totalChars >= this.config.maxTotalChars) break;
    }
    return result;
  }
  /**
   * 按文件分组
   */
  groupByFile(chunks) {
    const byFile = {};
    for (const chunk of chunks) {
      const key = chunk.filePath;
      if (!byFile[key]) byFile[key] = [];
      byFile[key].push(chunk);
    }
    return byFile;
  }
  /**
   * 合并重叠区间 + 从原文件切片
   */
  mergeAndSlice(chunks, content) {
    if (chunks.length === 0) return [];
    const sorted = [...chunks].sort((a, b) => a.record.raw_start - b.record.raw_start);
    const intervals = [];
    for (const chunk of sorted) {
      const start = chunk.record.raw_start;
      const end = chunk.record.raw_end;
      const last = intervals[intervals.length - 1];
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end);
        last.score = Math.max(last.score, chunk.score);
        last.chunks.push(chunk);
      } else {
        intervals.push({
          start,
          end,
          score: chunk.score,
          breadcrumb: chunk.record.breadcrumb,
          chunks: [chunk]
        });
      }
    }
    return intervals.map((iv) => {
      const startLine = this.offsetToLine(content, iv.start);
      const endLine = this.offsetToLine(content, iv.end);
      return {
        filePath: chunks[0].filePath,
        rawStart: iv.start,
        rawEnd: iv.end,
        startLine,
        endLine,
        score: iv.score,
        breadcrumb: iv.breadcrumb,
        text: content.slice(iv.start, iv.end)
      };
    });
  }
  /**
   * 将字符偏移量转换为行号（1-indexed）
   */
  offsetToLine(content, offset) {
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === "\n") {
        line++;
      }
    }
    return line;
  }
};

// src/search/config.ts
var DEFAULT_CONFIG = {
  // 召回
  vectorTopK: 80,
  vectorTopM: 60,
  ftsTopKFiles: 20,
  lexChunksPerFile: 2,
  lexTotalChunks: 40,
  // 融合
  rrfK0: 20,
  wVec: 0.6,
  wLex: 0.4,
  fusedTopM: 60,
  // Rerank
  rerankTopN: 10,
  maxRerankChars: 1e3,
  maxBreadcrumbChars: 250,
  headRatio: 0.67,
  // 扩展 (同文件充分展开，跨文件由 Agent 按需发起)
  neighborHops: 2,
  breadcrumbExpandLimit: 3,
  importFilesPerSeed: 0,
  chunksPerImportFile: 0,
  decayNeighbor: 0.8,
  decayBreadcrumb: 0.7,
  decayImport: 0.6,
  decayDepth: 0.7,
  // ContextPacker
  maxSegmentsPerFile: 3,
  maxTotalChars: 48e3,
  // Smart TopK
  enableSmartTopK: true,
  smartTopScoreRatio: 0.5,
  smartTopScoreDeltaAbs: 0.25,
  smartMinScore: 0.25,
  smartMinK: 2,
  smartMaxK: 8
};

// src/search/resolvers/types.ts
function commonPrefixLength(path1, path2) {
  const parts1 = path1.split("/");
  const parts2 = path2.split("/");
  let count = 0;
  for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
    if (parts1[i] === parts2[i]) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// src/search/resolvers/CppResolver.ts
var CPP_EXTENSIONS = /* @__PURE__ */ new Set([".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx"]);
var CppResolver = class {
  supports(filePath) {
    const ext = filePath.slice(filePath.lastIndexOf("."));
    return CPP_EXTENSIONS.has(ext);
  }
  extract(content) {
    const imports = [];
    const includePattern = /^\s*#\s*include\s+"([^"]+)"/gm;
    for (const match of content.matchAll(includePattern)) {
      imports.push(match[1]);
    }
    return imports;
  }
  resolve(importStr, currentFile, allFiles) {
    const currentDir = currentFile.split("/").slice(0, -1).join("/");
    const relativePath = currentDir ? `${currentDir}/${importStr}` : importStr;
    if (allFiles.has(relativePath)) {
      return relativePath;
    }
    const candidates = [];
    for (const file of allFiles) {
      if (file.endsWith(`/${importStr}`) || file === importStr) {
        candidates.push(file);
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    let bestCandidate = candidates[0];
    let bestPrefixLen = commonPrefixLength(currentFile, bestCandidate);
    for (let i = 1; i < candidates.length; i++) {
      const prefixLen = commonPrefixLength(currentFile, candidates[i]);
      if (prefixLen > bestPrefixLen) {
        bestPrefixLen = prefixLen;
        bestCandidate = candidates[i];
      }
    }
    return bestCandidate;
  }
};

// src/search/resolvers/CSharpResolver.ts
var CSharpResolver = class {
  supports(filePath) {
    return filePath.endsWith(".cs");
  }
  extract(content) {
    const imports = [];
    const pattern = /^\s*using\s+(?!static\s)(?!global\s)(?:\w+\s*=\s*)?([\w.]+);/gm;
    for (const match of content.matchAll(pattern)) {
      imports.push(match[1]);
    }
    return imports;
  }
  resolve(importStr, currentFile, allFiles) {
    const namespacePath = importStr.replace(/\./g, "/");
    const suffix = `/${namespacePath}.cs`;
    const candidates = [];
    for (const filePath of allFiles) {
      if (filePath.endsWith(suffix)) {
        candidates.push(filePath);
      }
    }
    if (candidates.length === 0) {
      const parts = importStr.split(".");
      const typeName = parts[parts.length - 1];
      const typeSuffix = `/${typeName}.cs`;
      for (const filePath of allFiles) {
        if (filePath.endsWith(typeSuffix)) {
          candidates.push(filePath);
        }
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    let bestCandidate = candidates[0];
    let bestPrefixLen = commonPrefixLength(currentFile, bestCandidate);
    for (let i = 1; i < candidates.length; i++) {
      const prefixLen = commonPrefixLength(currentFile, candidates[i]);
      if (prefixLen > bestPrefixLen) {
        bestPrefixLen = prefixLen;
        bestCandidate = candidates[i];
      }
    }
    return bestCandidate;
  }
};

// src/search/resolvers/GoResolver.ts
var GoResolver = class {
  supports(filePath) {
    return filePath.endsWith(".go");
  }
  extract(content) {
    const imports = [];
    const singlePattern = /^\s*import\s+"([^"]+)"/gm;
    for (const match of content.matchAll(singlePattern)) {
      imports.push(match[1]);
    }
    const blockPattern = /import\s*\(\s*([\s\S]*?)\s*\)/g;
    for (const match of content.matchAll(blockPattern)) {
      const block = match[1];
      const linePattern = /"([^"]+)"/g;
      for (const lineMatch of block.matchAll(linePattern)) {
        imports.push(lineMatch[1]);
      }
    }
    return imports;
  }
  resolve(importStr, _currentFile, allFiles) {
    if (!importStr.includes("/") && !importStr.includes(".")) {
      return null;
    }
    const suffix = `/${importStr}/`;
    const candidates = [];
    for (const filePath of allFiles) {
      if (filePath.endsWith(".go") && filePath.includes(suffix)) {
        candidates.push(filePath);
      }
    }
    if (candidates.length === 0) return null;
    const nonTest = candidates.find((f) => !f.endsWith("_test.go"));
    return nonTest || candidates[0];
  }
};

// src/search/resolvers/JavaResolver.ts
var JavaResolver = class {
  supports(filePath) {
    return filePath.endsWith(".java");
  }
  extract(content) {
    const imports = [];
    const pattern = /^\s*import\s+(?:static\s+)?([\w.]+);/gm;
    for (const match of content.matchAll(pattern)) {
      imports.push(match[1]);
    }
    return imports;
  }
  resolve(importStr, _currentFile, allFiles) {
    if (importStr.endsWith(".*")) {
      const pkgPath = importStr.slice(0, -2).replace(/\./g, "/");
      const suffix2 = `/${pkgPath}/`;
      for (const filePath of allFiles) {
        if (filePath.endsWith(".java") && filePath.includes(suffix2)) {
          return filePath;
        }
      }
      return null;
    }
    const classPath = importStr.replace(/\./g, "/");
    const suffix = `/${classPath}.java`;
    for (const filePath of allFiles) {
      if (filePath.endsWith(suffix)) {
        return filePath;
      }
    }
    return null;
  }
};

// src/search/resolvers/JsTsResolver.ts
var JsTsResolver = class {
  exts = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];
  // TypeScript ESM 项目使用 .js 扩展名导入，但源文件是 .ts
  extMapping = {
    ".js": [".ts", ".tsx", ".js", ".jsx"],
    ".jsx": [".tsx", ".jsx"],
    ".mjs": [".mts", ".mjs"],
    ".cjs": [".cts", ".cjs"]
  };
  supports(filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase();
    return this.exts.includes(`.${ext}` || "");
  }
  extract(content) {
    const imports = [];
    const patterns = [
      // import xxx from './foo' 或 import { xxx } from './foo'
      /(?:import|export)\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g,
      // import('./foo') 或 require('./foo')
      /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        imports.push(match[1]);
      }
    }
    return imports;
  }
  resolve(importStr, currentFile, allFiles) {
    if (!importStr.startsWith(".")) return null;
    const currentDir = currentFile.split("/").slice(0, -1).join("/");
    const parts = [...currentDir.split("/"), ...importStr.split("/")];
    const resolvedParts = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") resolvedParts.pop();
      else resolvedParts.push(part);
    }
    const basePath = resolvedParts.join("/");
    const existingExt = this.exts.find((ext) => basePath.endsWith(ext));
    if (existingExt) {
      const basePathWithoutExt = basePath.slice(0, -existingExt.length);
      const mappedExts = this.extMapping[existingExt] || [existingExt];
      for (const mappedExt of mappedExts) {
        const mappedPath = basePathWithoutExt + mappedExt;
        if (allFiles.has(mappedPath)) return mappedPath;
      }
      return null;
    }
    for (const ext of this.exts) {
      const pathWithExt = basePath + ext;
      if (allFiles.has(pathWithExt)) return pathWithExt;
    }
    for (const ext of this.exts) {
      const indexPath = `${basePath}/index${ext}`;
      if (allFiles.has(indexPath)) return indexPath;
    }
    return null;
  }
};

// src/search/resolvers/PythonResolver.ts
var PythonResolver = class {
  supports(filePath) {
    return filePath.endsWith(".py");
  }
  extract(content) {
    const pattern = /^\s*(?:from\s+(\.{0,3}[\w.]*)\s+import|import\s+([\w.]+))/gm;
    const imports = [];
    for (const match of content.matchAll(pattern)) {
      const importStr = match[1] || match[2];
      if (importStr) {
        imports.push(importStr);
      }
    }
    return imports;
  }
  resolve(importStr, currentFile, allFiles) {
    if (importStr.startsWith(".")) {
      return this.resolveRelativeImport(importStr, currentFile, allFiles);
    }
    return this.resolveAbsoluteImport(importStr, currentFile, allFiles);
  }
  /**
   * 解析 Python 相对导入
   * - from . import foo -> 当前目录的 foo.py 或 foo/__init__.py
   * - from .. import bar -> 父目录的 bar.py 或 bar/__init__.py
   * - from ..utils import baz -> 父目录的 utils.py 或 utils/baz.py
   */
  resolveRelativeImport(importStr, currentFile, allFiles) {
    const dotMatch = importStr.match(/^(\.+)/);
    if (!dotMatch) return null;
    const dotCount = dotMatch[1].length;
    const rest = importStr.slice(dotCount);
    const currentParts = currentFile.split("/");
    currentParts.pop();
    const targetDirParts = currentParts.slice(0, currentParts.length - (dotCount - 1));
    if (targetDirParts.length < 0) return null;
    const modulePath = rest.replace(/\./g, "/");
    const basePath = targetDirParts.join("/");
    const candidates = [];
    if (modulePath) {
      candidates.push(`${basePath}/${modulePath}.py`, `${basePath}/${modulePath}/__init__.py`);
    } else {
      candidates.push(`${basePath}/__init__.py`);
    }
    for (const candidate of candidates) {
      if (allFiles.has(candidate)) {
        return candidate;
      }
    }
    return null;
  }
  /**
   * 解析 Python 绝对导入 (后缀模糊匹配 + 路径前缀歧义消解)
   * - from my.pkg import xxx -> 找到以 /my/pkg.py 或 /my/pkg/__init__.py 结尾的文件
   * - 如果有多个匹配，优先选择与当前文件路径前缀重叠最多的
   */
  resolveAbsoluteImport(importStr, currentFile, allFiles) {
    const modulePath = importStr.replace(/\./g, "/");
    const suffixes = [`/${modulePath}.py`, `/${modulePath}/__init__.py`];
    const candidates = [];
    for (const filePath of allFiles) {
      for (const suffix of suffixes) {
        if (filePath.endsWith(suffix)) {
          const boundaryIndex = filePath.length - suffix.length;
          if (boundaryIndex <= 0 || filePath[boundaryIndex - 1] === "/") {
            candidates.push(filePath);
            break;
          }
        }
      }
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const currentDir = currentFile.split("/").slice(0, -1).join("/");
    candidates.sort((a, b) => {
      const overlapA = commonPrefixLength(a, currentDir);
      const overlapB = commonPrefixLength(b, currentDir);
      return overlapB - overlapA;
    });
    return candidates[0];
  }
};

// src/search/resolvers/RustResolver.ts
var RustResolver = class {
  supports(filePath) {
    return filePath.endsWith(".rs");
  }
  extract(content) {
    const imports = [];
    const modPattern = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
    for (const match of content.matchAll(modPattern)) {
      imports.push(`mod:${match[1]}`);
    }
    const usePattern = /^\s*(?:pub\s+)?use\s+((?:crate|super|self)(?:::\w+)+)/gm;
    for (const match of content.matchAll(usePattern)) {
      imports.push(`use:${match[1]}`);
    }
    return imports;
  }
  resolve(importStr, currentFile, allFiles) {
    const currentDir = currentFile.split("/").slice(0, -1).join("/");
    if (importStr.startsWith("mod:")) {
      const modName = importStr.slice(4);
      const candidates = [`${currentDir}/${modName}.rs`, `${currentDir}/${modName}/mod.rs`];
      for (const candidate of candidates) {
        if (allFiles.has(candidate)) {
          return candidate;
        }
      }
      return null;
    }
    if (importStr.startsWith("use:")) {
      const usePath = importStr.slice(4);
      const parts = usePath.split("::");
      let baseParts;
      let startIndex;
      if (parts[0] === "crate") {
        const srcIndex = currentFile.indexOf("/src/");
        if (srcIndex !== -1) {
          baseParts = currentFile.slice(0, srcIndex + 4).split("/");
        } else {
          baseParts = currentDir.split("/");
        }
        startIndex = 1;
      } else if (parts[0] === "super") {
        baseParts = currentDir.split("/").slice(0, -1);
        startIndex = 1;
      } else if (parts[0] === "self") {
        baseParts = currentDir.split("/");
        startIndex = 1;
      } else {
        return null;
      }
      const moduleParts = parts.slice(startIndex);
      const modulePath = [...baseParts, ...moduleParts].join("/");
      const candidates = [`${modulePath}.rs`, `${modulePath}/mod.rs`];
      for (const candidate of candidates) {
        if (allFiles.has(candidate)) {
          return candidate;
        }
      }
      return null;
    }
    return null;
  }
};

// src/search/resolvers/index.ts
function createResolvers() {
  return [
    new JsTsResolver(),
    new PythonResolver(),
    new GoResolver(),
    new JavaResolver(),
    new RustResolver(),
    new CppResolver(),
    new CSharpResolver()
  ];
}

// src/search/GraphExpander.ts
var GraphExpander = class {
  projectId;
  config;
  vectorStore = null;
  db = null;
  // 缓存所有文件路径 (用于快速查找和模糊匹配)
  allFilePaths = null;
  // 注册解析器（按优先级排列）
  resolvers = createResolvers();
  constructor(projectId, config) {
    this.projectId = projectId;
    this.config = config;
  }
  async init() {
    const embeddingConfig = getEmbeddingConfig();
    this.vectorStore = await getVectorStore(this.projectId, embeddingConfig.dimensions);
    this.db = initDb(this.projectId);
  }
  /**
   * 加载文件索引 (Lazy Load)
   * 相比反复查 DB，一次性加载所有路径到 Set 内存占用极低且速度极快
   */
  loadFileIndex() {
    if (this.allFilePaths) return;
    if (!this.db) this.db = initDb(this.projectId);
    const rows = this.db.prepare("SELECT path FROM files").all();
    this.allFilePaths = new Set(rows.map((r) => r.path));
    logger.debug({ count: this.allFilePaths.size }, "GraphExpander: \u6587\u4EF6\u7D22\u5F15\u5DF2\u52A0\u8F7D");
  }
  /**
   * 使文件索引失效（用于增量索引后刷新）
   */
  invalidateFileIndex() {
    this.allFilePaths = null;
  }
  /**
   * 扩展 seed chunks
   */
  async expand(seeds, queryTokens) {
    if (!this.vectorStore || !this.db) {
      await this.init();
    }
    this.loadFileIndex();
    const stats = {
      neighborCount: 0,
      breadcrumbCount: 0,
      importCount: 0,
      importDepth1Count: 0
    };
    if (seeds.length === 0) {
      return { chunks: [], stats };
    }
    const existingKeys = new Set(seeds.map((s) => this.getChunkKey(s)));
    const expandedChunks = [];
    const seedsByFile = this.groupByFile(seeds);
    const neighborChunks = await this.expandNeighbors(seedsByFile, existingKeys);
    this.addChunks(neighborChunks, expandedChunks, existingKeys);
    stats.neighborCount = neighborChunks.length;
    const breadcrumbChunks = await this.expandBreadcrumb(seeds, existingKeys);
    this.addChunks(breadcrumbChunks, expandedChunks, existingKeys);
    stats.breadcrumbCount = breadcrumbChunks.length;
    const importChunks = await this.expandImports(seeds, existingKeys, queryTokens, stats);
    this.addChunks(importChunks, expandedChunks, existingKeys);
    stats.importCount = importChunks.length;
    logger.debug(stats, "\u4E0A\u4E0B\u6587\u6269\u5C55\u5B8C\u6210");
    return { chunks: expandedChunks, stats };
  }
  /**
   * 添加 chunks 并更新去重集合
   */
  addChunks(newChunks, target, keys) {
    for (const chunk of newChunks) {
      const key = this.getChunkKey(chunk);
      if (!keys.has(key)) {
        keys.add(key);
        target.push(chunk);
      }
    }
  }
  // =========================================
  // E1: 同文件邻居扩展
  // =========================================
  /**
   * 扩展同文件邻居
   *
   * 对于每个 seed，获取其前后 ±neighborHops 个 chunks
   */
  async expandNeighbors(seedsByFile, existingKeys) {
    const result = [];
    const { neighborHops, decayNeighbor } = this.config;
    const allFilePaths = Array.from(seedsByFile.keys());
    const allChunksMap = await this.vectorStore?.getFilesChunks(allFilePaths);
    if (!allChunksMap) return result;
    for (const [filePath, fileSeeds] of seedsByFile) {
      const allChunks = allChunksMap.get(filePath) ?? [];
      if (allChunks.length === 0) continue;
      const sortedChunks = allChunks.sort((a, b) => a.chunk_index - b.chunk_index);
      const chunkMap = new Map(sortedChunks.map((c) => [c.chunk_index, c]));
      const seedIndices = new Set(fileSeeds.map((s) => s.chunkIndex));
      const neighborIndices = /* @__PURE__ */ new Set();
      for (const seed of fileSeeds) {
        const baseIndex = seed.chunkIndex;
        for (let delta = -neighborHops; delta <= neighborHops; delta++) {
          if (delta === 0) continue;
          const neighborIndex = baseIndex + delta;
          if (!seedIndices.has(neighborIndex) && chunkMap.has(neighborIndex)) {
            neighborIndices.add(neighborIndex);
          }
        }
      }
      for (const neighborIndex of neighborIndices) {
        const chunk = chunkMap.get(neighborIndex);
        if (!chunk) continue;
        const key = `${filePath}#${neighborIndex}`;
        if (existingKeys.has(key)) continue;
        let minDistance = Infinity;
        let maxSeedScore = 0;
        for (const seed of fileSeeds) {
          const distance = Math.abs(neighborIndex - seed.chunkIndex);
          if (distance < minDistance) {
            minDistance = distance;
            maxSeedScore = seed.score;
          } else if (distance === minDistance && seed.score > maxSeedScore) {
            maxSeedScore = seed.score;
          }
        }
        const decayedScore = maxSeedScore * decayNeighbor ** minDistance;
        result.push({
          filePath,
          chunkIndex: neighborIndex,
          score: decayedScore,
          source: "neighbor",
          record: { ...chunk, _distance: 0 }
        });
      }
    }
    return result;
  }
  // =========================================
  // E2: breadcrumb 补段
  // =========================================
  /**
   * 扩展 breadcrumb 补段
   *
   * 对于每个 seed，找到具有相同 breadcrumb 前缀的其他 chunks
   * 例如：如果 seed 的 breadcrumb 是 "src/foo.ts > class Foo > method bar"
   * 则会找到 "src/foo.ts > class Foo > ..." 的其他 chunks
   */
  async expandBreadcrumb(seeds, existingKeys) {
    const result = [];
    const { breadcrumbExpandLimit, decayBreadcrumb } = this.config;
    const prefixGroups = /* @__PURE__ */ new Map();
    for (const seed of seeds) {
      const prefix = this.extractBreadcrumbPrefix(seed.record.breadcrumb);
      if (!prefix) continue;
      if (!prefixGroups.has(prefix)) {
        prefixGroups.set(prefix, []);
      }
      prefixGroups.get(prefix)?.push(seed);
    }
    const uniqueFilePaths = /* @__PURE__ */ new Set();
    for (const prefixSeeds of prefixGroups.values()) {
      uniqueFilePaths.add(prefixSeeds[0].filePath);
    }
    const allChunksMap = await this.vectorStore?.getFilesChunks(Array.from(uniqueFilePaths));
    if (!allChunksMap) return result;
    for (const [prefix, prefixSeeds] of prefixGroups) {
      const filePath = prefixSeeds[0].filePath;
      const allChunks = allChunksMap.get(filePath) ?? [];
      const matchingChunks = allChunks.filter((chunk) => {
        const chunkPrefix = this.extractBreadcrumbPrefix(chunk.breadcrumb);
        return chunkPrefix === prefix;
      });
      const seedIndices = new Set(prefixSeeds.map((s) => s.chunkIndex));
      const newChunks = matchingChunks.filter((chunk) => !seedIndices.has(chunk.chunk_index)).filter((chunk) => !existingKeys.has(`${filePath}#${chunk.chunk_index}`)).slice(0, breadcrumbExpandLimit);
      const maxSeedScore = Math.max(...prefixSeeds.map((s) => s.score));
      for (const chunk of newChunks) {
        result.push({
          filePath,
          chunkIndex: chunk.chunk_index,
          score: maxSeedScore * decayBreadcrumb,
          source: "breadcrumb",
          record: { ...chunk, _distance: 0 }
        });
      }
    }
    return result;
  }
  /**
   * 提取 breadcrumb 的父级前缀
   *
   * 例如：
   * - "src/foo.ts > class Foo > method bar" → "src/foo.ts > class Foo"
   * - "src/foo.ts > function baz" → "src/foo.ts"
   * - "src/foo.ts" → null (没有父级)
   */
  extractBreadcrumbPrefix(breadcrumb) {
    const parts = breadcrumb.split(" > ");
    if (parts.length <= 1) return null;
    return parts.slice(0, -1).join(" > ");
  }
  // =========================================
  // E3: 跨文件引用解析（多语言支持）
  // =========================================
  /**
   * 扩展 import 关系
   *
   * 解析 seed 文件中的 import 语句，获取被导入文件的 chunks
   * 支持多语言：TypeScript/JavaScript, Python, Go, Java, Rust
   */
  async expandImports(seeds, existingKeys, queryTokens, stats) {
    const result = [];
    const { importFilesPerSeed, chunksPerImportFile, decayImport, decayDepth } = this.config;
    const seedScoreByFile = this.buildSeedScoreByFile(seeds);
    const queue = [];
    const visited = /* @__PURE__ */ new Set();
    for (const [filePath, seedScore] of seedScoreByFile.entries()) {
      queue.push({ filePath, depth: 0, seedScore });
    }
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { filePath, depth, seedScore } = item;
      if (visited.has(filePath)) continue;
      visited.add(filePath);
      if (depth > 0 && !this.isBarrelFile(filePath)) continue;
      const resolver = this.resolvers.find((r) => r.supports(filePath));
      if (!resolver) continue;
      const row = this.db?.prepare("SELECT content FROM files WHERE path = ?").get(filePath);
      if (!row?.content) continue;
      const importStrs = resolver.extract(row.content);
      if (importStrs.length === 0) continue;
      const perFileLimit = depth === 0 ? importFilesPerSeed : Math.min(importFilesPerSeed, 2);
      let importCount = 0;
      const processedImports = /* @__PURE__ */ new Set();
      for (const importStr of importStrs) {
        if (importCount >= perFileLimit) break;
        if (processedImports.has(importStr)) continue;
        processedImports.add(importStr);
        const targetPath = resolver.resolve(importStr, filePath, this.allFilePaths);
        if (!targetPath || targetPath === filePath) continue;
        const importChunks = await this.vectorStore?.getFileChunks(targetPath);
        if (!importChunks || importChunks.length === 0) continue;
        const selectedChunks = this.selectImportChunks(
          importChunks,
          chunksPerImportFile,
          queryTokens
        );
        const depthDecay = depth === 0 ? 1 : decayDepth;
        for (const chunk of selectedChunks) {
          const key = `${targetPath}#${chunk.chunk_index}`;
          if (existingKeys.has(key)) continue;
          result.push({
            filePath: targetPath,
            chunkIndex: chunk.chunk_index,
            score: seedScore * decayImport * depthDecay,
            source: "import",
            record: { ...chunk, _distance: 0 }
          });
        }
        importCount++;
        if (depth === 0 && this.isBarrelFile(targetPath)) {
          if (stats) stats.importDepth1Count++;
          queue.push({ filePath: targetPath, depth: 1, seedScore });
        }
      }
    }
    return result;
  }
  // =========================================
  // 工具方法
  // =========================================
  /**
   * 生成 chunk 唯一键
   */
  getChunkKey(chunk) {
    return `${chunk.filePath}#${chunk.chunkIndex}`;
  }
  /**
   * 按文件分组
   */
  groupByFile(chunks) {
    const groups = /* @__PURE__ */ new Map();
    for (const chunk of chunks) {
      if (!groups.has(chunk.filePath)) {
        groups.set(chunk.filePath, []);
      }
      groups.get(chunk.filePath)?.push(chunk);
    }
    return groups;
  }
  /**
   * 按文件汇总 seed 最大得分
   */
  buildSeedScoreByFile(seeds) {
    const map = /* @__PURE__ */ new Map();
    for (const seed of seeds) {
      const current = map.get(seed.filePath);
      if (current === void 0 || seed.score > current) {
        map.set(seed.filePath, seed.score);
      }
    }
    return map;
  }
  /**
   * 选择导入文件的 chunks（优先 query overlap）
   */
  selectImportChunks(chunks, limit, queryTokens) {
    if (limit <= 0) return [];
    const sortedByIndex = chunks.slice().sort((a, b) => a.chunk_index - b.chunk_index);
    if (!queryTokens || queryTokens.size === 0) {
      return sortedByIndex.slice(0, limit);
    }
    const scored = sortedByIndex.map((chunk) => ({
      chunk,
      score: this.scoreChunkTokenOverlap(chunk, queryTokens)
    }));
    const overlapped = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.chunk);
    return overlapped.length > 0 ? overlapped : sortedByIndex.slice(0, limit);
  }
  /**
   * 计算 chunk 与查询的 token overlap 得分
   */
  scoreChunkTokenOverlap(chunk, queryTokens) {
    const text = `${chunk.breadcrumb} ${chunk.display_code}`.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (text.includes(token)) {
        const wordBoundaryRegex = new RegExp(
          `\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
        );
        if (wordBoundaryRegex.test(text)) {
          score += 1;
        } else {
          score += 0.5;
        }
      }
    }
    return score;
  }
  /**
   * 判断是否为 barrel/index 文件
   */
  isBarrelFile(filePath) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith("/__init__.py")) return true;
    if (lower.endsWith("/mod.rs")) return true;
    return /\/index\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(lower);
  }
};
var expanders = /* @__PURE__ */ new Map();
async function getGraphExpander(projectId, config) {
  let expander = expanders.get(projectId);
  if (!expander) {
    expander = new GraphExpander(projectId, config);
    await expander.init();
    expanders.set(projectId, expander);
  }
  return expander;
}

// src/search/SearchService.ts
var tokenBoundaryRegexCache = /* @__PURE__ */ new Map();
function getTokenBoundaryRegex(token) {
  let regex = tokenBoundaryRegexCache.get(token);
  if (!regex) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(`\\b${escaped}\\b`);
    tokenBoundaryRegexCache.set(token, regex);
  }
  return regex;
}
var SearchService = class {
  projectId;
  indexer = null;
  vectorStore = null;
  db = null;
  config;
  constructor(projectId, _projectPath, config) {
    this.projectId = projectId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  async init() {
    const embeddingConfig = getEmbeddingConfig();
    this.indexer = await getIndexer(this.projectId, embeddingConfig.dimensions);
    this.vectorStore = await getVectorStore(this.projectId, embeddingConfig.dimensions);
    this.db = initDb(this.projectId);
  }
  // 公开接口
  /**
   * 构建上下文包（用于问答/生成）
   */
  async buildContextPack(query) {
    const timingMs = {};
    let t0 = Date.now();
    const candidates = await this.hybridRetrieve(query);
    timingMs.retrieve = Date.now() - t0;
    t0 = Date.now();
    const topM = candidates.sort((a, b) => b.score - a.score).slice(0, this.config.fusedTopM);
    const reranked = await this.rerank(query, topM);
    timingMs.rerank = Date.now() - t0;
    t0 = Date.now();
    const seeds = this.applySmartCutoff(reranked);
    timingMs.smartCutoff = Date.now() - t0;
    t0 = Date.now();
    const queryTokens = this.extractQueryTokens(query);
    const expanded = await this.expand(seeds, queryTokens);
    timingMs.expand = Date.now() - t0;
    t0 = Date.now();
    const packer = new ContextPacker(this.projectId, this.config);
    const files = await packer.pack([...seeds, ...expanded]);
    timingMs.pack = Date.now() - t0;
    return {
      query,
      seeds,
      expanded,
      files,
      debug: {
        wVec: this.config.wVec,
        wLex: this.config.wLex,
        timingMs
      }
    };
  }
  // 召回方法
  /**
   * 混合召回：向量 + 词法
   */
  async hybridRetrieve(query) {
    const [vectorResults, lexicalResults] = await Promise.all([
      this.vectorRetrieve(query),
      this.lexicalRetrieve(query)
    ]);
    logger.debug(
      {
        vectorCount: vectorResults.length,
        lexicalCount: lexicalResults.length
      },
      "\u6DF7\u5408\u53EC\u56DE\u5B8C\u6210"
    );
    if (lexicalResults.length === 0) {
      return vectorResults;
    }
    return this.fuse(vectorResults, lexicalResults);
  }
  /**
   * 向量召回
   */
  async vectorRetrieve(query) {
    if (!this.indexer) throw new Error("SearchService not initialized");
    const results = await this.indexer.textSearch(query, this.config.vectorTopK);
    if (!results) return [];
    return results.sort((a, b) => a._distance - b._distance).slice(0, this.config.vectorTopM).map((r, rank) => ({
      filePath: r.file_path,
      chunkIndex: r.chunk_index,
      score: 1 / (1 + r._distance),
      // 转为相似度（用于调试）
      source: "vector",
      record: r,
      _rank: rank
      // 用于 RRF
    }));
  }
  /**
   * 词法召回（FTS）
   *
   * 优先使用 chunk 级 FTS（更精准）
   * 如果 chunks_fts 不可用，降级到文件级 FTS + overlap 下钻
   */
  async lexicalRetrieve(query) {
    if (!this.db || !this.vectorStore) return [];
    if (isChunksFtsInitialized(this.db)) {
      return this.lexicalRetrieveFromChunksFts(query);
    }
    if (isFtsInitialized(this.db)) {
      return this.lexicalRetrieveFromFilesFts(query);
    }
    logger.debug("FTS \u672A\u521D\u59CB\u5316\uFF0C\u8DF3\u8FC7\u8BCD\u6CD5\u53EC\u56DE");
    return [];
  }
  /**
   * 从 chunks_fts 直接搜索（最优方案）
   */
  async lexicalRetrieveFromChunksFts(query) {
    const chunkResults = searchChunksFts(
      this.db,
      query,
      this.config.lexTotalChunks
    );
    if (chunkResults.length === 0) {
      logger.debug("Chunk FTS \u65E0\u547D\u4E2D");
      return [];
    }
    const allChunks = [];
    const fileChunksMap = /* @__PURE__ */ new Map();
    for (const result of chunkResults) {
      if (!fileChunksMap.has(result.filePath)) {
        fileChunksMap.set(result.filePath, /* @__PURE__ */ new Map());
      }
      fileChunksMap.get(result.filePath)?.set(result.chunkIndex, result.score);
    }
    const allFilePaths = Array.from(fileChunksMap.keys());
    const chunksMap = await this.vectorStore?.getFilesChunks(allFilePaths);
    if (!chunksMap) return allChunks;
    for (const [filePath, chunkScores] of fileChunksMap) {
      const chunks = chunksMap.get(filePath) ?? [];
      for (const chunk of chunks) {
        const score = chunkScores.get(chunk.chunk_index);
        if (score !== void 0) {
          allChunks.push({
            filePath: chunk.file_path,
            chunkIndex: chunk.chunk_index,
            score,
            source: "lexical",
            record: { ...chunk, _distance: 0 }
          });
        }
      }
    }
    logger.debug(
      {
        totalChunks: allChunks.length,
        filesWithChunks: fileChunksMap.size
      },
      "Chunk FTS \u53EC\u56DE\u5B8C\u6210"
    );
    return allChunks.sort((a, b) => b.score - a.score).map((chunk, rank) => ({ ...chunk, _rank: rank }));
  }
  /**
   * 从 files_fts 搜索 + overlap 下钻（降级方案）
   */
  async lexicalRetrieveFromFilesFts(query) {
    const fileResults = searchFilesFts(
      this.db,
      query,
      this.config.ftsTopKFiles
    );
    if (fileResults.length === 0) {
      logger.debug("FTS \u65E0\u547D\u4E2D\u6587\u4EF6");
      return [];
    }
    const queryTokens = this.extractQueryTokens(query);
    logger.debug(
      {
        fileCount: fileResults.length,
        queryTokens: Array.from(queryTokens).slice(0, 10)
      },
      "FTS \u53EC\u56DE\u5F00\u59CB chunk \u9009\u62E9"
    );
    const allChunks = [];
    let totalChunks = 0;
    let skippedFiles = 0;
    for (const { path: filePath, score: fileScore } of fileResults) {
      if (totalChunks >= this.config.lexTotalChunks) break;
      const chunks = await this.vectorStore?.getFileChunks(filePath);
      if (!chunks || chunks.length === 0) continue;
      const scoredChunks = chunks.map((chunk) => ({
        chunk,
        overlapScore: this.scoreChunkTokenOverlap(chunk, queryTokens)
      }));
      const maxOverlap = Math.max(...scoredChunks.map((c) => c.overlapScore));
      if (maxOverlap === 0) {
        skippedFiles++;
        continue;
      }
      const topChunks = scoredChunks.filter((c) => c.overlapScore > 0).sort((a, b) => b.overlapScore - a.overlapScore).slice(0, this.config.lexChunksPerFile);
      for (const { chunk, overlapScore } of topChunks) {
        if (totalChunks >= this.config.lexTotalChunks) break;
        const combinedScore = fileScore * (1 + overlapScore * 0.5);
        allChunks.push({
          filePath: chunk.file_path,
          chunkIndex: chunk.chunk_index,
          score: combinedScore,
          source: "lexical",
          record: { ...chunk, _distance: 0 }
        });
        totalChunks++;
      }
    }
    if (skippedFiles > 0) {
      logger.debug({ skippedFiles }, "FTS \u8DF3\u8FC7 overlap=0 \u7684\u6587\u4EF6");
    }
    logger.debug(
      {
        totalChunks: allChunks.length,
        filesWithChunks: new Set(allChunks.map((c) => c.filePath)).size
      },
      "FTS chunk \u9009\u62E9\u5B8C\u6210"
    );
    return allChunks.sort((a, b) => b.score - a.score).map((chunk, rank) => ({ ...chunk, _rank: rank }));
  }
  /**
   * 提取查询中的 tokens
   *
   * 直接复用 fts.ts 中的 segmentQuery，确保召回和评分逻辑一致
   */
  extractQueryTokens(query) {
    const tokens = segmentQuery(query);
    return new Set(tokens);
  }
  /**
   * 计算 chunk 与查询的 token overlap 得分
   *
   * 匹配策略：
   * - breadcrumb 和 display_code 都参与匹配
   * - 精确匹配得 1 分，子串匹配得 0.5 分
   */
  scoreChunkTokenOverlap(chunk, queryTokens) {
    const text = `${chunk.breadcrumb} ${chunk.display_code}`.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (text.includes(token)) {
        const regex = getTokenBoundaryRegex(token);
        if (regex.test(text)) {
          score += 1;
        } else {
          score += 0.5;
        }
      }
    }
    return score;
  }
  // =========================================
  // 融合方法
  // =========================================
  /**
   * RRF (Reciprocal Rank Fusion) 融合
   *
   * 公式: score = Σ w_i / (k + rank_i)
   * 其中 k 是平滑常数，rank 从 0 开始
   */
  fuse(vectorResults, lexicalResults) {
    const { rrfK0, wVec, wLex } = this.config;
    const fusedScores = /* @__PURE__ */ new Map();
    const getKey = (chunk) => `${chunk.filePath}#${chunk.chunkIndex}`;
    for (const result of vectorResults) {
      const key = getKey(result);
      const rank = result._rank ?? 0;
      const rrfScore = wVec / (rrfK0 + rank);
      const existing = fusedScores.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add("vector");
      } else {
        fusedScores.set(key, {
          score: rrfScore,
          chunk: result,
          sources: /* @__PURE__ */ new Set(["vector"])
        });
      }
    }
    for (const result of lexicalResults) {
      const key = getKey(result);
      const rank = result._rank ?? 0;
      const rrfScore = wLex / (rrfK0 + rank);
      const existing = fusedScores.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.sources.add("lexical");
      } else {
        fusedScores.set(key, {
          score: rrfScore,
          chunk: result,
          sources: /* @__PURE__ */ new Set(["lexical"])
        });
      }
    }
    const fused = Array.from(fusedScores.values()).map(({ score, chunk, sources }) => ({
      ...chunk,
      score,
      source: sources.size > 1 ? "vector" : chunk.source
      // 保留原始来源
    })).sort((a, b) => b.score - a.score);
    if (isDebugEnabled()) {
      logger.debug(
        {
          vectorCount: vectorResults.length,
          lexicalCount: lexicalResults.length,
          fusedCount: fused.length,
          bothSources: Array.from(fusedScores.values()).filter((v) => v.sources.size > 1).length
        },
        "RRF \u878D\u5408\u5B8C\u6210"
      );
    }
    return fused;
  }
  // Rerank 方法
  /**
   * Rerank
   */
  async rerank(query, candidates) {
    if (candidates.length === 0) return [];
    const reranker = getRerankerClient();
    const queryTokens = this.extractQueryTokens(query);
    const textExtractor = (chunk) => {
      const bc = this.truncateMiddle(chunk.record.breadcrumb, this.config.maxBreadcrumbChars);
      const budget = Math.max(0, this.config.maxRerankChars - bc.length - 1);
      const code = this.extractAroundHit(chunk.record.display_code, queryTokens, budget);
      return `${bc}
${code}`;
    };
    const reranked = await reranker.rerankWithData(query, candidates, textExtractor, {
      topN: this.config.rerankTopN
    });
    return reranked.filter((r) => r.data !== void 0).map((r) => ({
      ...r.data,
      score: r.score
    }));
  }
  // Smart TopK Cutoff
  /**
   * 智能截断策略（Anchor & Floor + Safe Harbor + Delta Guard）
   *
   * 核心逻辑：
   * 1. 低置信熔断：topScore < floor → 返回 top1（CLI 友好）或空
   * 2. 动态阈值：max(floor, min(ratioThreshold, deltaThreshold))
   * 3. Safe Harbor：前 minK 个只检查 floor，不检查 ratio/delta
   * 4. 去重 + 补齐：cutoff 后去重，不足 minK 时从后续补齐
   */
  applySmartCutoff(candidates) {
    if (!this.config.enableSmartTopK) {
      return candidates;
    }
    if (candidates.length === 0) return [];
    const sorted = candidates.slice().sort((a, b) => b.score - a.score);
    const {
      smartTopScoreRatio: ratio,
      smartTopScoreDeltaAbs: deltaAbs,
      smartMinScore: floor,
      smartMinK: minK,
      smartMaxK: maxK
    } = this.config;
    const topScore = sorted[0].score;
    if (topScore < floor) {
      logger.debug({ topScore, floor }, "SmartTopK: Top1 below floor, returning top1 only");
      return [sorted[0]];
    }
    const ratioThreshold = topScore * ratio;
    const deltaThreshold = topScore - deltaAbs;
    const dynamicThreshold = Math.max(floor, Math.min(ratioThreshold, deltaThreshold));
    const picked = [];
    for (let i = 0; i < sorted.length; i++) {
      if (picked.length >= maxK) break;
      const chunk = sorted[i];
      if (i < minK) {
        if (chunk.score >= floor) {
          picked.push(chunk);
          continue;
        }
        logger.debug(
          { rank: i, score: chunk.score, floor },
          "SmartTopK: Safe harbor chunk below floor, breaking"
        );
        break;
      }
      if (chunk.score < dynamicThreshold) {
        logger.debug(
          {
            rank: i,
            score: chunk.score,
            dynamicThreshold,
            topScore,
            ratioThreshold,
            deltaThreshold
          },
          "SmartTopK: cutoff at dynamic threshold"
        );
        break;
      }
      picked.push(chunk);
    }
    const deduped = this.dedupChunks(picked);
    if (deduped.length < Math.min(minK, maxK)) {
      const seen = new Set(deduped.map((c) => this.chunkKey(c)));
      for (const c of sorted) {
        if (deduped.length >= Math.min(minK, maxK)) break;
        if (c.score < floor) break;
        const key = this.chunkKey(c);
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(c);
        }
      }
    }
    logger.debug(
      {
        originalCount: candidates.length,
        pickedCount: picked.length,
        finalCount: deduped.length,
        topScore,
        floor,
        ratio,
        deltaAbs,
        ratioThreshold: ratioThreshold.toFixed(3),
        deltaThreshold: deltaThreshold.toFixed(3),
        dynamicThreshold: dynamicThreshold.toFixed(3)
      },
      "SmartTopK: done"
    );
    return deduped;
  }
  /**
   * 生成 chunk 唯一键（用于去重）
   */
  chunkKey(chunk) {
    return `${chunk.filePath}#${chunk.chunkIndex}`;
  }
  /**
   * 按 file_path + chunk_index 去重
   */
  dedupChunks(list) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const c of list) {
      const k = this.chunkKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  }
  // 扩展方法
  /**
   * 扩展 seed chunks
   *
   * 使用 GraphExpander 执行三种扩展策略：
   * - E1: 同文件邻居
   * - E2: breadcrumb 补段
   * - E3: 相对路径 import 解析
   */
  async expand(seeds, queryTokens) {
    if (seeds.length === 0) return [];
    const expander = await getGraphExpander(this.projectId, this.config);
    const { chunks, stats } = await expander.expand(seeds, queryTokens);
    logger.debug(stats, "\u4E0A\u4E0B\u6587\u6269\u5C55\u7EDF\u8BA1");
    return chunks;
  }
  // 工具方法
  /**
   * 中间省略截断（保留首尾）
   */
  truncateMiddle(text, maxLen) {
    if (text.length <= maxLen) return text;
    const half = Math.floor((maxLen - 3) / 2);
    return `${text.slice(0, half)}...${text.slice(-half)}`;
  }
  /**
   * 头尾截断（备用方法，当无命中行时使用）
   */
  truncateHeadTail(text, maxLen, headRatio) {
    if (text.length <= maxLen) return text;
    const headLen = Math.floor(maxLen * headRatio);
    const tailLen = maxLen - headLen - 3;
    if (tailLen <= 0) return text.slice(0, maxLen);
    return `${text.slice(0, headLen)}...${text.slice(-tailLen)}`;
  }
  /**
   * 围绕命中行截取
   *
   * 找到第一个包含 query token 的行，截取其上下文
   * 如果没有命中，降级为头尾截断
   */
  extractAroundHit(text, queryTokens, maxLen) {
    if (text.length <= maxLen) return text;
    const lines = text.split("\n");
    const _textLower = text.toLowerCase();
    let hitLineIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      let lineScore = 0;
      for (const token of queryTokens) {
        if (lineLower.includes(token)) {
          lineScore++;
        }
      }
      if (lineScore > bestScore) {
        bestScore = lineScore;
        hitLineIdx = i;
      }
    }
    if (hitLineIdx === -1) {
      return this.truncateHeadTail(text, maxLen, this.config.headRatio);
    }
    let start = hitLineIdx;
    let end = hitLineIdx;
    let currentLen = lines[hitLineIdx].length;
    while (currentLen < maxLen) {
      const canUp = start > 0;
      const canDown = end < lines.length - 1;
      if (!canUp && !canDown) break;
      if (canUp) {
        const upLen = lines[start - 1].length + 1;
        if (currentLen + upLen <= maxLen) {
          start--;
          currentLen += upLen;
        }
      }
      if (canDown) {
        const downLen = lines[end + 1].length + 1;
        if (currentLen + downLen <= maxLen) {
          end++;
          currentLen += downLen;
        }
      }
      if ((start === 0 || lines[start - 1].length + 1 + currentLen > maxLen) && (end === lines.length - 1 || lines[end + 1].length + 1 + currentLen > maxLen)) {
        break;
      }
    }
    const result = lines.slice(start, end + 1).join("\n");
    const prefix = start > 0 ? "..." : "";
    const suffix = end < lines.length - 1 ? "..." : "";
    return prefix + result + suffix;
  }
  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }
};
export {
  SearchService
};
//# sourceMappingURL=SearchService-7OSCIPSY.js.map