import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  dirname,
  fileReadable,
  resolveSessionRegistryReadPath,
  sessionRegistryFilePath,
} from "./paths";
import { normalizeSessionRegistryPayload } from "./payload";
import type {
  LoadedSessionRegistry,
  SessionRegistryPayload,
} from "./types";

export function loadSessionRegistry(homeDir: string, namespaceKey: string): LoadedSessionRegistry {
  const path = sessionRegistryFilePath(homeDir, namespaceKey);
  const resolved = resolveSessionRegistryReadPath(homeDir, namespaceKey);
  const warnings: string[] = [...resolved.warnings];
  let raw: unknown = {};
  const sourcePath = resolved.path;
  if (fileReadable(sourcePath)) {
    try {
      raw = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
    } catch (error) {
      warnings.push(`session registry parse failed (${sourcePath}): ${String(error)}`);
    }
  }
  const normalized = normalizeSessionRegistryPayload(raw, namespaceKey);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(normalized, undefined, 2)}\n`, "utf8");
  } catch (error) {
    warnings.push(`session registry write failed (${path}): ${String(error)}`);
  }
  return {
    registry: normalized,
    warnings,
  };
}

export function saveSessionRegistry(homeDir: string, namespaceKey: string, payload: SessionRegistryPayload): string[] {
  const warnings: string[] = [];
  const normalized = normalizeSessionRegistryPayload(payload, namespaceKey);
  const path = sessionRegistryFilePath(homeDir, namespaceKey);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(normalized, undefined, 2)}\n`, "utf8");
  } catch (error) {
    warnings.push(`session registry write failed (${path}): ${String(error)}`);
  }
  return warnings;
}
