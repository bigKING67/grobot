import { type RuntimeModelConfig } from "../../models/types";
import {
  listProviderModels,
  type ProviderModelListResult,
} from "../provider-probe";
import {
  type TerminalSelectMenuInput,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuResult,
} from "../tui/components/select-menu/contract";
import { runTerminalSelectMenu } from "../tui/components/select-menu/controller";
import { renderInfoPanel } from "../tui/components/info-panel/render";
import type { InfoPanelRow } from "../tui/components/info-panel/contract";
import {
  persistRunStartModelToConfig,
  type PersistRunStartModelToConfigResult,
} from "./model-config-sync";

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
  "gpt-5.5": "Complex coding, research, long tasks",
  "gpt-5.4": "Daily coding and general tasks",
  "gpt-5.4-mini": "Small fast model for simple tasks",
  "gpt-5.3-codex": "Codex optimized model",
  "gpt-5.2": "Professional work and long agent tasks",
  "gpt-5.1-codex": "Codex optimized for reasoning and coding",
  "gpt-5.1-codex-mini": "Codex lightweight model, faster and cheaper",
  "gpt-4.1-codex": "Legacy compatibility model for old automation",
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
    return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}M context`;
  }
  if (tokens >= 1_000) {
    return `${String(Math.round(tokens / 1_000))}K context`;
  }
  return `${String(Math.floor(tokens))} token context`;
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
  return "";
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

function buildModelNotice(
  title: string,
  lines: ReadonlyArray<string> = [],
): string {
  const normalized = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const [primary, ...details] = normalized;
  return renderInfoPanel({
    title,
    sections: [{
      rows: [{
        title: primary ?? "No details",
        detailLines: details,
      }],
    }],
  });
}

function buildPersistedModelLines(input: {
  providerName: string;
  modelId: string;
  source: string;
  path?: string;
}): string[] {
  return [
    `provider ${input.providerName}`,
    `model ${input.modelId}`,
    `source ${input.source}`,
    ...(input.path ? [`config ${input.path}`] : []),
  ];
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
          message: "Current provider is missing base URL or API key",
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
        message: "Missing target model",
      };
    }
    const target = resolvePrimaryModelTarget();
    if (!target.modelConfig) {
      return {
        ok: false,
        message: "Runtime model provider config unavailable",
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
      input.writeStdout(buildModelNotice("Switch model failed", [
        "Missing target model.",
      ]));
      return;
    }
    const available = availableInput ?? await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(buildModelNotice("Switch model failed", [
        `${available.message}.`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (!available.modelIds.includes(modelId)) {
      input.writeStdout(buildModelNotice("Switch model failed", [
        `"${modelId}" is not in provider ${available.providerName}'s model list.`,
        `available models ${available.modelIds.join(", ")}`,
      ]));
      return;
    }
    const persisted = await applyModelSelection(modelId);
    if (!persisted.ok) {
      input.writeStdout(buildModelNotice("Switch model failed", [
        `${persisted.message}。`,
      ]));
      return;
    }
    input.writeStdout(
      buildModelNotice("Model switched", buildPersistedModelLines({
        providerName: available.providerName,
        modelId,
        source: persisted.source,
        path: persisted.path,
      })),
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
      buildModelNotice("Current model", [
        `provider ${snapshot.providerName}`,
        `model ${snapshot.model}`,
        `source ${snapshot.source}`,
        `session ${activeSessionId}`,
        ...(sessionTitle === "<untitled>" ? [] : [`topic ${sessionTitle}`]),
        ...(sessionSummary === "<none>" ? [] : [`summary ${sessionSummary}`]),
      ]),
    );
  };

  const listModels = async (): Promise<void> => {
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(buildModelNotice("Model list unavailable", [
        `${available.message}.`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (available.modelIds.length === 0) {
      input.writeStdout(buildModelNotice("No available models", [
        `provider ${available.providerName}`,
      ]));
      return;
    }
    const rows: InfoPanelRow[] = [{
      title: `provider ${available.providerName}`,
      detailLines: [
        `current ${available.currentModel ?? "<unset>"} · ${String(available.modelIds.length)} models`,
      ],
    }];
    for (const modelId of available.modelIds) {
      rows.push({
        title: modelId === available.currentModel
          ? `* ${modelId}`
          : modelId,
        tone: modelId === available.currentModel ? "brand" : "muted",
      });
    }
    input.writeStdout(renderInfoPanel({
      title: "Available models",
      sections: [{ rows }],
    }));
  };

  const useModel = async (modelIdRaw: string): Promise<void> => {
    const requestedModelId = modelIdRaw.trim();
    if (!requestedModelId) {
      input.writeStdout(buildModelNotice("Switch model failed", [
        "Missing target model.",
      ]));
      return;
    }
    await switchModel(requestedModelId);
  };

  const resetModel = async (): Promise<void> => {
    if (!startupPrimaryModel || startupPrimaryModel.length === 0) {
      input.writeStdout(buildModelNotice("Reset startup model failed", [
        "Startup model unavailable.",
      ]));
      return;
    }
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(buildModelNotice("Reset startup model failed", [
        `${available.message}.`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (!available.modelIds.includes(startupPrimaryModel)) {
      input.writeStdout(buildModelNotice("Reset startup model failed", [
        `Startup model "${startupPrimaryModel}" is not in provider ${available.providerName}'s model list.`,
        `available models ${available.modelIds.join(", ")}`,
      ]));
      return;
    }
    const persisted = await applyModelSelection(startupPrimaryModel);
    if (!persisted.ok) {
      input.writeStdout(buildModelNotice("Reset startup model failed", [
        `${persisted.message}。`,
      ]));
      return;
    }
    input.writeStdout(
      buildModelNotice("Startup model restored", buildPersistedModelLines({
        providerName: available.providerName,
        modelId: startupPrimaryModel,
        source: persisted.source,
        path: persisted.path,
      })),
    );
  };

  const openModelMenu = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(buildModelNotice("Model picker unavailable", [
        `${available.message}.`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (available.modelIds.length === 0) {
      input.writeStdout(buildModelNotice("No available models", [
        `provider ${available.providerName}`,
      ]));
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
        title: "Select model",
        subtitle:
          "Switch the configured model for future sessions; use /model use <id> for custom models.",
        hint: "Enter confirm · Esc back",
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
