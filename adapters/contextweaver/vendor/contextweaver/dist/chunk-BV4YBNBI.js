import {
  crawl,
  formatProjectIndexingScope,
  getRecommendedProjectConfigTemplate,
  initFilter,
  loadProjectConfig,
  scan,
  stringifyProjectConfig
} from "./chunk-GYK2PYHT.js";
import {
  getProjectIdentity
} from "./chunk-35HO3GPM.js";
import {
  logger
} from "./chunk-44FXLQ5V.js";
import {
  getExcludePatterns
} from "./chunk-CA4WQHZS.js";

// src/cli.ts
import fs2 from "fs/promises";
import os2 from "os";
import path2 from "path";
import { stdin, stdout } from "process";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";

// src/indexRegistry.ts
import fs from "fs/promises";
import os from "os";
import path from "path";
function getBaseDir() {
  return path.join(os.homedir(), ".contextweaver");
}
function getRegistryPath() {
  return path.join(getBaseDir(), "indexes.json");
}
function normalizeRecord(record) {
  return {
    ...record,
    confirmedAt: record.confirmedAt ?? null,
    projectPath: path.resolve(record.projectPath)
  };
}
function validateRecord(value, registryPath) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${registryPath}: index record must be an object`);
  }
  const record = value;
  if (typeof record.projectId !== "string") {
    throw new Error(`Invalid ${registryPath}: projectId must be a string`);
  }
  if (typeof record.projectPath !== "string") {
    throw new Error(`Invalid ${registryPath}: projectPath must be a string`);
  }
  if (typeof record.pathBirthtimeMs !== "number") {
    throw new Error(`Invalid ${registryPath}: pathBirthtimeMs must be a number`);
  }
  if (typeof record.lastIndexedAt !== "string") {
    throw new Error(`Invalid ${registryPath}: lastIndexedAt must be a string`);
  }
  if (record.confirmedAt !== void 0 && record.confirmedAt !== null && typeof record.confirmedAt !== "string") {
    throw new Error(`Invalid ${registryPath}: confirmedAt must be a string or null`);
  }
  return normalizeRecord({
    projectId: record.projectId,
    projectPath: record.projectPath,
    pathBirthtimeMs: record.pathBirthtimeMs,
    lastIndexedAt: record.lastIndexedAt,
    confirmedAt: record.confirmedAt ?? null
  });
}
async function readRegistry() {
  const registryPath = getRegistryPath();
  let content;
  try {
    content = await fs.readFile(registryPath, "utf-8");
  } catch (error) {
    const err = error;
    if (err.code === "ENOENT") {
      return { version: 1, indexes: [] };
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const err = error;
    throw new Error(`Invalid ${registryPath}: failed to parse JSON (${err.message})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid ${registryPath}: top-level value must be an object`);
  }
  const registry = parsed;
  if (!Array.isArray(registry.indexes)) {
    throw new Error(`Invalid ${registryPath}: indexes must be an array`);
  }
  return {
    version: 1,
    indexes: registry.indexes.map((item) => validateRecord(item, registryPath))
  };
}
async function writeRegistry(records) {
  const registryPath = getRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  const sorted = records.map(normalizeRecord).sort((a, b) => a.projectPath.localeCompare(b.projectPath));
  await fs.writeFile(
    registryPath,
    `${JSON.stringify({ version: 1, indexes: sorted }, null, 2)}
