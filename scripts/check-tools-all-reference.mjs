#!/usr/bin/env node
import {
  assertManifestCurrent,
  buildManifestEntries,
  repoRoot,
  toPosixPath,
  vendorSourceRoot,
} from "./tools-all-reference-lib.mjs";
import { relative } from "node:path";

try {
  assertManifestCurrent();
  const count = buildManifestEntries(vendorSourceRoot).length;
  process.stdout.write(
    `tools/all reference snapshot OK (${String(count)} files): ${toPosixPath(relative(repoRoot, vendorSourceRoot))}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
