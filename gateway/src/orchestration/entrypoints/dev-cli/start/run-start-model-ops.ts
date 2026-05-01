import { type RuntimeModelConfig } from "../../../../models/types";
import {
  listProviderModels,
  type ProviderModelListResult,
} from "../provider-probe";
import {
  runTerminalSelectMenu,
  type TerminalSelectMenuInput,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuResult,
} from "./run-start-io";
import {
  persistRunStartModelToConfig,
  type PersistRunStartModelToConfigResult,
} from "./run-start-model-config-sync";

interface RuntimeProviderEntry {
  name: string;
  modelConfig?: RuntimeModelConfig;
}

interface PrimaryModelTarget {
  providerName: string;
  modelConfig?: RuntimeModelConfig;
}

interface ActiveSessionMetadata {
  title?: string;
  summary?: string;
}

interface PersistModelToConfigInput {
  providerName: string;
  modelId: string;
}

type PersistModelToConfigResult =
  | {
    ok: true;
    source: string;
    path?: string;
    providerName?: string;
    previousModel?: string;
  }
  | {
    ok: false;
    message: string;
  };

interface CreateRunStartModelOpsInput {
  runtimeProviderChain: ReadonlyArray<RuntimeProviderEntry>;
  runtimeModelConfig?: RuntimeModelConfig;
  runtimeModelConfigSource: { model: string };
  configTomlPath?: string;
  homeDir: string;
  workDir: string;
  projectName: string;
  getActiveSessionId(): string;
  getActiveSessionMetadata?(): ActiveSessionMetadata | undefined;
  writeStdout(message: string): void;
  runSelectMenu?(
    menu: TerminalSelectMenuInput,
  ): Promise<TerminalSelectMenuResult>;
  listProviderModelsByConnection?(
    baseUrl: string,
    apiKey: string,
  ): Promise<ProviderModelListResult>;
  persistModelToConfig?(
    input: PersistModelToConfigInput,
  ): Promise<PersistModelToConfigResult>;
}

interface FetchAvailableModelsOk {
  ok: true;
  providerName: string;
  currentModel?: string;
  modelIds: string[];
  modelContextWindowTokensById: Record<string, number>;
}

interface FetchAvailableModelsFailure {
  ok: false;
  message: string;
}

type FetchAvailableModelsResult =
  | FetchAvailableModelsOk
  | FetchAvailableModelsFailure;

