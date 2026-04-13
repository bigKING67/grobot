#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const repoRoot = resolve(__dirname, "..");

const TARGETS = [
  "package.json",
  ".github/workflows",
  "scripts",
  "gateway/src/governance",
];

const FILE_EXT_ALLOWLIST = new Set([".json", ".yml", ".yaml", ".sh", ".ts", ".mjs", ".js"]);
const BLOCK_PATTERNS = [
  { key: "python3", regex: /\bpython3\b/ },
  { key: "python_shebang", regex: /^#!\/usr\/bin\/env python3\b/m },
  { key: "python_bin_flag", regex: /--python-bin\b/ },
];
const PYTHON_FILE_IGNORE_PREFIXES = [".trellis/"];

function walkPaths(startPath, output) {
  const stat = statSync(startPath);
  if (stat.isFile()) {
    output.push(startPath);
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const name of readdirSync(startPath)) {
    if (name === "node_modules" || name === ".git") {
      continue;
    }
    walkPaths(join(startPath, name), output);
  }
}

function shouldCheckFile(path) {
  const extension = extname(path);
  if (!FILE_EXT_ALLOWLIST.has(extension)) {
    return false;
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized.endsWith("/scripts/python-scope-audit.mjs")) {
    return false;
  }
  if (normalized.includes("/gateway/tests/")) {
    return false;
  }
  if (normalized.includes("/.trellis/")) {
    return false;
  }
  return true;
}

function toRepoRelative(path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function isIgnoredPythonFile(path) {
  return PYTHON_FILE_IGNORE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function findViolations(path) {
  const content = readFileSync(path, "utf8");
  const violations = [];
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.regex.test(content)) {
      violations.push(pattern.key);
    }
  }
  return violations;
}

const allFiles = [];
for (const target of TARGETS) {
  walkPaths(resolve(repoRoot, target), allFiles);
}

const errors = [];
for (const filePath of allFiles) {
  if (!shouldCheckFile(filePath)) {
    continue;
  }
  const violations = findViolations(filePath);
  if (violations.length === 0) {
    continue;
  }
  errors.push({
    path: toRepoRelative(filePath),
    violations,
  });
}

const repoFiles = [];
walkPaths(repoRoot, repoFiles);
for (const filePath of repoFiles) {
  if (extname(filePath) !== ".py") {
    continue;
  }
  const relativePath = toRepoRelative(filePath);
  if (isIgnoredPythonFile(relativePath)) {
    continue;
  }
  errors.push({
    path: relativePath,
    violations: ["python_file_not_allowed"],
  });
}

errors.sort((left, right) => left.path.localeCompare(right.path));

if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`[python-scope-audit] ${error.path}: ${error.violations.join(", ")}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("python-scope-audit passed (target scope + repository python boundary).\n");
}
