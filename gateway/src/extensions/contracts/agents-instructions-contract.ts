import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENTS_INSTRUCTION_SEPARATOR,
  resolveAgentsInstructionBlock,
} from "../../orchestration/entrypoints/dev-cli/services/agents-instructions";
import { loadGrobotSystemPrompt } from "../../orchestration/entrypoints/dev-cli/system/gro-system-prompt";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function main(): void {
  const tempRoot = resolve(
    process.cwd(),
    `.tmp-agents-instructions-${String(Date.now())}-${String(Math.floor(Math.random() * 10_000))}`,
  );
  const nested = resolve(tempRoot, "apps", "web");
  mkdirSync(nested, { recursive: true });
  writeFileSync(resolve(tempRoot, "AGENTS.md"), "# Root\n\nRoot rules.\n", "utf8");
  writeFileSync(resolve(nested, "AGENTS.md"), "# Web\n\nWeb rules.\n", "utf8");
  try {
    const resolved = resolveAgentsInstructionBlock({
      projectRoot: tempRoot,
      workDir: nested,
    });
    assertEqual(resolved.sources.length, 2, "sources count");
    assertEqual(resolved.block?.includes("# AGENTS.md instructions for"), true, "block header");
    assertEqual(resolved.block?.includes("Root rules."), true, "root rules");
    assertEqual(resolved.block?.includes("Web rules."), true, "web rules");
    assertEqual(resolved.block?.includes(AGENTS_INSTRUCTION_SEPARATOR), true, "separator");

    const outside = resolveAgentsInstructionBlock({
      projectRoot: tempRoot,
      workDir: resolve(tempRoot, "..", "outside"),
    });
    assertEqual(outside.sources.length, 1, "outside source count");

    const gro = loadGrobotSystemPrompt();
    assertEqual(gro.includes("You are Grobot"), true, "gro identity");
    assertEqual(gro.includes("Context is the bounded prompt window"), true, "gro context");
    assertEqual(gro.includes("Memory is durable"), true, "gro memory");

    process.stdout.write(`${JSON.stringify({
      sources_count: resolved.sources.length,
      outside_sources_count: outside.sources.length,
      gro_loaded: true,
    })}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
