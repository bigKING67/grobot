import { isAbsolute, resolve } from "node:path";
import { isRecord } from "./common.mjs";

export function resolveSourceRoots(payload) {
  const rawRoots = Array.isArray(payload.sourceRoots) ? payload.sourceRoots : [];
  const rows = [];
  const dedup = new Set();
  for (const raw of rawRoots) {
    if (!isRecord(raw)) {
      continue;
    }
    const source = String(raw.source ?? "").trim().toLowerCase();
    const rootPathRaw = String(raw.rootPath ?? "").trim();
    if (!source || !rootPathRaw) {
      continue;
    }
    const rootPath = isAbsolute(rootPathRaw)
      ? rootPathRaw
      : resolve(process.cwd(), rootPathRaw);
    const key = `${source}:${rootPath}`;
    if (dedup.has(key)) {
      continue;
    }
    dedup.add(key);
    rows.push({ source, rootPath });
  }
  return rows;
}