interface ModelConnection {
  providerName: string;
  currentModel?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface RunStartModelSnapshot {
  providerName: string;
  model: string;
  source: string;
}

export interface RunStartModelOps {
  getCurrentModelSnapshot(): RunStartModelSnapshot;
  getCachedModelContextWindowTokens(modelId: string): number | undefined;
  refreshModelCatalogCache(): Promise<void>;
  showModelCurrent(): Promise<void>;
  listModels(): Promise<void>;
  useModel(modelIdRaw: string): Promise<void>;
  resetModel(): Promise<void>;
  openModelMenu(
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void>;
  applyModelOverrideForSession(sessionId: string): void;
  applyModelOverrideForActiveSession(): void;
}

const MODEL_MENU_DESCRIPTIONS: Record<string, string> = {
  "gpt-5.5": "Frontier model for complex coding, research, and real-world work.",
  "gpt-5.4": "Strong model for everyday coding.",
  "gpt-5.4-mini": "Small, fast, and cost-efficient model for simpler coding tasks.",
  "gpt-5.3-codex": "Coding-optimized model.",
  "gpt-5.2": "Optimized for professional work and long-running agents.",
  "gpt-5.1-codex": "Optimized for Codex. Balance of reasoning quality and coding ability.",
  "gpt-5.1-codex-mini": "Optimized for Codex. Cheaper, faster, but less capable.",
  "gpt-4.1-codex": "Legacy model. Use when compatibility with older automations matters.",
};

function normalizeModelIds(raw: readonly string[]): string[] {
  const deduped = new Set<string>();
  for (const model of raw) {
    const trimmed = model.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
  }
  return Array.from(deduped.values());
}

function normalizeSessionMetadataValue(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function formatTokenWindow(tokens: number | undefined): string | undefined {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return undefined;
  }
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}M context window`;
  }
  if (tokens >= 1_000) {
    return `${String(Math.round(tokens / 1_000))}K context window`;
  }
  return `${String(Math.floor(tokens))} token context window`;
}

function resolveModelMenuDescription(input: {
  modelId: string;
  modelContextWindowTokens?: number;
}): string {
  const normalizedModelId = input.modelId.trim();
  const knownDescription = MODEL_MENU_DESCRIPTIONS[normalizedModelId];
  if (knownDescription) {
    return knownDescription;
  }
  const contextWindow = formatTokenWindow(input.modelContextWindowTokens);
  if (contextWindow) {
    return contextWindow;
  }
  return "Available from provider.";
}

function buildModelMenuItems(input: {
  modelIds: ReadonlyArray<string>;
  currentModel?: string;
  startupModel?: string;
  modelContextWindowTokensById?: Record<string, number>;
}): TerminalSelectMenuItem[] {
  const items: TerminalSelectMenuItem[] = [];
  for (const modelId of input.modelIds) {
    const isCurrent = modelId === input.currentModel;
    items.push({
      id: modelId,
      label: modelId,
      description: resolveModelMenuDescription({
        modelId,
        modelContextWindowTokens: input.modelContextWindowTokensById?.[modelId],
      }),
      current: isCurrent,
    });
  }
  return items;
}

function resolveModelMenuInitialIndex(input: {
  items: ReadonlyArray<TerminalSelectMenuItem>;
  currentModel?: string;
}): number {
  return Math.max(
    0,
    input.currentModel
      ? input.items.findIndex((item) => item.id === input.currentModel)
      : 0,
  );
}

function toPersistModelResult(
  input: PersistRunStartModelToConfigResult,
): PersistModelToConfigResult {
  if (!input.ok) {
    return {
      ok: false,
      message: input.message,
    };
  }
  return {
    ok: true,
    source: input.source,
    path: input.path,
    previousModel: input.previousModel,
    providerName: input.providerName,
  };
}

export function createRunStartModelOps(
  input: CreateRunStartModelOpsInput,
): RunStartModelOps {
  const listProviderModelsByConnection =
    input.listProviderModelsByConnection ?? listProviderModels;
  const runSelectMenu = input.runSelectMenu ?? runTerminalSelectMenu;
  const modelContextWindowTokensCache = new Map<string, number>();
  const resolvePrimaryModelTarget = (): PrimaryModelTarget => {
    if (input.runtimeProviderChain.length > 0) {
      const firstProvider = input.runtimeProviderChain[0];
      return {
        providerName: firstProvider.name,
        modelConfig: firstProvider.modelConfig,
      };
    }
    return {
      providerName: "default",
      modelConfig: input.runtimeModelConfig,
    };
  };

  const startupPrimaryModel = resolvePrimaryModelTarget().modelConfig?.model?.trim();
  const persistModelToConfig = input.persistModelToConfig
    ?? (async (params: PersistModelToConfigInput): Promise<PersistModelToConfigResult> =>
      toPersistModelResult(await persistRunStartModelToConfig({
        configTomlPath: input.configTomlPath,
        projectName: input.projectName,
        workDir: input.workDir,
        homeDir: input.homeDir,
        providerName: params.providerName,
        modelId: params.modelId,
      })));

  const resolveModelConnection = (): ModelConnection => {
    const target = resolvePrimaryModelTarget();
    return {
      providerName: target.providerName,
      currentModel: target.modelConfig?.model?.trim(),
      baseUrl: target.modelConfig?.baseUrl?.trim(),
      apiKey: target.modelConfig?.apiKey?.trim(),
    };
  };

  const fetchAvailableModels =
    async (): Promise<FetchAvailableModelsResult> => {
      const connection = resolveModelConnection();
      if (!connection.baseUrl || !connection.apiKey) {
        return {
          ok: false,
          message: "missing base_url/api_key for current provider",
        };
      }
      const listed = await listProviderModelsByConnection(
        connection.baseUrl,
        connection.apiKey,
      );
      if (listed.state !== "ok") {
        return {
          ok: false,
          message: listed.detail,
        };
      }
      return {
        ok: true,
        providerName: connection.providerName,
        currentModel: connection.currentModel,
        modelIds: normalizeModelIds(listed.modelIds),
        modelContextWindowTokensById: listed.modelContextWindowTokensById ?? {},
      };
    };

  const updateModelContextWindowTokensCache = (
    modelContextWindowTokensById: Record<string, number>,
  ): void => {
    for (const [modelId, tokens] of Object.entries(modelContextWindowTokensById)) {
      const normalizedModelId = modelId.trim();
      if (
        normalizedModelId.length === 0
        || !Number.isFinite(tokens)
        || tokens <= 0
      ) {
        continue;
      }
      modelContextWindowTokensCache.set(normalizedModelId, Math.floor(tokens));
    }
  };

  const getCachedModelContextWindowTokens = (modelId: string): number | undefined => {
    const normalizedModelId = modelId.trim();
    if (normalizedModelId.length === 0) {
      return undefined;
    }
    return modelContextWindowTokensCache.get(normalizedModelId);
  };

  const refreshModelCatalogCache = async (): Promise<void> => {
    const available = await fetchAvailableModels();
    if (!available.ok) {
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
  };

  const applyModelSelection = async (modelId: string): Promise<PersistModelToConfigResult> => {
    const requestedModel = modelId.trim();
    if (!requestedModel) {
      return {
        ok: false,
        message: "model switch failed: target model is empty",
      };
    }
    const target = resolvePrimaryModelTarget();
    if (!target.modelConfig) {
      return {
        ok: false,
        message: "model switch failed: runtime provider model config is unavailable",
      };
    }
    const persisted = await persistModelToConfig({
      providerName: target.providerName,
      modelId: requestedModel,
    });
    if (!persisted.ok) {
      return persisted;
    }
    target.modelConfig.model = requestedModel;
    input.runtimeModelConfigSource.model = persisted.source;
    return persisted;
  };

  const switchModel = async (
    requestedModelId: string,
    availableInput?: FetchAvailableModelsOk,
  ): Promise<void> => {
    const modelId = requestedModelId.trim();
    if (!modelId) {
      input.writeStdout("[model] switch failed: target model is empty.\n\n");
      return;
    }
    const available = availableInput ?? await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(`[model] switch failed: ${available.message}\n\n`);
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (!available.modelIds.includes(modelId)) {
      input.writeStdout(
        `[model] switch failed: "${modelId}" not found for provider=${available.providerName}\n`,
      );
      input.writeStdout(
        `[model] available: ${available.modelIds.join(", ")}\n\n`,
      );
      return;
    }
    const persisted = await applyModelSelection(modelId);
    if (!persisted.ok) {
      input.writeStdout(`[model] switch failed: ${persisted.message}\n\n`);
      return;
    }
    input.writeStdout(
      `[model] switched provider=${available.providerName} model=${modelId} source=${persisted.source}${persisted.path ? ` path=${persisted.path}` : ""}\n\n`,
    );
  };

  const getCurrentModelSnapshot = (): RunStartModelSnapshot => {
    const connection = resolveModelConnection();
    return {
      providerName: connection.providerName,
      model: connection.currentModel ?? "<unset>",
      source: input.runtimeModelConfigSource.model,
    };
  };

  const showModelCurrent = async (): Promise<void> => {
    const snapshot = getCurrentModelSnapshot();
    const activeSessionId = input.getActiveSessionId();
    const activeSessionMetadata = input.getActiveSessionMetadata?.();
    const sessionTitle = normalizeSessionMetadataValue(
      activeSessionMetadata?.title,
      "<untitled>",
    );
    const sessionSummary = normalizeSessionMetadataValue(
      activeSessionMetadata?.summary,
      "<none>",
    );
    input.writeStdout(
      `[model]\nprovider: ${snapshot.providerName}\nmodel: ${snapshot.model}\nsource: ${snapshot.source}\nsession_id: ${activeSessionId}\nsession_title: ${sessionTitle}\nsession_summary: ${sessionSummary}\n\n`,
    );
  };

  const listModels = async (): Promise<void> => {
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(`[model] list failed: ${available.message}\n\n`);
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (available.modelIds.length === 0) {
      input.writeStdout(
        `[model] provider=${available.providerName} returned no models.\n\n`,
      );
      return;
    }
    input.writeStdout(
      `[model-list] provider=${available.providerName} count=${String(available.modelIds.length)} current=${available.currentModel ?? "<unset>"}\n`,
    );
    for (const modelId of available.modelIds) {
      const marker = modelId === available.currentModel ? "*" : " ";
      input.writeStdout(`${marker} ${modelId}\n`);
    }
    input.writeStdout("\n");
  };

  const useModel = async (modelIdRaw: string): Promise<void> => {
    const requestedModelId = modelIdRaw.trim();
    if (!requestedModelId) {
      input.writeStdout("[model] switch failed: target model is empty.\n\n");
      return;
    }
    await switchModel(requestedModelId);
  };

  const resetModel = async (): Promise<void> => {
    if (!startupPrimaryModel || startupPrimaryModel.length === 0) {
      input.writeStdout("[model] reset failed: startup model is unavailable.\n\n");
      return;
    }
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(`[model] reset failed: ${available.message}\n\n`);
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (!available.modelIds.includes(startupPrimaryModel)) {
      input.writeStdout(
        `[model] reset failed: startup model "${startupPrimaryModel}" is not available for provider=${available.providerName}\n`,
      );
      input.writeStdout(
        `[model] available: ${available.modelIds.join(", ")}\n\n`,
      );
      return;
    }
    const persisted = await applyModelSelection(startupPrimaryModel);
    if (!persisted.ok) {
      input.writeStdout(`[model] reset failed: ${persisted.message}\n\n`);
      return;
    }
    input.writeStdout(
      `[model] reset provider=${available.providerName} model=${startupPrimaryModel} source=${persisted.source}${persisted.path ? ` path=${persisted.path}` : ""}\n\n`,
    );
  };

  const openModelMenu = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(`[model] picker unavailable: ${available.message}\n\n`);
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (available.modelIds.length === 0) {
      input.writeStdout(
        `[model] provider=${available.providerName} returned no models.\n\n`,
      );
      return;
    }
    const items = buildModelMenuItems({
      modelIds: available.modelIds,
      currentModel: available.currentModel,
      startupModel: startupPrimaryModel,
      modelContextWindowTokensById: available.modelContextWindowTokensById,
    });
    const initialIndex = resolveModelMenuInitialIndex({
      items,
      currentModel: available.currentModel,
    });
    const picked = await withInputPaused(() =>
      runSelectMenu({
        title: "选择模型",
        subtitle:
          "切换当前会话模型；历史/自定义模型可用 /model use <id>。",
        hint: "Enter 确认 · Esc 返回",
        items,
        initialIndex,
        variant: "model_picker",
        modelPickerMeta: {
          providerName: available.providerName,
          currentModel: available.currentModel,
          startupModel: startupPrimaryModel,
          totalModelCount: available.modelIds.length,
          sessionId: input.getActiveSessionId(),
          sessionTitle: input.getActiveSessionMetadata?.()?.title,
          sessionSummary: input.getActiveSessionMetadata?.()?.summary,
        },
      }),
    );
    if (picked.kind === "cancelled") {
      return;
    }
    await switchModel(picked.item.id, available);
  };

  const applyModelOverrideForSession = (_sessionId: string): void => {
    // /model now uses config_toml as single source of truth.
  };

  const applyModelOverrideForActiveSession = (): void => {
    // /model now uses config_toml as single source of truth.
  };

  return {
    getCurrentModelSnapshot,
    getCachedModelContextWindowTokens,
    refreshModelCatalogCache,
    showModelCurrent,
    listModels,
    useModel,
    resetModel,
    openModelMenu,
    applyModelOverrideForSession,
    applyModelOverrideForActiveSession,
  };
}
