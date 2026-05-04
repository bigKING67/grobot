#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, "..");
export const defaultReferenceSource = "/Users/gaoqian/Documents/sixseven/tools/all/src";
export const vendorRoot = resolve(repoRoot, "vendor/tools-all");
export const vendorSourceRoot = resolve(vendorRoot, "src");
export const manifestPath = resolve(vendorRoot, "MANIFEST.sha256");

const excludedBasenames = new Set([".DS_Store"]);

export function toPosixPath(value) {
  return value.split(sep).join("/");
}

function shouldExclude(path) {
  return excludedBasenames.has(path.split(/[\\/]/).at(-1) ?? "");
}

export function walkFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true })
      .filter((entry) => !excludedBasenames.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (shouldExclude(path)) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (entry.isFile()) {
        out.push(path);
      }
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
}

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function buildManifestEntries(root) {
  return walkFiles(root).map((path) => {
    const rel = toPosixPath(relative(root, path));
    return {
      hash: sha256File(path),
      path: `src/${rel}`,
    };
  });
}

export function formatManifest(entries) {
  return `${entries
    .map((entry) => `${entry.hash}  ${entry.path}`)
    .join("\n")}\n`;
}

export function parseManifest(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) {
      throw new Error(`invalid manifest line: ${rawLine}`);
    }
    entries.push({
      hash: match[1],
      path: match[2],
    });
  }
  return entries;
}

export function writeManifest(root = vendorSourceRoot) {
  const entries = buildManifestEntries(root);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, formatManifest(entries));
  return entries;
}

export function assertManifestCurrent() {
  if (!existsSync(manifestPath)) {
    throw new Error(`missing tools/all manifest: ${toPosixPath(relative(repoRoot, manifestPath))}`);
  }
  const expected = formatManifest(parseManifest(readFileSync(manifestPath, "utf8")));
  const actual = formatManifest(buildManifestEntries(vendorSourceRoot));
  if (actual !== expected) {
    throw new Error(
      [
        "vendor/tools-all snapshot manifest is stale.",
        "Run: node scripts/sync-tools-all-reference.mjs",
      ].join("\n"),
    );
  }
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function syncDirectoryContents(sourceRoot, targetRoot) {
  ensureDirectory(targetRoot);
  const wanted = new Set();
  for (const sourcePath of walkFiles(sourceRoot)) {
    const rel = relative(sourceRoot, sourcePath);
    const targetPath = join(targetRoot, rel);
    wanted.add(resolve(targetPath));
    ensureDirectory(dirname(targetPath));
    const sourceStat = statSync(sourcePath);
    let needsCopy = true;
    if (existsSync(targetPath)) {
      const targetStat = statSync(targetPath);
      needsCopy =
        targetStat.size !== sourceStat.size ||
        sha256File(targetPath) !== sha256File(sourcePath);
    }
    if (needsCopy) {
      copyFileSync(sourcePath, targetPath);
    }
  }

  for (const targetPath of walkFiles(targetRoot)) {
    if (!wanted.has(resolve(targetPath))) {
      rmSync(targetPath, { force: true });
    }
  }
  pruneEmptyDirectories(targetRoot, targetRoot);
}

function pruneEmptyDirectories(root, current) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      pruneEmptyDirectories(root, path);
    }
  }
  if (current !== root && readdirSync(current).length === 0) {
    rmSync(current, { recursive: true, force: true });
  }
}

export function syncReferenceSource(sourceRoot = defaultReferenceSource) {
  const resolvedSource = resolve(sourceRoot);
  if (!existsSync(resolvedSource)) {
    throw new Error(`tools/all reference source does not exist: ${resolvedSource}`);
  }
  syncDirectoryContents(resolvedSource, vendorSourceRoot);
  return writeManifest(vendorSourceRoot);
}
