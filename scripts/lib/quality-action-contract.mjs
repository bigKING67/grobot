import { createHash } from "node:crypto";

export const QUALITY_ACTION_CONTRACT_SCHEMA_VERSION = 1;

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeStringArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value))
    .filter(Boolean))]
    .sort();
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveInteger(value, fallback = 1) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function toolchainsForGate(gate) {
  const command = normalizeString(gate?.command);
  const toolchains = ["node", "npm"];
  if (gate?.group === "runtime" || command.includes("cargo ")) {
    toolchains.push("cargo", "rustc");
  }
  const explicitToolchains = normalizeStringArray(gate?.toolchains ?? []);
  return explicitToolchains.length > 0 ? explicitToolchains : normalizeStringArray(toolchains);
}

export function resolveGateActionContract(gate) {
  const name = normalizeString(gate?.name);
  const command = normalizeString(gate?.command);
  const cachePolicy = normalizeString(gate?.cachePolicy) || (gate?.cacheable === true ? "pass-only" : "never");
  return Object.freeze({
    schema: QUALITY_ACTION_CONTRACT_SCHEMA_VERSION,
    name,
    command,
    workdir: normalizeString(gate?.workdir) || ".",
    inputs: Object.freeze(normalizeStringArray(gate?.inputs ?? ["package.json", "package-lock.json"])),
    outputs: Object.freeze(normalizeStringArray(gate?.outputs ?? [])),
    env: Object.freeze(normalizeStringArray(gate?.env ?? [])),
    toolchains: Object.freeze(toolchainsForGate(gate)),
    deps: Object.freeze(normalizeStringArray(gate?.deps ?? [])),
    group: normalizeString(gate?.group),
    modes: Object.freeze(normalizeStringArray(gate?.modes ?? [])),
    cachePolicy,
    cacheable: cachePolicy !== "never" && normalizeBoolean(gate?.cacheable, false),
    parallel: normalizeBoolean(gate?.parallel, true),
    cost: normalizeString(gate?.cost) || "medium",
    resourceClass: normalizeString(gate?.resourceClass) || "node",
    resourceCost: normalizePositiveInteger(gate?.resourceCost, 1),
    exclusiveGroup: normalizeString(gate?.exclusiveGroup),
    timeoutMs: normalizePositiveInteger(gate?.timeoutMs, 0),
  });
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeActionContractFingerprint(actionContract) {
  return `sha256:${createHash("sha256").update(stableJson(actionContract)).digest("hex")}`;
}
