import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function pathJoin(...parts) {
  return resolve(...parts);
}

export function pathDirname(path) {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return slashIndex === 0 ? "/" : ".";
  }
  return normalized.slice(0, slashIndex);
}

export function writeText(path, content) {
  mkdirSync(pathDirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function writeJson(path, payload) {
  writeText(path, `${JSON.stringify(payload, void 0, 2)}
`);
}

export function findProjectRoot(startPath) {
  let current = resolve(startPath);
  for (;;) {
    const candidate = pathJoin(current, ".grobot", "project.toml");
    try {
      const _ = readFileSync(candidate, "utf8");
      return current;
    } catch {
    }
    const parent = pathDirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
