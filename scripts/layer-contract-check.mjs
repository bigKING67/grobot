#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
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

for (const rule of spec.importPolicyWarnings ?? []) {
  const baseDir = resolve(repoRoot, rule.path);
  if (!isDir(baseDir)) {
    failures.push(`[imports:${rule.name}] missing directory: ${rule.path}`);
    continue;
  }
  const files = [];
  walkFiles(baseDir, files);
  for (const filePath of files) {
    if (!filePath.endsWith(".rs")) {
      continue;
    }
    const hitPrefixes = collectForbiddenCratePrefixes(
      filePath,
      rule.forbiddenCratePrefixes ?? []
    );
    const relativePath = repoRel(filePath);
    const actionablePrefixes = hitPrefixes.filter(
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
      `[imports:${rule.name}] ${relativePath} references forbidden crate prefixes: ${actionablePrefixes.join(", ")}`
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
