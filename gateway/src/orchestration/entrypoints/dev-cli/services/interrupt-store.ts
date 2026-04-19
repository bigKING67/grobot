import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface InterruptStorePayload {
  version: number;
  entries: Record<string, number>;
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function nowEpochSec(): number {
  return Math.floor(Date.now() / 1_000);
}

function resolveLegacyInterruptStorePath(path: string): string | undefined {
  const separator = path.includes("\\") ? "\\" : "/";
  const replaced = path.replace(
    /[\\/]sessions[\\/]interrupts\.json$/,
    `${separator}session${separator}interrupts.json`,
  );
  if (replaced === path) {
    return undefined;
  }
  return replaced;
}

function loadInterruptStore(path: string): InterruptStorePayload {
  let sourcePath = path;
  if (!existsSync(sourcePath)) {
    const legacyPath = resolveLegacyInterruptStorePath(path);
    if (legacyPath && existsSync(legacyPath)) {
      sourcePath = legacyPath;
    } else {
      return {
        version: 1,
        entries: {},
      };
    }
  }
  try {
    const raw = readFileSync(sourcePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { version: 1, entries: {} };
    }
    const record = parsed as Record<string, unknown>;
    const rawEntries = record.entries;
    const entries: Record<string, number> = {};
    if (typeof rawEntries === "object" && rawEntries !== null) {
      for (const [key, value] of Object.entries(rawEntries as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          entries[key] = Math.floor(value);
        }
      }
    }
    return {
      version: 1,
      entries,
    };
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveInterruptStore(path: string, payload: InterruptStorePayload): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function cleanupInterruptStore(payload: InterruptStorePayload): InterruptStorePayload {
  const now = nowEpochSec();
  const entries: Record<string, number> = {};
  for (const [sessionKey, expiry] of Object.entries(payload.entries)) {
    if (expiry > now) {
      entries[sessionKey] = expiry;
    }
  }
  return {
    version: 1,
    entries,
  };
}

export function setInterruptFlag(path: string, sessionKey: string, ttlSecs: number): void {
  const payload = cleanupInterruptStore(loadInterruptStore(path));
  payload.entries[sessionKey] = nowEpochSec() + ttlSecs;
  saveInterruptStore(path, payload);
}

export function consumeInterruptFlag(path: string, sessionKey: string): boolean {
  const payload = cleanupInterruptStore(loadInterruptStore(path));
  if (!payload.entries[sessionKey]) {
    return false;
  }
  delete payload.entries[sessionKey];
  saveInterruptStore(path, payload);
  return true;
}
