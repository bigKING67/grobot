export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return null;
  }
  return normalized;
}

export function asStrictNonNegativeInteger(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return null;
  }
  return value;
}

export function parseRuntimeJsonRpcResult(stdout: string): {
  ok: boolean;
  detail: string;
  result?: Record<string, unknown>;
} {
  const firstLine = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return { ok: false, detail: "empty_stdout" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(firstLine);
  } catch (error) {
    return { ok: false, detail: `json_parse_failed: ${String(error)}` };
  }
  if (!isRecord(payload)) {
    return { ok: false, detail: "invalid_json_payload" };
  }
  if (isRecord(payload.error)) {
    const errorCode = payload.error.code;
    const errorMessage = payload.error.message;
    return {
      ok: false,
      detail: `jsonrpc_error code=${String(errorCode)} message=${String(errorMessage)}`,
    };
  }
  const result = payload.result;
  if (!isRecord(result)) {
    return { ok: false, detail: "missing_result" };
  }
  return { ok: true, detail: "ok", result };
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    rows.push(normalized);
  }
  return rows;
}

export function dedupeStringArray(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

export function parseStrictStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      return null;
    }
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

export function recordKeysMatch(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((key, index) => key === expected[index]);
}

export function stringArraysDisjoint(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  return right.every((item) => !leftSet.has(item));
}

export function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fnv1a32HexFromUtf8(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
