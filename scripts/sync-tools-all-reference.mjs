#!/usr/bin/env node
import {
  defaultReferenceSource,
  repoRoot,
  syncReferenceSource,
  toPosixPath,
  vendorSourceRoot,
} from "./tools-all-reference-lib.mjs";
import { relative, resolve } from "node:path";

const sourceRoot = resolve(process.argv[2] ?? defaultReferenceSource);

try {
  const entries = syncReferenceSource(sourceRoot);
  process.stdout.write(
    [
      `synced tools/all reference: ${sourceRoot}`,
      `target: ${toPosixPath(relative(repoRoot, vendorSourceRoot))}`,
      `files: ${String(entries.length)}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
