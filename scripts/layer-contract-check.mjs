#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const repoRoot = resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const asJson = args.has("--json");

const specPath = resolve(repoRoot, "scripts/layer-contract-spec.json");
if (!existsSync(specPath)) {
  process.stderr.write("[layer-contract] missing spec file: scripts/layer-contract-spec.json\n");
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

for (const layer of spec.layers ?? []) {
  const layerPath = resolve(repoRoot, layer.path);
  if (!isDir(layerPath)) {
    failures.push(`[layer:${layer.name}] missing directory: ${layer.path}`);
    continue;
  }
  notices.push(`[layer:${layer.name}] ok: ${layer.path}`);

  for (const requiredDir of layer.requiredDomainDirs ?? []) {
    const requiredPath = resolve(layerPath, requiredDir);
    if (!isDir(requiredPath)) {
      warnings.push(`[layer:${layer.name}] missing domain directory: ${repoRel(requiredPath)}`);
      continue;
    }
    if (countDirectoryEntries(requiredPath) === 0) {
      warnings.push(`[layer:${layer.name}] empty domain directory: ${repoRel(requiredPath)}`);
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
