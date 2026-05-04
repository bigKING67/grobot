import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseStringArray(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return [];
  }
  return body.split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter((item) => item.length > 0);
}

function parseServersToml(tomlText) {
  const warnings = [];
  const rows = [];
  let current = null;
  for (const rawLine of tomlText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line === "[[servers]]") {
      current = {};
      rows.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      current[key] = value.slice(1, -1);
      continue;
    }
    if (value === "true" || value === "false") {
      current[key] = value === "true";
      continue;
    }
    if (value.startsWith("[")) {
      current[key] = parseStringArray(value);
      continue;
    }
    current[key] = value;
  }
  const servers = [];
  for (const row of rows) {
    const name = typeof row.name === "string" ? row.name : "";
    const command = typeof row.command === "string" ? row.command : "";
    const args = Array.isArray(row.args) ? row.args.filter((item) => typeof item === "string") : [];
    const enabledRaw = row.enabled;
    let enabled = true;
    if (enabledRaw !== void 0 && typeof enabledRaw !== "boolean") {
      warnings.push(`invalid enabled for server ${name || "<unknown>"}`);
      continue;
    }
    if (typeof enabledRaw === "boolean") {
      enabled = enabledRaw;
    }
    if (!name || !command) {
      warnings.push(`invalid server row missing name/command`);
      continue;
    }
    servers.push({ name, command, args, enabled });
  }
  return { servers, warnings };
}

export function resolveMcpRuntimeMerge(payload) {
  const globalPath = resolve(String(payload.global_path ?? ""));
  const projectPath = resolve(String(payload.project_path ?? ""));
  const globalText = readFileSync(globalPath, "utf8");
  const projectText = readFileSync(projectPath, "utf8");
  const globalParsed = parseServersToml(globalText);
  const projectParsed = parseServersToml(projectText);
  const warnings = [...globalParsed.warnings, ...projectParsed.warnings];
  const merged = /* @__PURE__ */ new Map();
  for (const row of globalParsed.servers) {
    merged.set(row.name, { row, source: `global:${globalPath}` });
  }
  for (const row of projectParsed.servers) {
    merged.set(row.name, { row, source: `project:${projectPath}` });
  }
  const effective = [...merged.values()].map((item) => ({
    name: item.row.name,
    command: item.row.command,
    args: item.row.args,
    enabled: item.row.enabled,
    source: item.source,
    ready: item.row.enabled ? true : null
  }));
  const enabledRows = effective.filter((item) => item.enabled);
  const disabledRows = effective.filter((item) => !item.enabled);
  return {
    mcp_runtime: {
      total: effective.length,
      enabled_count: enabledRows.length,
      disabled_count: disabledRows.length,
      ready_count: enabledRows.length,
      unready_count: 0,
      enabled: enabledRows.map((item) => item.name),
      disabled: disabledRows.map((item) => item.name),
      effective
    },
    warnings
  };
}

export function resolveMcpRuntimeInvalid(payload) {
  const globalPath = resolve(String(payload.global_path ?? ""));
  const globalText = readFileSync(globalPath, "utf8");
  const parsed = parseServersToml(globalText);
  return {
    mcp_runtime: {
      total: parsed.servers.length,
      enabled_count: parsed.servers.filter((item) => item.enabled).length,
      ready_count: parsed.servers.filter((item) => item.enabled).length,
      unready_count: 0
    },
    warnings: parsed.warnings
  };
}
