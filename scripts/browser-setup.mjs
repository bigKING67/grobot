#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sourceDir = resolve(repoRoot, "adapters/browser-structured-mcp/ga_tmwd_cdp_bridge");
const browserServerPath = resolve(repoRoot, "adapters/browser-structured-mcp/server.mjs");
const defaultGrobotHome = resolve(process.env.GROBOT_HOME || `${process.env.HOME || process.cwd()}/.grobot`);
const defaultTargetDir = resolve(defaultGrobotHome, "browser/tmwd_cdp_bridge");
const defaultMcpRegistryPath = resolve(defaultGrobotHome, "mcp/servers.toml");

function parseArgs(argv) {
  const parsed = {
    targetDir: defaultTargetDir,
    json: false,
    forceConfig: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--force-config") {
      parsed.forceConfig = true;
      continue;
    }
    if (token === "--target") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("missing --target value");
      }
      parsed.targetDir = resolve(value);
      index += 1;
      continue;
    }
    if (token.startsWith("--target=")) {
      parsed.targetDir = resolve(token.slice("--target=".length));
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node scripts/browser-setup.mjs [--target <dir>] [--force-config] [--json]",
    "",
    "Copies the TMWD CDP Bridge extension into a stable grobot browser directory",
    "and generates config.js required by the extension content script.",
  ].join("\n");
}

function makeTid() {
  return `__grobot_${randomBytes(6).toString("hex")}`;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function ensureBrowserMcpRegistry(registryPath) {
  mkdirSync(dirname(registryPath), { recursive: true });
  const current = existsSync(registryPath) ? readFileSync(registryPath, "utf8") : "";
  if (/^\s*name\s*=\s*["']browser-structured["']/m.test(current)) {
    return { path: registryPath, changed: false };
  }
  const block = [
    "",
    "# Browser automation backend used by core web_scan/web_execute_js tools.",
    "[[servers]]",
    "name = \"browser-structured\"",
    "command = \"node\"",
    `args = [${tomlString(browserServerPath)}]`,
    "enabled = true",
    "",
    "[servers.env]",
    "# Direct MCP calls keep auto for diagnostics; core web_scan/web_execute_js pass tmwd explicitly.",
    "BROWSER_STRUCTURED_TMWD_MODE = \"auto\"",
    "BROWSER_STRUCTURED_TMWD_TRANSPORT = \"auto\"",
    "BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = \"ws://127.0.0.1:18765\"",
    "BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = \"http://127.0.0.1:18766/link\"",
    "",
  ].join("\n");
  appendFileSync(registryPath, block, "utf8");
  return { path: registryPath, changed: true };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!existsSync(sourceDir)) {
    throw new Error(`missing browser extension source: ${sourceDir}`);
  }
  mkdirSync(args.targetDir, { recursive: true });
  cpSync(sourceDir, args.targetDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  const configPath = resolve(args.targetDir, "config.js");
  const configExists = existsSync(configPath);
  if (!configExists || args.forceConfig) {
    writeFileSync(configPath, `const TID = '${makeTid()}';\n`, "utf8");
  }
  const registry = ensureBrowserMcpRegistry(defaultMcpRegistryPath);
  const payload = {
    ok: true,
    extension_dir: args.targetDir,
    config_path: configPath,
    config_created: !configExists || args.forceConfig,
    mcp_registry_path: registry.path,
    mcp_registry_changed: registry.changed,
    next_steps: [
      "Open chrome://extensions or edge://extensions",
      "Enable Developer mode",
      `Load unpacked extension from: ${args.targetDir}`,
      "Run: grobot browser hub start",
      "Run: grobot browser doctor",
    ],
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    process.stdout.write(`Browser extension prepared: ${payload.extension_dir}\n`);
    process.stdout.write(`Config: ${payload.config_path}${payload.config_created ? " (created)" : " (kept)"}\n`);
    process.stdout.write(`MCP registry: ${payload.mcp_registry_path}${payload.mcp_registry_changed ? " (updated)" : " (already configured)"}\n`);
    process.stdout.write("Next:\n");
    for (const item of payload.next_steps) {
      process.stdout.write(`  - ${item}\n`);
    }
  }
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`browser setup failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
