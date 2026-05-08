import { readFileSync } from "node:fs";
import {
  type MutableProject,
  type MutableProvider,
  type ProjectProviderPoolSnapshot,
  type ProjectProviderSnapshot,
  type ProviderSnapshot,
} from "./contract";
import { normalizeConfigPathForMatch, toAbsolutePath } from "./path";
import {
  fileReadable,
  parseTomlBoolean,
  parseTomlNumber,
  parseTomlString,
  parseTomlStringArray,
  stripInlineComment,
} from "./toml";

function parseProjectsFromToml(configTomlPath: string): MutableProject[] | undefined {
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
        assignProviderTomlValue(currentProvider, key, value, kvMatch[2]);
      }
    }
  } catch {
    return undefined;
  }
  return projects;
}

function assignProviderTomlValue(
  currentProvider: MutableProvider,
  key: string,
  value: string,
  rawValue: string,
): void {
  const recordError = (field: string, detail: string): void => {
    currentProvider.configErrors ??= [];
    currentProvider.configErrors.push({ field, detail });
  };
  const assignBoolean = (field: string, apply: (value: boolean) => void): void => {
    const parsed = parseTomlBoolean(rawValue);
    if (typeof parsed !== "boolean") {
      recordError(field, `${field.replace(/_/g, "-")} must be boolean`);
      return;
    }
    apply(parsed);
  };
  const assignNumber = (field: string, apply: (value: number) => void): void => {
    const parsed = parseTomlNumber(rawValue);
    if (typeof parsed !== "number") {
      recordError(field, `${field.replace(/_/g, "-")} must be a number`);
      return;
    }
    apply(parsed);
  };
  if (key === "name") {
    currentProvider.name = value;
  } else if (key === "base_url") {
    currentProvider.baseUrl = value;
  } else if (key === "api_key") {
    currentProvider.apiKey = value;
  } else if (key === "model") {
    currentProvider.model = value;
  } else if (key === "provider_kind") {
    currentProvider.providerKind = value;
  } else if (key === "kimi_web_search_mode") {
    currentProvider.kimiWebSearchMode = value;
  } else if (key === "kimi_disable_thinking_on_builtin_web_search") {
    assignBoolean(key, (parsed) => {
      currentProvider.kimiDisableThinkingOnBuiltinWebSearch = parsed;
    });
  } else if (key === "kimi_official_tools_allowlist") {
    currentProvider.kimiOfficialToolsAllowlist = parseTomlStringArray(rawValue);
  } else if (key === "kimi_max_tokens") {
    assignNumber(key, (parsed) => {
      currentProvider.kimiMaxTokens = parsed;
    });
  } else if (key === "kimi_stream") {
    assignBoolean(key, (parsed) => {
      currentProvider.kimiStream = parsed;
    });
  } else if (key === "kimi_temperature") {
    assignNumber(key, (parsed) => {
      currentProvider.kimiTemperature = parsed;
    });
  } else if (key === "kimi_top_p") {
    assignNumber(key, (parsed) => {
      currentProvider.kimiTopP = parsed;
    });
  } else if (key === "kimi_files_enabled") {
    assignBoolean(key, (parsed) => {
      currentProvider.kimiFilesEnabled = parsed;
    });
  } else if (key === "kimi_allow_file_admin") {
    assignBoolean(key, (parsed) => {
      currentProvider.kimiAllowFileAdmin = parsed;
    });
  } else if (key === "prompt_cache_enabled" || key === "kimi_prompt_cache_enabled") {
    assignBoolean(key, (parsed) => {
      currentProvider.promptCacheEnabled = parsed;
    });
  } else if (key === "prompt_cache_strategy" || key === "kimi_prompt_cache_strategy") {
    currentProvider.promptCacheStrategy = value;
  } else if (key === "prompt_cache_user_last_n" || key === "kimi_prompt_cache_user_last_n") {
    assignNumber(key, (parsed) => {
      currentProvider.promptCacheUserLastN = parsed;
    });
  } else if (key === "prompt_cache_capability" || key === "kimi_prompt_cache_capability") {
    currentProvider.promptCacheCapability = value;
  } else if (key === "priority") {
    assignNumber(key, (parsed) => {
      currentProvider.priority = parsed;
    });
  } else if (key === "weight") {
    assignNumber(key, (parsed) => {
      currentProvider.weight = parsed;
    });
  } else if (key === "unit_cost" || key === "cost_per_1k_tokens") {
    assignNumber(key, (parsed) => {
      currentProvider.unitCost = parsed;
    });
  } else if (key === "max_inflight" || key === "max_in_flight") {
    assignNumber(key, (parsed) => {
      currentProvider.maxInFlight = parsed;
    });
  } else if (key === "requests_per_minute" || key === "rpm") {
    assignNumber(key, (parsed) => {
      currentProvider.requestsPerMinute = parsed;
    });
  } else if (key === "burst" || key === "bucket_burst") {
    assignNumber(key, (parsed) => {
      currentProvider.burst = parsed;
    });
  }
}

function selectProject(
  projects: readonly MutableProject[],
  projectName: string,
  workDir: string,
  homeDir: string,
): MutableProject {
  const normalizedWorkDir = normalizeConfigPathForMatch(workDir);
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
}