`,
    "utf-8"
  );
}
async function listIndexedProjects() {
  const registry = await readRegistry();
  return registry.indexes;
}
async function upsertIndexedProject(record) {
  const registry = await readRegistry();
  const normalized = normalizeRecord(record);
  const indexes = registry.indexes.filter((item) => item.projectId !== normalized.projectId);
  indexes.push(normalized);
  await writeRegistry(indexes);
}
async function isIndexedProjectConfirmed(projectId) {
  const registry = await readRegistry();
  return registry.indexes.some((item) => item.projectId === projectId && item.confirmedAt !== null);
}
async function findStaleIndexedProjects() {
  const indexes = await listIndexedProjects();
  const stale = [];
  for (const record of indexes) {
    try {
      const stats = await fs.stat(record.projectPath);
      if (!stats.isDirectory()) {
        stale.push(record);
        continue;
      }
      if (getProjectIdentity(record.projectPath).pathBirthtimeMs !== record.pathBirthtimeMs) {
        stale.push(record);
      }
    } catch (error) {
      const err = error;
      if (err.code === "ENOENT") {
        stale.push(record);
        continue;
      }
      throw error;
    }
  }
  return stale;
}
async function removeIndexedProjects(projectIds) {
  const registry = await readRegistry();
  await writeRegistry(registry.indexes.filter((item) => !projectIds.includes(item.projectId)));
}

// src/cli.ts
function getBaseDir2() {
  return path2.join(os2.homedir(), ".contextweaver");
}
function getPackageRootDir() {
  return path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..");
}
async function pathExists(targetPath) {
  try {
    await fs2.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
function resolveSkillInstallTarget(options) {
  if (options.targetDir) {
    return path2.resolve(options.cwd, options.targetDir);
  }
  return options.cwd;
}
async function installBundledSkills(options) {
  const bundledSkillsDir = path2.join(getPackageRootDir(), "skills");
  const entries = await fs2.readdir(bundledSkillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((entry) => entry.isDirectory());
  await fs2.mkdir(options.targetDir, { recursive: true });
  const installed = [];
  for (const entry of skillDirs) {
    const sourcePath = path2.join(bundledSkillsDir, entry.name);
    const targetPath = path2.join(options.targetDir, entry.name);
    if (await pathExists(targetPath)) {
      if (!options.force) {
        throw new Error(`skill directory already exists: ${targetPath}`);
      }
      await fs2.rm(targetPath, { recursive: true, force: true });
    }
    await fs2.cp(sourcePath, targetPath, { recursive: true });
    installed.push({ name: entry.name, targetPath });
  }
  return installed;
}
async function defaultConfirmDelete(count) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`\u786E\u8BA4\u5220\u9664\u4EE5\u4E0A ${count} \u4E2A\u5931\u6548\u7D22\u5F15\uFF1F [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}
async function defaultConfirmIndex() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question("\u786E\u8BA4\u5F00\u59CB\u7D22\u5F15\uFF1F [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}
function summarizeDirectory(relativePath) {
  const firstSlash = relativePath.indexOf("/");
  if (firstSlash === -1) {
    return "./";
  }
  return `${relativePath.slice(0, firstSlash + 1)}`;
}
function getExtension(relativePath) {
  const ext = path2.extname(relativePath).toLowerCase();
  return ext || "<no-ext>";
}
async function buildIndexScopeLogLines(rootPath) {
  const config = await loadProjectConfig(rootPath);
  const scope = formatProjectIndexingScope(config);
  return [
    "\u7D22\u5F15\u8303\u56F4:",
    `  - include: ${scope.includeSummary}`,
    `  - ignore (project): ${scope.ignoreSummary}`,
    "  - ignore (.gitignore at repo root): enabled",
    `  - ignore (built-in): ${getExcludePatterns().join(", ")}`,
    "  - always excluded: cwconfig.json",
    ...scope.hasEmptyIncludeScope ? ["  - warning: current config yields an empty indexing scope"] : []
  ];
}
async function initProjectConfigCommand(options) {
  const configPath = path2.join(options.cwd, "cwconfig.json");
  if (!options.force) {
    try {
      await fs2.access(configPath);
      throw new Error(`cwconfig.json already exists: ${configPath}`);
    } catch (error) {
      const err = error;
      if (err.code !== "ENOENT") {
        throw error;
      }
    }
  }
  await fs2.writeFile(
    configPath,
    stringifyProjectConfig(getRecommendedProjectConfigTemplate()),
    "utf-8"
  );
  return configPath;
}
async function ensureProjectConfigForIndex(rootPath) {
  const configPath = path2.join(rootPath, "cwconfig.json");
  try {
    await fs2.access(configPath);
    return { kind: "ready", configPath };
  } catch (error) {
    const err = error;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
  await fs2.writeFile(
    configPath,
    stringifyProjectConfig(getRecommendedProjectConfigTemplate()),
    "utf-8"
  );
  return { kind: "created_config", configPath };
}
async function buildIndexPreview(rootPath) {
  await initFilter(rootPath);
  const { filePaths, relativePaths } = await crawl(rootPath);
  const directoryStats = /* @__PURE__ */ new Map();
  const extensionStats = /* @__PURE__ */ new Map();
  for (const relativePath of relativePaths) {
    const directory = summarizeDirectory(relativePath);
    const extension = getExtension(relativePath);
    const directoryEntry = directoryStats.get(directory) ?? /* @__PURE__ */ new Map();
    directoryEntry.set(extension, (directoryEntry.get(extension) ?? 0) + 1);
    directoryStats.set(directory, directoryEntry);
    extensionStats.set(extension, (extensionStats.get(extension) ?? 0) + 1);
  }
  const directorySummaries = [...directoryStats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([directory, extensions]) => {
    const extensionSummary = [...extensions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ext, count]) => `${ext}(${count})`).join(", ");
    return `${directory}: ${extensionSummary}`;
  });
  const extensionSummaries = [...extensionStats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ext, count]) => `${ext}(${count})`);
  return {
    matchedFilePaths: filePaths,
    totalFiles: filePaths.length,
    directorySummaries,
    extensionSummaries,
    samplePaths: [...relativePaths].sort().slice(0, 10)
  };
}
async function deleteIndexedProjectDirectory(projectId) {
  if (!/^[a-f0-9]{10}$/.test(projectId)) {
    throw new Error(
      `projectId must resolve to a direct child of ${getBaseDir2()}; reserved names are blocked`
    );
  }
  if (!projectId || path2.basename(projectId) !== projectId || projectId === "." || projectId === "..") {
    throw new Error(`projectId must resolve to a direct child of ${getBaseDir2()}`);
  }
  await fs2.rm(path2.join(getBaseDir2(), projectId), { recursive: true });
}
async function recordIndexedProject(rootPath, options) {
  const identity = getProjectIdentity(rootPath);
  const lastIndexedAt = (/* @__PURE__ */ new Date()).toISOString();
  await upsertIndexedProject({
    projectId: identity.projectId,
    projectPath: identity.projectPath,
    pathBirthtimeMs: identity.pathBirthtimeMs,
    lastIndexedAt,
    confirmedAt: options?.confirmedAt ?? null
  });
}
async function ensureSearchableProject(rootPath) {
  const configPath = path2.join(rootPath, "cwconfig.json");
  try {
    await fs2.access(configPath);
  } catch (error) {
    const err = error;
    if (err.code === "ENOENT") {
      throw new Error("\u5F53\u524D\u4ED3\u5E93\u5C1A\u672A\u5B8C\u6210\u786E\u8BA4\u5F0F\u7D22\u5F15\uFF0C\u8BF7\u5148\u8FD0\u884C `cw index`\u3002");
    }
    throw error;
  }
  const identity = getProjectIdentity(rootPath);
  if (!await isIndexedProjectConfirmed(identity.projectId)) {
    throw new Error("\u5F53\u524D\u4ED3\u5E93\u5C1A\u672A\u5B8C\u6210\u786E\u8BA4\u5F0F\u7D22\u5F15\uFF0C\u8BF7\u5148\u8FD0\u884C `cw index`\u3002");
  }
}
async function runCleanIndexes(options) {
  if (!options.isInteractive && !options.yes && !options.dryRun) {
    throw new Error("Non-interactive cleanup requires --yes or --dry-run");
  }
  const staleProjects = options.staleProjects ?? await findStaleIndexedProjects();
  const staleProjectIds = staleProjects.map((item) => item.projectId);
  const writeLine = options.writeLine ?? (() => {
  });
  if (staleProjects.length === 0) {
    writeLine("\u6CA1\u6709\u53D1\u73B0\u53EF\u6E05\u7406\u7684\u5931\u6548\u7D22\u5F15");
    return {
      staleProjectIds: [],
      deletedProjectIds: [],
      failedProjectIds: [],
      prunedProjectIds: []
    };
  }
  writeLine(`\u53D1\u73B0 ${staleProjects.length} \u4E2A\u5931\u6548\u7D22\u5F15:`);
  for (const item of staleProjects) {
    writeLine(`- ${item.projectId} ${item.projectPath}`);
  }
  if (options.dryRun) {
    return {
      staleProjectIds,
      deletedProjectIds: [],
      failedProjectIds: [],
      prunedProjectIds: []
    };
  }
  if (!options.yes) {
    const confirmed = await (options.confirmDelete ?? defaultConfirmDelete)(staleProjects.length);
    if (!confirmed) {
      return {
        staleProjectIds,
        deletedProjectIds: [],
        failedProjectIds: [],
        prunedProjectIds: []
      };
    }
  }
  const deleteDirectory = options.deleteDirectory ?? deleteIndexedProjectDirectory;
  const removeRecords = options.removeRecords ?? removeIndexedProjects;
  const deletedProjectIds = [];
  const failedProjectIds = [];
  const prunedProjectIds = [];
  for (const item of staleProjects) {
    try {
      await deleteDirectory(item.projectId);
      deletedProjectIds.push(item.projectId);
    } catch (error) {
      const err = error;
      if (err.code === "ENOENT") {
        prunedProjectIds.push(item.projectId);
        continue;
      }
      failedProjectIds.push(item.projectId);
    }
  }
  const removableIds = [...deletedProjectIds, ...prunedProjectIds];
  if (removableIds.length > 0) {
    await removeRecords(removableIds);
  }
  return {
    staleProjectIds,
    deletedProjectIds,
    failedProjectIds,
    prunedProjectIds
  };
}
async function runIndexCommand(options) {
  const logLine = options.logLine ?? ((line) => logger.info(line));
  const isInteractive = options.isInteractive ?? Boolean(stdin.isTTY && stdout.isTTY);
  const identity = options.identity ?? getProjectIdentity(options.rootPath);
  const configState = await ensureProjectConfigForIndex(options.rootPath);
  if (configState.kind === "created_config") {
    throw new Error(`\u5DF2\u521B\u5EFA ${configState.configPath}\uFF0C\u8BF7\u5148\u68C0\u67E5\u914D\u7F6E\u540E\u91CD\u65B0\u8FD0\u884C cw index\u3002`);
  }
  const preview = await buildIndexPreview(options.rootPath);
  if (preview.totalFiles === 0) {
    throw new Error("Current config matches no indexable files.");
  }
  logLine(`\u5F00\u59CB\u626B\u63CF: ${options.rootPath}`);
  logLine(`\u9879\u76EE ID: ${identity.projectId}`);
  if (options.force) {
    logLine("\u5F3A\u5236\u91CD\u65B0\u7D22\u5F15: \u662F");
  }
  for (const line of await buildIndexScopeLogLines(options.rootPath)) {
    logLine(line);
  }
  logLine(`\u5B9E\u9645\u5339\u914D\u9884\u89C8: ${preview.totalFiles} \u4E2A\u6587\u4EF6`);
  for (const line of preview.directorySummaries) {
    logLine(`- ${line}`);
  }
  logLine("\u5339\u914D\u8DEF\u5F84\u6837\u672C:");
  for (const samplePath of preview.samplePaths) {
    logLine(`- ${samplePath}`);
  }
  if (!options.yes) {
    if (!isInteractive) {
      throw new Error("Non-interactive index preview requires --yes");
    }
    const confirmed = await (options.confirmIndex ?? defaultConfirmIndex)();
    if (!confirmed) {
      throw new Error("Index confirmation declined");
    }
  }
  const { withLock } = await import("./lock-CXBZNMFH.js");
  let lastProgressMessage;
  const confirmedAt = (/* @__PURE__ */ new Date()).toISOString();
  const stats = await withLock(
    identity.projectId,
    "index",
    async () => (options.scanFn ?? scan)(options.rootPath, {
      force: options.force,
      precomputedFilePaths: preview.matchedFilePaths,
      onProgress: (current, total, message) => {
        if (!message) {
          return;
        }
        if (message === lastProgressMessage) {
          return;
        }
        lastProgressMessage = message;
        logLine(message);
      }
    }),
    10 * 60 * 1e3
  );
  await (options.recordIndexedProjectFn ?? recordIndexedProject)(options.rootPath, { confirmedAt });
  return stats;
}

export {
  resolveSkillInstallTarget,
  installBundledSkills,
  buildIndexScopeLogLines,
  initProjectConfigCommand,
  ensureProjectConfigForIndex,
  buildIndexPreview,
  deleteIndexedProjectDirectory,
  recordIndexedProject,
  ensureSearchableProject,
  runCleanIndexes,
  runIndexCommand
};
//# sourceMappingURL=chunk-BV4YBNBI.js.map