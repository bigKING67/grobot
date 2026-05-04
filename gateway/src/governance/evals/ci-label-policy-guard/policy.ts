import { createHash } from "node:crypto";
import { readJsonObject, sortJson } from "./json";
import { normalizePolicy } from "./normalize";
import { type JsonObject } from "./types";

export function loadCiLabelPolicy(policyPath: string): JsonObject {
  return readJsonObject(policyPath);
}

export function computeCiLabelPolicyFingerprint(path: string): { policyHash: string; canonical: JsonObject } {
  const policy = loadCiLabelPolicy(path);
  const canonical = normalizePolicy(policy);
  const encoded = JSON.stringify(sortJson(canonical));
  const digest = createHash("sha256").update(encoded).digest("hex");
  return { policyHash: `sha256:${digest}`, canonical };
}