function normalizeProviderSnapshot(raw: MutableProvider, fallbackName: string): ProviderSnapshot {
  const resolvedName = raw.name?.trim();
  const providerKind = raw.providerKind?.trim();
  const kimiWebSearchMode = raw.kimiWebSearchMode?.trim();
  const promptCacheStrategy = raw.promptCacheStrategy?.trim();
  const promptCacheCapability = raw.promptCacheCapability?.trim();
  const kimiOfficialToolsAllowlist = Array.isArray(raw.kimiOfficialToolsAllowlist)
    ? raw.kimiOfficialToolsAllowlist
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : undefined;
  return {
    name: resolvedName && resolvedName.length > 0 ? resolvedName : fallbackName,
    baseUrl: raw.baseUrl?.trim(),
    apiKey: raw.apiKey?.trim(),
    model: raw.model?.trim(),
    providerKind: providerKind && providerKind.length > 0 ? providerKind : undefined,
    kimiWebSearchMode: kimiWebSearchMode && kimiWebSearchMode.length > 0 ? kimiWebSearchMode : undefined,
    kimiDisableThinkingOnBuiltinWebSearch: raw.kimiDisableThinkingOnBuiltinWebSearch,
    kimiOfficialToolsAllowlist,
    kimiMaxTokens: typeof raw.kimiMaxTokens === "number" ? raw.kimiMaxTokens : undefined,
    kimiStream: raw.kimiStream,
    kimiTemperature: typeof raw.kimiTemperature === "number" ? raw.kimiTemperature : undefined,
    kimiTopP: typeof raw.kimiTopP === "number" ? raw.kimiTopP : undefined,
    kimiFilesEnabled: raw.kimiFilesEnabled,
    kimiAllowFileAdmin: raw.kimiAllowFileAdmin,
    promptCacheEnabled: raw.promptCacheEnabled,
    promptCacheStrategy: promptCacheStrategy && promptCacheStrategy.length > 0 ? promptCacheStrategy : undefined,
    promptCacheUserLastN:
      typeof raw.promptCacheUserLastN === "number"
        ? raw.promptCacheUserLastN
        : undefined,
    promptCacheCapability:
      promptCacheCapability && promptCacheCapability.length > 0
        ? promptCacheCapability
        : undefined,
    priority: typeof raw.priority === "number" ? raw.priority : undefined,
    weight: typeof raw.weight === "number" ? raw.weight : undefined,
    unitCost: typeof raw.unitCost === "number" ? raw.unitCost : undefined,
    maxInFlight: typeof raw.maxInFlight === "number" ? raw.maxInFlight : undefined,
    requestsPerMinute: typeof raw.requestsPerMinute === "number" ? raw.requestsPerMinute : undefined,
    burst: typeof raw.burst === "number" ? raw.burst : undefined,
    configErrors: raw.configErrors,
  };
}

function buildOrderedProviders(
  selectedProject: MutableProject,
  providerOverride?: string,
): { requestedName?: string; providers: ProviderSnapshot[] } {
  const selectedName = selectedProject.selectedProvider?.trim();
  const overrideName = providerOverride?.trim();
  const requestedName = overrideName && overrideName.length > 0 ? overrideName : selectedName;
  if (!Array.isArray(selectedProject.providers) || selectedProject.providers.length === 0) {
    return {
      requestedName,
      providers: [],
    };
  }
  const ordered: MutableProvider[] = [];
  if (requestedName && requestedName.length > 0) {
    const matched = selectedProject.providers.find((item) => item.name?.trim() === requestedName);
    if (matched) {
      ordered.push(matched);
    }
  }
  for (const item of selectedProject.providers) {
    if (ordered.includes(item)) {
      continue;
    }
    ordered.push(item);
  }
  return {
    requestedName,
    providers: ordered.map((item, index) =>
      normalizeProviderSnapshot(
        item,
        requestedName && requestedName.length > 0 ? requestedName : `provider-${String(index + 1)}`,
      ),
    ),
  };
}

export function readProviderPoolFromToml(
  configTomlPath: string | undefined,
  projectName: string,
  workDir: string,
  homeDir: string,
  providerOverride?: string,
): ProjectProviderPoolSnapshot | undefined {
  if (!configTomlPath || !fileReadable(configTomlPath)) {
    return undefined;
  }
  const projects = parseProjectsFromToml(configTomlPath);
  if (!projects || !projects.length) {
    return undefined;
  }
  const selectedProject = selectProject(projects, projectName, workDir, homeDir);
  const ordered = buildOrderedProviders(selectedProject, providerOverride);
  return {
    projectName: selectedProject.name?.trim() || projectName,
    providerName: ordered.requestedName || ordered.providers[0]?.name,
    providers: ordered.providers,
    source: `config_toml:${configTomlPath}`,
  };
}

export function readProviderSnapshotFromToml(
  configTomlPath: string | undefined,
  projectName: string,
  workDir: string,
  homeDir: string,
  providerOverride?: string,
): ProjectProviderSnapshot | undefined {
  const pool = readProviderPoolFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverride,
  );
  if (!pool) {
    return undefined;
  }
  const provider = pool.providers[0];
  return {
    projectName: pool.projectName,
    providerName: pool.providerName,
    provider,
    source: pool.source,
  };
}
