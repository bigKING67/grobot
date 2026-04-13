import { IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";

function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("\"")) {
    const match = trimmed.match(/^"([^"]*)"/);
    if (match && typeof match[1] === "string") {
      return match[1].trim();
    }
  }
  return trimmed;
}

function toAbsolutePath(rawPath: string, homeDir: string, baseDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return removeTrailingSlashes(baseDir);
  }
  let expanded = trimmed;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/")) {
    expanded = `${homeDir}/${expanded.slice(2)}`;
  }
  if (expanded.startsWith("/") || expanded.startsWith("\\")) {
    return removeTrailingSlashes(expanded);
  }
  return removeTrailingSlashes(`${removeTrailingSlashes(baseDir)}/${expanded}`);
}

export interface ProviderProbeResult {
  state: "ok" | "warn" | "error";
  detail: string;
  httpStatus?: number;
  modelCount?: number;
  selectedModel?: string;
  selectedFound?: boolean;
}

interface ProviderSnapshot {
  name: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface ProjectProviderSnapshot {
  projectName: string;
  providerName?: string;
  provider?: ProviderSnapshot;
  source: string;
}

function normalizeConfigPathForMatch(path: string): string {
  return removeTrailingSlashes(path).replace(/\\/g, "/");
}

export function readProviderSnapshotFromToml(
  configTomlPath: string | undefined,
  projectName: string,
  workDir: string,
  homeDir: string,
  providerOverride?: string,
): ProjectProviderSnapshot | undefined {
  if (!configTomlPath || !fileReadable(configTomlPath)) {
    return undefined;
  }
  interface MutableProvider {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }
  interface MutableProject {
    name?: string;
    workDir?: string;
    selectedProvider?: string;
    providers: MutableProvider[];
  }
  const projects: MutableProject[] = [];
  let currentProject: MutableProject | undefined;
  let currentProvider: MutableProvider | undefined;
  let section = "";
  try {
    const raw = readFileSync(configTomlPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = stripInlineComment(rawLine).trim();
      if (!line) {
        continue;
      }
      const arraySectionMatch = line.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
      if (arraySectionMatch) {
        section = arraySectionMatch[1];
        if (section === "projects") {
          currentProject = {
            providers: [],
          };
          projects.push(currentProject);
          currentProvider = undefined;
        } else if (section === "projects.agent.providers") {
          if (currentProject) {
            currentProvider = {};
            currentProject.providers.push(currentProvider);
          }
        } else {
          currentProvider = undefined;
        }
        continue;
      }
      const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        if (section !== "projects.agent.providers") {
          currentProvider = undefined;
        }
        continue;
      }
      const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
      if (!kvMatch) {
        continue;
      }
      const key = kvMatch[1];
      const value = parseTomlString(kvMatch[2]);
      if (!value || !currentProject) {
        continue;
      }
      if (section === "projects") {
        if (key === "name") {
          currentProject.name = value;
        } else if (key === "work_dir") {
          currentProject.workDir = value;
        }
        continue;
      }
      if (section === "projects.agent") {
        if (key === "provider") {
          currentProject.selectedProvider = value;
        }
        continue;
      }
      if (section === "projects.agent.providers" && currentProvider) {
        if (key === "name") {
          currentProvider.name = value;
        } else if (key === "base_url") {
          currentProvider.baseUrl = value;
        } else if (key === "api_key") {
          currentProvider.apiKey = value;
        } else if (key === "model") {
          currentProvider.model = value;
        }
      }
    }
  } catch {
    return undefined;
  }

