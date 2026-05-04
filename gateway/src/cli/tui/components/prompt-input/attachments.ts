import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { RuntimeAttachment } from "../../../../models/types";
import {
  INLINE_IMAGE_PARSE_PATTERN,
  type InlineAttachmentResolution,
} from "./contract";

const INLINE_IMAGE_REGISTRY_LIMIT = 512;
const INLINE_IMAGE_REGISTRY = new Map<number, RuntimeAttachment>();
let nextInlineImageId = 1;

export function buildInlineImagePlaceholder(id: number): string {
  return `[Image #${String(id)}]`;
}

export function registerInlineImageAttachment(attachment: RuntimeAttachment): string {
  const id = nextInlineImageId;
  nextInlineImageId += 1;
  INLINE_IMAGE_REGISTRY.set(id, attachment);
  if (INLINE_IMAGE_REGISTRY.size > INLINE_IMAGE_REGISTRY_LIMIT) {
    const oldest = INLINE_IMAGE_REGISTRY.keys().next();
    if (!oldest.done) {
      INLINE_IMAGE_REGISTRY.delete(oldest.value);
    }
  }
  return buildInlineImagePlaceholder(id);
}

export function resolveProcessPlatform(): string {
  const runtimeProcess = process as unknown as { platform?: string };
  return (runtimeProcess.platform ?? "").toLowerCase();
}

export function trimTrailingSlashes(path: string): string {
  if (/^[\\/]+$/.test(path)) {
    return path.startsWith("\\") ? "\\" : "/";
  }
  return path.replace(/[\\/]+$/, "");
}

export function concatPath(basePath: string, segment: string): string {
  const normalizedBase = trimTrailingSlashes(basePath);
  if (normalizedBase === "/" || normalizedBase === "\\") {
    return `${normalizedBase}${segment}`;
  }
  return `${normalizedBase}/${segment}`;
}

export function resolveTempBaseDir(): string {
  const candidates = [
    process.env.CLAUDE_CODE_TMPDIR,
    process.env.TMPDIR,
    process.env.TEMP,
    process.env.TMP,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
  }
  return "/tmp";
}

export function resolveClipboardImageTempDir(): string {
  const customDir = process.env.GROBOT_CLIPBOARD_IMAGE_DIR?.trim();
  if (customDir && customDir.length > 0) {
    return customDir;
  }
  return concatPath(resolveTempBaseDir(), "grobot-inline-images");
}

export function saveClipboardImageToTempFile(): RuntimeAttachment | undefined {
  if (resolveProcessPlatform() !== "darwin") {
    return undefined;
  }
  const tempDir = resolveClipboardImageTempDir();
  mkdirSync(tempDir, { recursive: true });
  const filePath = concatPath(
    tempDir,
    `clipboard-${String(Date.now())}-${Math.random().toString(16).slice(2, 8)}.png`,
  );
  const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const result = spawnSync(
    "osascript",
    [
      "-e",
      "set png_data to (the clipboard as «class PNGf»)",
      "-e",
      `set fp to open for access POSIX file "${escapedPath}" with write permission`,
      "-e",
      "write png_data to fp",
      "-e",
      "close access fp",
    ],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return undefined;
  }
  return {
    type: "image",
    sourceType: "path",
    source: filePath,
    mimeType: "image/png",
    filename: filePath.slice(filePath.lastIndexOf("/") + 1),
  };
}

export function resolveInlineAttachmentsFromInput(
  userInput: string,
): InlineAttachmentResolution {
  const matches = [...userInput.matchAll(INLINE_IMAGE_PARSE_PATTERN)];
  if (matches.length === 0) {
    return {
      userInput,
      attachments: [],
    };
  }
  const attachments: RuntimeAttachment[] = [];
  const seen = new Set<number>();
  for (const match of matches) {
    const id = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const attachment = INLINE_IMAGE_REGISTRY.get(id);
    if (!attachment) {
      continue;
    }
    attachments.push(attachment);
  }
  return {
    userInput,
    attachments,
  };
}
