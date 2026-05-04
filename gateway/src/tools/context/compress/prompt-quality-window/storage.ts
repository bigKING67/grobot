import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { resolveContextStoragePath } from "../../storage-boundary";
import {
  MAX_PERSISTED_ENTRIES,
  TRIM_LOCK_SUFFIX,
  TRIM_TRIGGER_BYTES,
} from "./constants";
import type { PromptQualityWindowEntry } from "./contract";
import { parseWindowEntry } from "./normalize";

export function resolveWindowPath(workDir: string): string {
  return resolveContextStoragePath(workDir, "prompt_quality_window");
}

export function resolveParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

export function readWindowEntries(path: string): PromptQualityWindowEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => parseWindowEntry(line))
    .filter((entry): entry is PromptQualityWindowEntry => Boolean(entry));
}

export function maybeTrimWindowFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const lockPath = `${path}${TRIM_LOCK_SUFFIX}`;
  let lockFd = -1;
  try {
    lockFd = openSync(lockPath, "wx");
  } catch {
    return;
  }
  try {
    let fileBytes = 0;
    try {
      const raw = readFileSync(path, "utf8");
      fileBytes = raw.length;
    } catch {
      return;
    }
    if (fileBytes < TRIM_TRIGGER_BYTES) {
      return;
    }
    const entries = readWindowEntries(path);
    if (entries.length <= MAX_PERSISTED_ENTRIES) {
      return;
    }
    const trimmed = entries.slice(-MAX_PERSISTED_ENTRIES);
    const content = trimmed.map((entry) => JSON.stringify(entry)).join("\n");
    try {
      writeFileSync(path, `${content}\n`, "utf8");
    } catch {
      // best effort only
    }
  } finally {
    try {
      if (lockFd >= 0) {
        closeSync(lockFd);
      }
    } catch {
      // ignore lock close failure
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore lock cleanup failure
    }
  }
}

export function appendPromptQualityWindowEntry(input: {
  workDir: string;
  entry: PromptQualityWindowEntry;
}): void {
  const path = resolveWindowPath(input.workDir);
  try {
    mkdirSync(resolveParentDir(path), { recursive: true });
    const serialized = `${JSON.stringify(input.entry)}\n`;
    const fd = openSync(path, "a");
    try {
      writeSync(fd, serialized, undefined, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return;
  }
  maybeTrimWindowFile(path);
}