  if (!projects.length) {
    return undefined;
  }
  const normalizedWorkDir = normalizeConfigPathForMatch(workDir);
  const selectProject = (): MutableProject => {
    const byName = projects.find((item) => {
      if (typeof item.name !== "string") {
        return false;
      }
      return item.name.trim() === projectName;
    });
    if (byName) {
      return byName;
    }
    const byWorkDir = projects.find((item) => {
      if (typeof item.workDir !== "string" || !item.workDir.trim()) {
        return false;
      }
      const expanded = toAbsolutePath(item.workDir, homeDir, process.cwd());
      return normalizeConfigPathForMatch(expanded) === normalizedWorkDir;
    });
    if (byWorkDir) {
      return byWorkDir;
    }
    return projects[0];
  };
  const selectedProject = selectProject();
  const selectedName = selectedProject.selectedProvider?.trim();
  const overrideName = providerOverride?.trim();
  const requestedName = overrideName && overrideName.length > 0 ? overrideName : selectedName;
  const provider = requestedName
    ? selectedProject.providers.find((item) => item.name?.trim() === requestedName) ?? selectedProject.providers[0]
    : selectedProject.providers[0];
  if (!provider) {
    return {
      projectName: selectedProject.name?.trim() || projectName,
      providerName: requestedName,
      provider: undefined,
      source: `config_toml:${configTomlPath}`,
    };
  }
  return {
    projectName: selectedProject.name?.trim() || projectName,
    providerName: requestedName || provider.name?.trim(),
    provider: {
      name: provider.name?.trim() || requestedName || "<unknown>",
      baseUrl: provider.baseUrl?.trim(),
      apiKey: provider.apiKey?.trim(),
      model: provider.model?.trim(),
    },
    source: `config_toml:${configTomlPath}`,
  };
}

function normalizeProbeBaseUrl(rawBaseUrl: string): URL {
  const trimmed = rawBaseUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/models`;
  url.search = "";
  url.hash = "";
  return url;
}

function parseModelIdsFromProbePayload(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const parsed = payload as Record<string, unknown>;
  const rawData = parsed.data;
  if (Array.isArray(rawData)) {
    return rawData
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return "";
        }
        const id = (item as Record<string, unknown>).id;
        return typeof id === "string" ? id.trim() : "";
      })
      .filter((id) => id.length > 0);
  }
  const rawModels = parsed.models;
  if (Array.isArray(rawModels)) {
    return rawModels
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (typeof item === "object" && item !== null) {
          const id = (item as Record<string, unknown>).id;
          return typeof id === "string" ? id.trim() : "";
        }
        return "";
      })
      .filter((id) => id.length > 0);
  }
  return [];
}

export async function probeProviderModels(
  baseUrl: string,
  apiKey: string,
  modelHint: string | undefined,
): Promise<ProviderProbeResult> {
  let url: URL;
  try {
    url = normalizeProbeBaseUrl(baseUrl);
  } catch (error) {
    return {
      state: "error",
      detail: `invalid base_url: ${String(error)}`,
    };
  }
  const requestFactory = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : undefined,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": "grobot-ts-dev-cli/0.1",
    },
    timeout: 5_000,
  };

  return await new Promise<ProviderProbeResult>((resolve) => {
    const req = requestFactory(requestOptions, (res: IncomingMessage) => {
      let body = "";
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          const snippet = body.trim().slice(0, 240);
          resolve({
            state: "warn",
            detail: `http_${String(statusCode)} ${snippet || "<empty-body>"}`,
            httpStatus: statusCode,
          });
          return;
        }
        try {
          const payload = JSON.parse(body) as unknown;
          const modelIds = parseModelIdsFromProbePayload(payload);
          const normalizedHint = modelHint?.trim();
          const selectedFound = normalizedHint
            ? modelIds.some((item) => item === normalizedHint)
            : undefined;
          resolve({
            state: "ok",
            detail: normalizedHint
              ? `models=${String(modelIds.length)} selected=${selectedFound ? "matched" : "missing"}`
              : `models=${String(modelIds.length)}`,
            httpStatus: statusCode,
            modelCount: modelIds.length,
            selectedModel: normalizedHint,
            selectedFound,
          });
        } catch (error) {
          resolve({
            state: "warn",
            detail: `invalid_json_response: ${String(error)}`,
            httpStatus: statusCode,
          });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error: Error) => {
      resolve({
        state: "error",
        detail: String(error),
      });
    });
    req.end();
  });
}
