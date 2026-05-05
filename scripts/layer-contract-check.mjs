#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const defaultRepoRoot = resolve(__dirname, "..");

function parseArgs(rawArgs) {
  const options = {
    strict: false,
    asJson: false,
    repoRoot: defaultRepoRoot,
    specPath: "",
  };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--repo-root") {
      const value = rawArgs[i + 1];
      if (!value) {
        throw new Error("--repo-root requires a path value");
      }
      options.repoRoot = resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--spec") {
      const value = rawArgs[i + 1];
      if (!value) {
        throw new Error("--spec requires a path value");
      }
      options.specPath = resolve(value);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

let parsedArgs;
try {
  parsedArgs = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[layer-contract] ${error.message}\n`);
  process.exit(1);
}

const repoRoot = parsedArgs.repoRoot;
const strict = parsedArgs.strict;
const asJson = parsedArgs.asJson;
const specPath = parsedArgs.specPath || resolve(repoRoot, "scripts/layer-contract-spec.json");
if (!existsSync(specPath)) {
  process.stderr.write(`[layer-contract] missing spec file: ${relative(repoRoot, specPath)}\n`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const failures = [];
const warnings = [];
const notices = [];

function repoRel(path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function isDir(path) {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function countDirectoryEntries(path) {
  try {
    return readdirSync(path).length;
  } catch {
    return 0;
  }
}

function walkFiles(path, output) {
  if (!existsSync(path)) {
    return;
  }
  const stat = statSync(path);
  if (stat.isFile()) {
    output.push(path);
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const entry of readdirSync(path)) {
    walkFiles(resolve(path, entry), output);
  }
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectRustIncludePaths(filePath) {
  const text = readFileSync(filePath, "utf8");
  const includes = [];
  const pattern = /\binclude!\(\s*"([^"]+)"\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    const includePath = String(match[1] || "").trim();
    if (includePath) {
      includes.push(includePath);
    }
  }
  return includes;
}

function includeCapabilityKey(includePath) {
  const normalized = includePath.replaceAll("\\", "/");
  const [firstSegment] = normalized.split("/");
  return firstSegment || normalized;
}

function collectForbiddenCratePrefixes(filePath, forbiddenPrefixes) {
  const text = readFileSync(filePath, "utf8");
  const seen = new Set();
  const pattern = /\bcrate::([a-z_]+)::/g;
  for (const match of text.matchAll(pattern)) {
    const prefix = match[1];
    if (forbiddenPrefixes.includes(prefix)) {
      seen.add(prefix);
    }
  }
  return [...seen];
}

function collectForbiddenImportPrefixes(filePath, forbiddenPrefixes) {
  const text = readFileSync(filePath, "utf8");
  const seen = new Set();
  const pattern =
    /\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    const specifier = (match[1] || match[2] || match[3] || "").trim();
    if (!specifier) {
      continue;
    }
    for (const prefix of forbiddenPrefixes) {
      if (specifier.startsWith(prefix)) {
        seen.add(prefix);
      }
    }
  }
  return [...seen];
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAtOffset(text, offset) {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

function buildForbiddenTextRegex(pattern) {
  const flags = typeof pattern.flags === "string" && pattern.flags.trim()
    ? pattern.flags.trim()
    : "";
  const normalizedFlags = flags.includes("g") ? flags : `${flags}g`;
  if (typeof pattern.regex === "string" && pattern.regex.trim()) {
    return new RegExp(pattern.regex, normalizedFlags);
  }
  if (typeof pattern.literal === "string" && pattern.literal) {
    return new RegExp(escapeRegexLiteral(pattern.literal), normalizedFlags);
  }
  return undefined;
}

function fileMatchesExtensions(path, extensions) {
  for (const ext of extensions) {
    if (path.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function normalizeRepoPath(path) {
  return String(path || "").replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function pathMatchesPrefix(path, prefix) {
  return normalizeRepoPath(path).startsWith(normalizeRepoPath(prefix));
}

function pathMatchesAnyPrefix(path, prefixes) {
  return normalizeStringList(prefixes).some((prefix) => pathMatchesPrefix(path, prefix));
}

function pathMatchesAnyExact(path, paths) {
  const normalizedPath = normalizeRepoPath(path);
  return normalizeStringList(paths).some((item) => normalizedPath === normalizeRepoPath(item));
}

function pathIsDirectChildFile(path, directory) {
  const normalizedDirectory = normalizeRepoPath(directory).replace(/\/+$/, "");
  const normalizedPath = normalizeRepoPath(path);
  const prefix = `${normalizedDirectory}/`;
  if (!normalizedPath.startsWith(prefix)) {
    return false;
  }
  return !normalizedPath.slice(prefix.length).includes("/");
}

function pathIsAllowlisted(path, allowlist) {
  const normalizedPath = normalizeRepoPath(path);
  for (const entry of allowlist ?? []) {
    if (typeof entry === "string" && normalizedPath === normalizeRepoPath(entry)) {
      return true;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const pathEquals = typeof entry.path === "string" ? entry.path : entry.pathEquals;
    if (typeof pathEquals === "string" && normalizedPath === normalizeRepoPath(pathEquals)) {
      return true;
    }
  }
  return false;
}

function describeAllowlistReason(path, allowlist) {
  const normalizedPath = normalizeRepoPath(path);
  for (const entry of allowlist ?? []) {
    if (typeof entry === "string" && normalizedPath === normalizeRepoPath(entry)) {
      return "";
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const pathEquals = typeof entry.path === "string" ? entry.path : entry.pathEquals;
    if (typeof pathEquals === "string" && normalizedPath === normalizeRepoPath(pathEquals)) {
      return typeof entry.reason === "string" ? entry.reason.trim() : "";
    }
  }
  return "";
}

function collectGitTrackedFiles(root) {
  const result = spawnSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    notices.push("[git] repository index unavailable; tracked-file checks skipped");
    return [];
  }
  return String(result.stdout || "")
    .split("\n")
    .map((item) => normalizeRepoPath(item.trim()))
    .filter(Boolean);
}

function collectGitUntrackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    notices.push("[git] untracked-file index unavailable; source-size untracked checks skipped");
    return [];
  }
  return String(result.stdout || "")
    .split("\n")
    .map((item) => normalizeRepoPath(item.trim()))
    .filter(Boolean);
}

function uniquePaths(paths) {
  return [...new Set(paths.map(normalizeRepoPath).filter(Boolean))];
}

function isImportAllowlisted(relativePath, cratePrefix, allowlist) {
  for (const rule of allowlist) {
    const expectedPrefix =
      typeof rule.cratePrefix === "string" ? rule.cratePrefix.trim() : "";
    if (!expectedPrefix || expectedPrefix !== cratePrefix) {
      continue;
    }
    const pathEquals =
      typeof rule.pathEquals === "string" ? rule.pathEquals.trim() : "";
    if (pathEquals && relativePath === pathEquals) {
      return true;
    }
    const pathIncludes =
      typeof rule.pathIncludes === "string" ? rule.pathIncludes.trim() : "";
    if (pathIncludes && relativePath.includes(pathIncludes)) {
      return true;
    }
  }
  return false;
}

const trackedFiles = collectGitTrackedFiles(repoRoot);
const sourceCandidateFiles = uniquePaths([
  ...trackedFiles,
  ...collectGitUntrackedFiles(repoRoot),
]);

for (const layer of spec.layers ?? []) {
  const layerPath = resolve(repoRoot, layer.path);
  if (!isDir(layerPath)) {
    failures.push(`[layer:${layer.name}] missing directory: ${layer.path}`);
    continue;
  }
  notices.push(`[layer:${layer.name}] ok: ${layer.path}`);

  const requiredDirs =
    layer.requiredDirs ?? layer.requiredCapabilityDirs ?? layer.requiredDomainDirs ?? [];
  for (const requiredDir of requiredDirs) {
    const requiredPath = resolve(layerPath, requiredDir);
    if (!isDir(requiredPath)) {
      warnings.push(`[layer:${layer.name}] missing required directory: ${repoRel(requiredPath)}`);
      continue;
    }
    if (countDirectoryEntries(requiredPath) === 0) {
      warnings.push(`[layer:${layer.name}] empty required directory: ${repoRel(requiredPath)}`);
    }
  }

  for (const includeCheck of layer.entrypointIncludeChecks ?? []) {
    const includeCheckPath =
      typeof includeCheck.path === "string" ? includeCheck.path.trim() : "";
    if (!includeCheckPath) {
      warnings.push(`[layer:${layer.name}] entrypoint include check missing path`);
      continue;
    }
    const entrypointPath = resolve(repoRoot, includeCheckPath);
    if (!existsSync(entrypointPath)) {
      failures.push(`[layer:${layer.name}] missing entrypoint include file: ${includeCheckPath}`);
      continue;
    }
    const includePaths = collectRustIncludePaths(entrypointPath);
    const includedCapabilities = new Set(includePaths.map(includeCapabilityKey));
    if (includeCheck.includeRequiredDirs !== false) {
      for (const requiredDir of requiredDirs) {
        if (!includedCapabilities.has(requiredDir)) {
          warnings.push(
            `[layer:${layer.name}] ${includeCheckPath} does not include required directory: ${requiredDir}`
          );
        }
      }
    }
    const allowedExtraDirs = new Set(normalizeStringList(includeCheck.allowedExtraIncludeDirs));
    const allowedExtraFiles = new Set(normalizeStringList(includeCheck.allowedExtraIncludeFiles));
    const requiredDirSet = new Set(requiredDirs);
    const entrypointDir = resolve(entrypointPath, "..");
    for (const includePath of includePaths) {
      const includeKey = includeCapabilityKey(includePath);
      const includeTarget = resolve(entrypointDir, includePath);
      if (!existsSync(includeTarget)) {
        warnings.push(
          `[layer:${layer.name}] ${includeCheckPath} includes missing file: ${includePath}`
        );
      }
      if (
        !requiredDirSet.has(includeKey)
        && !allowedExtraDirs.has(includeKey)
        && !allowedExtraFiles.has(includePath)
      ) {
        warnings.push(
          `[layer:${layer.name}] ${includeCheckPath} includes unexpected capability: ${includePath}`
        );
      }
    }
  }
}

for (const doc of spec.docs ?? []) {
  const docPath = resolve(repoRoot, doc.path);
  if (!existsSync(docPath)) {
    failures.push(`[docs] missing file: ${doc.path}`);
    continue;
  }
  const text = readFileSync(docPath, "utf8");
  for (const marker of doc.mustInclude ?? []) {
    if (!text.includes(marker)) {
      warnings.push(`[docs] missing marker in ${doc.path}: ${marker}`);
    }
  }
}

for (const item of spec.maxLinesWarnings ?? []) {
  const target = resolve(repoRoot, item.path);
  if (!existsSync(target)) {
    failures.push(`[lines] missing file: ${item.path}`);
    continue;
  }
  const lineCount = readFileSync(target, "utf8").split("\n").length;
  if (lineCount > Number(item.max)) {
    warnings.push(`[lines] ${item.path} has ${lineCount} lines (limit=${item.max})`);
  }
}

for (const rule of spec.trackedGeneratedStateWarnings ?? []) {
  const name = typeof rule.name === "string" && rule.name.trim()
    ? rule.name.trim()
    : "tracked-generated-state";
  const allowedBasenames = new Set(normalizeStringList(rule.allowedBasenames));
  const allowedPaths = normalizeStringList(rule.allowedPaths).map(normalizeRepoPath);
  const pathPrefixes = normalizeStringList(rule.pathPrefixes ?? rule.prefixes);
  const matched = trackedFiles.filter((path) => {
    if (allowedBasenames.has(basename(path)) || allowedPaths.includes(path)) {
      return false;
    }
    return pathMatchesAnyPrefix(path, pathPrefixes);
  });
  for (const path of matched) {
    warnings.push(
      `[generated-state:${name}] tracked runtime state should be untracked: ${path}`
    );
  }
}

for (const rule of spec.legacyPathWarnings ?? []) {
  const name = typeof rule.name === "string" && rule.name.trim()
    ? rule.name.trim()
    : "legacy-path";
  const allowlist = rule.allowlist ?? [];
  const pathPrefixes = normalizeStringList(rule.pathPrefixes ?? rule.prefixes);
  const exactPaths = normalizeStringList(rule.paths);
  const message = typeof rule.message === "string" && rule.message.trim()
    ? rule.message.trim()
    : "legacy path should not receive new product code";
  const matched = sourceCandidateFiles.filter((path) => {
    if (!existsSync(resolve(repoRoot, path))) {
      return false;
    }
    if (pathIsAllowlisted(path, allowlist)) {
      return false;
    }
    return pathMatchesAnyPrefix(path, pathPrefixes) || pathMatchesAnyExact(path, exactPaths);
  });
  const maxFiles = Number(rule.maxFiles ?? rule.maxTrackedFiles ?? NaN);
  if (Number.isFinite(maxFiles)) {
    notices.push(`[legacy-path:${name}] files=${matched.length} limit=${maxFiles}`);
    if (matched.length > maxFiles) {
      warnings.push(
        `[legacy-path:${name}] ${matched.length} files exceed limit=${maxFiles}: ${message}`
      );
    }
  } else {
    for (const path of matched) {
      warnings.push(`[legacy-path:${name}] ${path}: ${message}`);
    }
  }
}

for (const rule of spec.directFileCountWarnings ?? []) {
  const name = typeof rule.name === "string" && rule.name.trim()
    ? rule.name.trim()
    : "direct-files";
  const path = typeof rule.path === "string" ? normalizeRepoPath(rule.path) : "";
  if (!path) {
    warnings.push(`[direct-files:${name}] missing path`);
    continue;
  }
  const extensions = normalizeStringList(rule.extensions);
  const maxFiles = Number(rule.maxFiles ?? NaN);
  const message = typeof rule.message === "string" && rule.message.trim()
    ? rule.message.trim()
    : "direct file count should not grow";
  const matched = sourceCandidateFiles.filter((candidate) => {
    if (!pathIsDirectChildFile(candidate, path)) {
      return false;
    }
    if (extensions.length > 0 && !fileMatchesExtensions(candidate, extensions)) {
      return false;
    }
    return existsSync(resolve(repoRoot, candidate));
  });
  notices.push(`[direct-files:${name}] files=${matched.length} limit=${maxFiles} path=${path}`);
  if (Number.isFinite(maxFiles) && matched.length > maxFiles) {
    warnings.push(
      `[direct-files:${name}] ${matched.length} files exceed limit=${maxFiles}: ${message}`
    );
  }
}

for (const rule of spec.sourceFileSizeWarnings ?? []) {
  const name = typeof rule.name === "string" && rule.name.trim()
    ? rule.name.trim()
    : "source-size";
  const includePrefixes = normalizeStringList(rule.includePrefixes);
  const excludePrefixes = normalizeStringList(rule.excludePrefixes);
  const extensions = normalizeStringList(rule.extensions);
  const warnLimit = Number(rule.warn ?? rule.max ?? 0);
  const failLimit = Number(rule.fail ?? 0);
  const allowlist = rule.allowlist ?? [];
  const maxWarnCount = Number(rule.maxWarnCount ?? NaN);
  const maxFailCount = Number(rule.maxFailCount ?? NaN);
  const maxWarnOverflowLines = Number(rule.maxWarnOverflowLines ?? NaN);
  const maxFailOverflowLines = Number(rule.maxFailOverflowLines ?? NaN);
  const maxObservedLines = Number(rule.maxObservedLines ?? NaN);
  const aggregateRatchet = [
    maxWarnCount,
    maxFailCount,
    maxWarnOverflowLines,
    maxFailOverflowLines,
    maxObservedLines,
  ].some(Number.isFinite);
  const summary = {
    warnCount: 0,
    failCount: 0,
    warnOverflowLines: 0,
    failOverflowLines: 0,
    maxLines: 0,
    maxPath: "",
    allowlistedCount: 0,
  };
  for (const path of sourceCandidateFiles) {
    if (includePrefixes.length > 0 && !pathMatchesAnyPrefix(path, includePrefixes)) {
      continue;
    }
    if (excludePrefixes.length > 0 && pathMatchesAnyPrefix(path, excludePrefixes)) {
      continue;
    }
    if (extensions.length > 0 && !fileMatchesExtensions(path, extensions)) {
      continue;
    }
    const fullPath = resolve(repoRoot, path);
    if (!existsSync(fullPath)) {
      continue;
    }
    const lineCount = readFileSync(fullPath, "utf8").split("\n").length;
    if (lineCount > summary.maxLines) {
      summary.maxLines = lineCount;
      summary.maxPath = path;
    }
    if (warnLimit > 0 && lineCount > warnLimit) {
      summary.warnCount += 1;
      summary.warnOverflowLines += lineCount - warnLimit;
    }
    if (failLimit > 0 && lineCount > failLimit) {
      summary.failCount += 1;
      summary.failOverflowLines += lineCount - failLimit;
    }
    if (pathIsAllowlisted(path, allowlist)) {
      if (warnLimit > 0 && lineCount > warnLimit) {
        summary.allowlistedCount += 1;
      }
      continue;
    }
    if (aggregateRatchet) {
      continue;
    }
    if (failLimit > 0 && lineCount > failLimit) {
      failures.push(
        `[source-size:${name}] ${path} has ${lineCount} lines (fail=${failLimit})`
      );
      continue;
    }
    if (warnLimit > 0 && lineCount > warnLimit) {
      warnings.push(
        `[source-size:${name}] ${path} has ${lineCount} lines (warn=${warnLimit})`
      );
    }
  }
  notices.push(
    `[source-size:${name}] warn>${warnLimit}: ${summary.warnCount} files (+${summary.warnOverflowLines} lines), fail>${failLimit}: ${summary.failCount} files (+${summary.failOverflowLines} lines), allowlisted=${summary.allowlistedCount}, max=${summary.maxLines} ${summary.maxPath}`
  );
  if (Number.isFinite(maxWarnCount) && summary.warnCount > maxWarnCount) {
    warnings.push(
      `[source-size:${name}] warn debt count increased: ${summary.warnCount} files (limit=${maxWarnCount})`
    );
  }
  if (Number.isFinite(maxFailCount) && summary.failCount > maxFailCount) {
    failures.push(
      `[source-size:${name}] fail debt count increased: ${summary.failCount} files (limit=${maxFailCount})`
    );
  }
  if (
    Number.isFinite(maxWarnOverflowLines)
    && summary.warnOverflowLines > maxWarnOverflowLines
  ) {
    warnings.push(
      `[source-size:${name}] warn overflow increased: +${summary.warnOverflowLines} lines (limit=+${maxWarnOverflowLines})`
    );
  }
  if (
    Number.isFinite(maxFailOverflowLines)
    && summary.failOverflowLines > maxFailOverflowLines
  ) {
    failures.push(
      `[source-size:${name}] fail overflow increased: +${summary.failOverflowLines} lines (limit=+${maxFailOverflowLines})`
    );
  }
  if (Number.isFinite(maxObservedLines) && summary.maxLines > maxObservedLines) {
    failures.push(
      `[source-size:${name}] largest file grew: ${summary.maxLines} lines in ${summary.maxPath} (limit=${maxObservedLines})`
    );
  }
  for (const entry of allowlist) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const debtPath = typeof entry.path === "string" ? normalizeRepoPath(entry.path) : "";
    if (!debtPath) {
      continue;
    }
    if (!trackedFiles.includes(debtPath)) {
      warnings.push(`[source-size:${name}] stale allowlist entry: ${debtPath}`);
      continue;
    }
    const reason = describeAllowlistReason(debtPath, allowlist);
    if (!reason) {
      warnings.push(`[source-size:${name}] allowlist entry missing reason: ${debtPath}`);
    }
  }
}

for (const rule of spec.forbiddenTextWarnings ?? []) {
  const name = typeof rule.name === "string" && rule.name.trim()
    ? rule.name.trim()
    : "forbidden-text";
  const includePrefixes = normalizeStringList(rule.includePrefixes);
  const excludePrefixes = normalizeStringList(rule.excludePrefixes);
  const extensions = normalizeStringList(rule.extensions);
  const ruleAllowlist = rule.allowlist ?? [];
  const patterns = Array.isArray(rule.patterns) ? rule.patterns : [];
  for (const path of sourceCandidateFiles) {
    if (includePrefixes.length > 0 && !pathMatchesAnyPrefix(path, includePrefixes)) {
      continue;
    }
    if (excludePrefixes.length > 0 && pathMatchesAnyPrefix(path, excludePrefixes)) {
      continue;
    }
    if (extensions.length > 0 && !fileMatchesExtensions(path, extensions)) {
      continue;
    }
    if (pathIsAllowlisted(path, ruleAllowlist)) {
      continue;
    }
    const fullPath = resolve(repoRoot, path);
    if (!existsSync(fullPath)) {
      continue;
    }
    const text = readFileSync(fullPath, "utf8");
    for (const pattern of patterns) {
      if (!pattern || typeof pattern !== "object") {
        continue;
      }
      if (pathIsAllowlisted(path, pattern.allowlist ?? [])) {
        continue;
      }
      const regex = buildForbiddenTextRegex(pattern);
      if (!regex) {
        warnings.push(`[forbidden-text:${name}] invalid pattern config`);
        continue;
      }
      const match = regex.exec(text);
      if (!match) {
        continue;
      }
      const marker =
        typeof pattern.literal === "string" && pattern.literal
          ? pattern.literal
          : String(pattern.regex || "");
      const message =
        typeof pattern.message === "string" && pattern.message.trim()
          ? pattern.message.trim()
          : "forbidden text matched";
      warnings.push(
        `[forbidden-text:${name}] ${path}:${lineNumberAtOffset(text, match.index)} matched ${marker}: ${message}`
      );
    }
  }
}

for (const rule of spec.importPolicyWarnings ?? []) {
  const baseDir = resolve(repoRoot, rule.path);
  if (!isDir(baseDir)) {
    failures.push(`[imports:${rule.name}] missing directory: ${rule.path}`);
    continue;
  }
  const files = [];
  walkFiles(baseDir, files);
  const fileExtensions = Array.isArray(rule.fileExtensions) && rule.fileExtensions.length > 0
    ? rule.fileExtensions
    : Array.isArray(rule.forbiddenImportPrefixes) && rule.forbiddenImportPrefixes.length > 0
      ? [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]
      : [".rs"];
  for (const filePath of files) {
    if (!fileMatchesExtensions(filePath, fileExtensions)) {
      continue;
    }
    const hitPrefixes = new Set();
    for (const prefix of collectForbiddenCratePrefixes(
      filePath,
      rule.forbiddenCratePrefixes ?? []
    )) {
      hitPrefixes.add(prefix);
    }
    for (const prefix of collectForbiddenImportPrefixes(
      filePath,
      rule.forbiddenImportPrefixes ?? []
    )) {
      hitPrefixes.add(prefix);
    }
    const relativePath = repoRel(filePath);
    const actionablePrefixes = [...hitPrefixes].filter(
      (prefix) =>
        !isImportAllowlisted(
          relativePath,
          prefix,
          spec.importPolicyAllowlist ?? []
        )
    );
    if (actionablePrefixes.length === 0) {
      continue;
    }
    warnings.push(
      `[imports:${rule.name}] ${relativePath} references forbidden prefixes: ${actionablePrefixes.join(", ")}`
    );
  }
}

const summary = {
  schema: spec.schema ?? "unknown",
  strict,
  failures,
  warnings,
  notices,
  pass: failures.length === 0 && (!strict || warnings.length === 0)
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(`[layer-contract] schema=${summary.schema} strict=${strict}\n`);
  for (const notice of notices) {
    process.stdout.write(`${notice}\n`);
  }
  for (const warning of warnings) {
    process.stdout.write(`WARN: ${warning}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`ERROR: ${failure}\n`);
  }
  if (summary.pass) {
    process.stdout.write("layer-contract check passed.\n");
  }
}

if (!summary.pass) {
  process.exit(1);
}
