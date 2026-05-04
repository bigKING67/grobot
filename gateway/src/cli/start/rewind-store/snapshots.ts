import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { FileSnapshot } from "./contract";
import { runGitBuffer } from "./git";
import { normalizeRelativePath, safeWorkspacePath } from "./paths";

export function hashBuffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function readWorkspaceFileSnapshot(
  workDir: string,
  relativePath: string,
): FileSnapshot {
  const absolutePath = safeWorkspacePath(workDir, relativePath);
  if (!absolutePath || !existsSync(absolutePath)) {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }
  const bytes = readFileSync(absolutePath);
  return {
    exists: true,
    bytes,
    hash: hashBuffer(bytes),
    sizeBytes: bytes.length,
  };
}

export function readGitHeadSnapshot(workDir: string, relativePath: string): FileSnapshot {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }
  const output = runGitBuffer(workDir, ["show", `HEAD:${normalizedPath}`]);
  if (!output.ok) {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }
  const bytes = output.stdout;
  return {
    exists: true,
    bytes,
    hash: hashBuffer(bytes),
    sizeBytes: bytes.length,
  };
}
