import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  clamp,
  createError,
  isRecord,
} from "./common.mjs";

export function parseArgs(argv) {
  const command = String(argv[0] ?? "").trim();
  if (!command) {
    throw createError("semantic_invalid_request", "missing bridge command");
  }
  const options = {
    payload: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "").trim();
    if (!token) {
      continue;
    }
    if (token === "--payload") {
      const value = String(argv[index + 1] ?? "");
      if (!value || value.startsWith("--")) {
        throw createError("semantic_invalid_request", "missing value for --payload");
      }
      options.payload = value;
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      const value = String(argv[index + 1] ?? "");
      if (!/^\d+$/.test(value)) {
        throw createError("semantic_invalid_request", "invalid value for --timeout-ms");
      }
      const parsed = Number.parseInt(value, 10);
      options.timeoutMs = clamp(parsed, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
      index += 1;
      continue;
    }
    throw createError("semantic_invalid_request", `unknown argument: ${token}`);
  }
  if (!options.payload) {
    throw createError("semantic_invalid_request", "missing --payload");
  }
  let payload;
  try {
    payload = JSON.parse(options.payload);
  } catch (error) {
    throw createError(
      "semantic_invalid_request",
      `payload is not valid JSON: ${String(error)}`,
    );
  }
  if (!isRecord(payload)) {
    throw createError("semantic_invalid_request", "payload must be a JSON object");
  }
  return { command, payload, timeoutMs: options.timeoutMs };
}
