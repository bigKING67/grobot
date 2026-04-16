import {
  logger
} from "./chunk-44FXLQ5V.js";

// src/search/fts.ts
var tokenizerCache = /* @__PURE__ */ new WeakMap();
function detectFtsTokenizer(db) {
  const cached = tokenizerCache.get(db);
  if (cached) return cached;
  let tokenizer;
  try {
    db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(content, tokenize='trigram');
            DROP TABLE IF EXISTS _fts_probe;
        `);
    tokenizer = "trigram";
    logger.debug("FTS tokenizer: trigram \u53EF\u7528");
  } catch (_err) {
    tokenizer = "unicode61";
    logger.debug("FTS tokenizer: \u964D\u7EA7\u5230 unicode61");
  }
  tokenizerCache.set(db, tokenizer);
  return tokenizer;
}
function initFilesFts(db) {
  const tokenizer = detectFtsTokenizer(db);
  const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='files_fts'
    `).get();
  if (!tableExists) {
    db.exec(`
            CREATE VIRTUAL TABLE files_fts USING fts5(
                path,
                content,
                tokenize='${tokenizer}'
            );
        `);
    logger.info(`\u521B\u5EFA files_fts \u8868\uFF0Ctokenizer=${tokenizer}`);
    syncFilesFts(db);
  }
}
function syncFilesFts(db) {
  const fileCount = db.prepare("SELECT COUNT(*) as c FROM files WHERE content IS NOT NULL").get().c;
  const ftsCount = db.prepare("SELECT COUNT(*) as c FROM files_fts").get().c;
  if (ftsCount < fileCount) {
    logger.info(`\u540C\u6B65 FTS \u7D22\u5F15: files=${fileCount}, fts=${ftsCount}`);
    db.exec(`
            DELETE FROM files_fts;
            INSERT INTO files_fts(path, content) 
            SELECT path, content FROM files WHERE content IS NOT NULL;
        `);
    logger.info(`FTS \u7D22\u5F15\u540C\u6B65\u5B8C\u6210: ${fileCount} \u6761\u8BB0\u5F55`);
  }
}
function initChunksFts(db) {
  const tokenizer = detectFtsTokenizer(db);
  const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='chunks_fts'
    `).get();
  if (!tableExists) {
    db.exec(`
            CREATE VIRTUAL TABLE chunks_fts USING fts5(
                chunk_id UNINDEXED,
                file_path UNINDEXED,
                chunk_index UNINDEXED,
                breadcrumb,
                content,
                tokenize='${tokenizer}'
            );
        `);
    logger.info(`\u521B\u5EFA chunks_fts \u8868\uFF0Ctokenizer=${tokenizer}`);
  }
}
function isChunksFtsInitialized(db) {
  const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='chunks_fts'
    `).get();
  return !!result;
}
function batchUpsertChunkFts(db, chunks) {
  const deleteStmt = db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
  const insertStmt = db.prepare(
    "INSERT INTO chunks_fts(chunk_id, file_path, chunk_index, breadcrumb, content) VALUES (?, ?, ?, ?, ?)"
  );
  const transaction = db.transaction((items) => {
    for (const item of items) {
      deleteStmt.run(item.chunkId);
      insertStmt.run(item.chunkId, item.filePath, item.chunkIndex, item.breadcrumb, item.content);
    }
  });
  transaction(chunks);
}
function batchDeleteFileChunksFts(db, filePaths) {
  const stmt = db.prepare("DELETE FROM chunks_fts WHERE file_path = ?");
  const transaction = db.transaction((paths) => {
    for (const p of paths) {
      stmt.run(p);
    }
  });
  transaction(filePaths);
}
function searchChunksFts(db, query, limit) {
  const tokens = segmentQuery(query);
  if (tokens.length === 0) {
    logger.debug("Chunk FTS \u5206\u8BCD\u540E\u65E0\u6709\u6548 token\uFF0C\u8DF3\u8FC7\u641C\u7D22");
    return [];
  }
  logger.debug(
    {
      rawQuery: query,
      tokens
    },
    "Chunk FTS \u5206\u8BCD\u7ED3\u679C"
  );
  const runQuery = (qStr, queryLimit) => {
    try {
      const rows = db.prepare(`
                SELECT chunk_id, file_path, chunk_index, bm25(chunks_fts) as score
                FROM chunks_fts
                WHERE chunks_fts MATCH ?
                ORDER BY score
                LIMIT ?
            `).all(qStr, queryLimit);
      return rows.map((r) => ({
        chunkId: r.chunk_id,
        filePath: r.file_path,
        chunkIndex: r.chunk_index,
        score: -r.score
      }));
    } catch (e) {
      logger.debug({ error: e }, "Chunk FTS \u67E5\u8BE2\u51FA\u9519");
      return [];
    }
  };
  const strictQuery = tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" AND ");
  const results = runQuery(strictQuery, limit);
  logger.debug({ type: "strict", count: results.length, query: strictQuery }, "Chunk FTS \u7CBE\u51C6\u641C\u7D22");
  if (results.length < limit && tokens.length > 1) {
    const beforeCount = results.length;
    const remainingLimit = limit - results.length;
    const relaxedQuery = tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    const relaxedResults = runQuery(relaxedQuery, remainingLimit + 10);
    const existingIds = new Set(results.map((r) => r.chunkId));
    for (const row of relaxedResults) {
      if (!existingIds.has(row.chunkId)) {
        if (results.length >= limit) break;
        results.push(row);
        existingIds.add(row.chunkId);
      }
    }
    logger.debug(
      { type: "relaxed", added: results.length - beforeCount, query: relaxedQuery },
      "Chunk FTS \u5BBD\u5BB9\u641C\u7D22\u8865\u5F55"
    );
  }
  logger.debug(
    {
      chunkCount: results.length,
      topChunks: results.slice(0, 5).map((r) => ({
        path: r.filePath.split("/").slice(-2).join("/"),
        chunkIndex: r.chunkIndex,
        bm25: r.score.toFixed(3)
      }))
    },
    "Chunk FTS \u53EC\u56DE\u7ED3\u679C"
  );
  return results.sort((a, b) => b.score - a.score);
}
function batchUpsertFileFts(db, files) {
  const deleteFts = db.prepare("DELETE FROM files_fts WHERE path = ?");
  const insertFts = db.prepare("INSERT INTO files_fts(path, content) VALUES (?, ?)");
  const transaction = db.transaction((items) => {
    for (const item of items) {
      deleteFts.run(item.path);
      insertFts.run(item.path, item.content);
    }
  });
  transaction(files);
}
function batchDeleteFileFts(db, paths) {
  const stmt = db.prepare("DELETE FROM files_fts WHERE path = ?");
  const transaction = db.transaction((items) => {
    for (const path2 of items) {
      stmt.run(path2);
    }
  });
  transaction(paths);
}
function sanitizeQuery(query) {
  return query.replace(/[():"*^./\\:@#$%&=+[\]{}<>|~`!?,;]/g, " ").replace(/\b(AND|OR|NOT|NEAR)\b/gi, " ").replace(/\s+/g, " ").trim();
}
var zhSegmenter = null;
function getZhSegmenter() {
  if (zhSegmenter === null) {
    try {
      zhSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    } catch {
      return null;
    }
  }
  return zhSegmenter;
}
function toSnakeCase(str) {
  return str.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();
}
function toCamelCase(str) {
  return str.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function generateVariants(token) {
  const variants = [token.toLowerCase()];
  const stripped = token.replace(/[._-]/g, "").toLowerCase();
  if (stripped !== token.toLowerCase() && stripped.length > 0) {
    variants.push(stripped);
  }
  if (/[a-z][A-Z]/.test(token)) {
    const snake = toSnakeCase(token);
    if (!variants.includes(snake)) {
      variants.push(snake);
    }
  }
  if (/_/.test(token)) {
    const camel = toCamelCase(token);
    if (!variants.includes(camel)) {
      variants.push(camel);
    }
  }
  return variants;
}
function segmentQuery(query) {
  const uniqueTokens = /* @__PURE__ */ new Set();
  const cleanRaw = sanitizeQuery(query);
  if (!cleanRaw) return [];
  for (const t of query.split(/\s+/)) {
    if (/[._/]/.test(t) || /[a-z][A-Z]/.test(t)) {
      const variants = generateVariants(t);
      for (const v of variants) {
        uniqueTokens.add(v);
      }
    }
  }
  const segmenter = getZhSegmenter();
  if (segmenter) {
    const segments = segmenter.segment(cleanRaw);
    for (const seg of segments) {
      if (seg.isWordLike) {
        const t = seg.segment.toLowerCase();
        if (t.trim().length > 0) {
          const variants = generateVariants(seg.segment);
          for (const v of variants) {
            uniqueTokens.add(v);
          }
        }
      }
    }
  } else {
    logger.warn("Intl.Segmenter \u4E0D\u53EF\u7528\uFF0C\u4E2D\u6587\u641C\u7D22\u5C06\u9000\u5316\u4E3A\u7CBE\u786E\u5339\u914D");
    for (const t of cleanRaw.split(/[\s\p{P}]+/u)) {
      if (t.length > 0) {
        const variants = generateVariants(t);
        for (const v of variants) {
          uniqueTokens.add(v);
        }
      }
    }
  }
  return Array.from(uniqueTokens);
}
function searchFilesFts(db, query, limit) {
  const tokens = segmentQuery(query);
  if (tokens.length === 0) {
    logger.debug("FTS \u5206\u8BCD\u540E\u65E0\u6709\u6548 token\uFF0C\u8DF3\u8FC7\u641C\u7D22");
    return [];
  }
  logger.debug(
    {
      rawQuery: query,
      tokens
    },
    "FTS \u5206\u8BCD\u7ED3\u679C"
  );
  const runQuery = (qStr, queryLimit) => {
    try {
      const rows = db.prepare(`
                SELECT path, bm25(files_fts) as score
                FROM files_fts
                WHERE files_fts MATCH ?
                ORDER BY score
                LIMIT ?
            `).all(qStr, queryLimit);
      return rows.map((r) => ({ path: r.path, score: -r.score }));
    } catch (_e) {
      return [];
    }
  };
  const strictQuery = tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" AND ");
  const results = runQuery(strictQuery, limit);
  logger.debug({ type: "strict", count: results.length, query: strictQuery }, "FTS \u7CBE\u51C6\u641C\u7D22");
  if (results.length < limit && tokens.length > 1) {
    const beforeCount = results.length;
    const remainingLimit = limit - results.length;
    const relaxedQuery = tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    const relaxedResults = runQuery(relaxedQuery, remainingLimit + 10);
    const existingPaths = new Set(results.map((r) => r.path));
    for (const row of relaxedResults) {
      if (!existingPaths.has(row.path)) {
        if (results.length >= limit) break;
        results.push(row);
        existingPaths.add(row.path);
      }
    }
    logger.debug(
      { type: "relaxed", added: results.length - beforeCount, query: relaxedQuery },
      "FTS \u5BBD\u5BB9\u641C\u7D22\u8865\u5F55"
    );
  }
  logger.debug(
    {
      fileCount: results.length,
      topFiles: results.slice(0, 5).map((r) => ({
        path: r.path.split("/").slice(-2).join("/"),
        bm25: r.score.toFixed(3)
      }))
    },
    "FTS \u53EC\u56DE\u7ED3\u679C"
  );
  return results.sort((a, b) => b.score - a.score);
}
function isFtsInitialized(db) {
  const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='files_fts'
    `).get();
  return !!result;
}

// src/db/index.ts
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
var BASE_DIR = path.join(os.homedir(), ".contextweaver");
function getDirectoryBirthtime(projectPath) {
  const gitDir = path.join(projectPath, ".git");
  try {
    const gitStats = fs.statSync(gitDir);
    if (gitStats.isDirectory() && gitStats.birthtimeMs) {
      return Math.floor(gitStats.birthtimeMs);
    }
  } catch {
  }
  try {
    const rootStats = fs.statSync(projectPath);
    if (rootStats.birthtimeMs) {
      return Math.floor(rootStats.birthtimeMs);
    }
  } catch {
  }
  return 0;
}
function generateProjectId(projectPath) {
  return getProjectIdentity(projectPath).projectId;
}
function getProjectIdentity(projectPath) {
  const pathBirthtimeMs = getDirectoryBirthtime(projectPath);
  const uniqueKey = `${projectPath}::${pathBirthtimeMs}`;
  return {
    projectPath,
    pathBirthtimeMs,
    projectId: crypto.createHash("md5").update(uniqueKey).digest("hex").slice(0, 10)
  };
}
function initDb(projectId) {
  const projectDir = path.join(BASE_DIR, projectId);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  const dbPath = path.join(projectDir, "index.db");
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      content TEXT,
      language TEXT NOT NULL,
      vector_index_hash TEXT
    )
  `);
  try {
    db.exec("ALTER TABLE files ADD COLUMN vector_index_hash TEXT");
  } catch {
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  initFilesFts(db);
  initChunksFts(db);
  return db;
}
function closeDb(db) {
  db.close();
}
function getAllFileMeta(db) {
  const rows = db.prepare("SELECT path, hash, mtime, size, vector_index_hash FROM files").all();
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    map.set(row.path, {
      mtime: row.mtime,
      hash: row.hash,
      size: row.size,
      vectorIndexHash: row.vector_index_hash
    });
  }
  return map;
}
function getFilesNeedingVectorIndex(db) {
  const rows = db.prepare("SELECT path FROM files WHERE vector_index_hash IS NULL OR vector_index_hash != hash").all();
  return rows.map((r) => r.path);
}
function batchUpdateVectorIndexHash(db, items) {
  const update = db.prepare("UPDATE files SET vector_index_hash = ? WHERE path = ?");
  const transaction = db.transaction((data) => {
    for (const item of data) {
      update.run(item.hash, item.path);
    }
  });
  transaction(items);
}
function clearVectorIndexHash(db, paths) {
  const update = db.prepare("UPDATE files SET vector_index_hash = NULL WHERE path = ?");
  const transaction = db.transaction((items) => {
    for (const item of items) {
      update.run(item);
    }
  });
  transaction(paths);
}
function batchUpsert(db, files) {
  const insert = db.prepare(`
    INSERT INTO files (path, hash, mtime, size, content, language)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      hash = excluded.hash,
      mtime = excluded.mtime,
      size = excluded.size,
      content = excluded.content,
      language = excluded.language
  `);
  const transaction = db.transaction((items) => {
    for (const item of items) {
      insert.run(item.path, item.hash, item.mtime, item.size, item.content, item.language);
    }
  });
  transaction(files);
  const ftsFiles = [];
  for (const f of files) {
    if (f.content !== null) {
      ftsFiles.push({ path: f.path, content: f.content });
    }
  }
  if (ftsFiles.length > 0) {
    batchUpsertFileFts(db, ftsFiles);
  }
}
function batchUpdateMtime(db, items) {
  const update = db.prepare("UPDATE files SET mtime = ? WHERE path = ?");
  const transaction = db.transaction((data) => {
    for (const item of data) {
      update.run(item.mtime, item.path);
    }
  });
  transaction(items);
}
function getAllPaths(db) {
  const rows = db.prepare("SELECT path FROM files").all();
  return rows.map((r) => r.path);
}
function batchDelete(db, paths) {
  const stmt = db.prepare("DELETE FROM files WHERE path = ?");
  const transaction = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  transaction(paths);
  if (paths.length > 0) {
    batchDeleteFileFts(db, paths);
  }
}
function clear(db) {
  db.exec("DELETE FROM files");
}
var METADATA_KEY_EMBEDDING_DIMENSIONS = "embedding_dimensions";
function getMetadata(db, key) {
  const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(key);
  return row?.value ?? null;
}
function setMetadata(db, key, value) {
  db.prepare(
    `
    INSERT INTO metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
  ).run(key, value);
}
function getStoredEmbeddingDimensions(db) {
  const value = getMetadata(db, METADATA_KEY_EMBEDDING_DIMENSIONS);
  if (value === null) return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
function setStoredEmbeddingDimensions(db, dimensions) {
  setMetadata(db, METADATA_KEY_EMBEDDING_DIMENSIONS, String(dimensions));
}

export {
  isChunksFtsInitialized,
  batchUpsertChunkFts,
  batchDeleteFileChunksFts,
  searchChunksFts,
  segmentQuery,
  searchFilesFts,
  isFtsInitialized,
  generateProjectId,
  getProjectIdentity,
  initDb,
  closeDb,
  getAllFileMeta,
  getFilesNeedingVectorIndex,
  batchUpdateVectorIndexHash,
  clearVectorIndexHash,
  batchUpsert,
  batchUpdateMtime,
  getAllPaths,
  batchDelete,
  clear,
  getStoredEmbeddingDimensions,
  setStoredEmbeddingDimensions
};
//# sourceMappingURL=chunk-35HO3GPM.js.map