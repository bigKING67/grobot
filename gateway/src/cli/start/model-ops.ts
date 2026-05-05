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
  "gpt-5.5": "复杂编码、研究与长任务",
  "gpt-5.4": "日常编码与通用任务",
  "gpt-5.4-mini": "小型快速模型，适合简单任务",
  "gpt-5.3-codex": "Codex 优化模型",
  "gpt-5.2": "专业工作与长时 agent 任务",
  "gpt-5.1-codex": "Codex 优化，兼顾推理和编码",
  "gpt-5.1-codex-mini": "Codex 轻量模型，更快更省",
  "gpt-4.1-codex": "旧版兼容模型，适合老自动化",
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
    return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}M 上下文`;
  }
  if (tokens >= 1_000) {
    return `${String(Math.round(tokens / 1_000))}K 上下文`;
  }
  return `${String(Math.floor(tokens))} token 上下文`;
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
        title: primary ?? "无更多信息",
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
    `通道 ${input.providerName}`,
    `模型 ${input.modelId}`,
    `来源 ${input.source}`,
    ...(input.path ? [`配置 ${input.path}`] : []),
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
          message: "当前通道缺少接口地址或密钥",
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
        message: "目标模型为空",
      };
    }
    const target = resolvePrimaryModelTarget();
    if (!target.modelConfig) {
      return {
        ok: false,
        message: "运行时模型通道配置不可用",
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
      input.writeStdout(buildModelNotice("切换模型失败", [
        "目标模型为空。",
      ]));
      return;
    }
    const available = availableInput ?? await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(buildModelNotice("切换模型失败", [
        `${available.message}。`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (!available.modelIds.includes(modelId)) {
      input.writeStdout(buildModelNotice("切换模型失败", [
        `"${modelId}" 不在通道 ${available.providerName} 的模型列表中。`,
        `可用模型 ${available.modelIds.join(", ")}`,
      ]));
      return;
    }
    const persisted = await applyModelSelection(modelId);
    if (!persisted.ok) {
      input.writeStdout(buildModelNotice("切换模型失败", [
        `${persisted.message}。`,
      ]));
      return;
    }
    input.writeStdout(
      buildModelNotice("已切换模型", buildPersistedModelLines({
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
      buildModelNotice("当前模型", [
        `通道 ${snapshot.providerName}`,
        `模型 ${snapshot.model}`,
        `来源 ${snapshot.source}`,
        `会话 ${activeSessionId}`,
        ...(sessionTitle === "<untitled>" ? [] : [`主题 ${sessionTitle}`]),
        ...(sessionSummary === "<none>" ? [] : [`重点 ${sessionSummary}`]),
      ]),
    );
  };

  const listModels = async (): Promise<void> => {
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(buildModelNotice("模型列表不可用", [
        `${available.message}。`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (available.modelIds.length === 0) {
      input.writeStdout(buildModelNotice("没有可用模型", [
        `通道 ${available.providerName}`,
      ]));
      return;
    }
    const rows: InfoPanelRow[] = [{
      title: `通道 ${available.providerName}`,
      detailLines: [
        `当前 ${available.currentModel ?? "<unset>"} · ${String(available.modelIds.length)} 个模型`,
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
      title: "可用模型",
      sections: [{ rows }],
    }));
  };

  const useModel = async (modelIdRaw: string): Promise<void> => {
    const requestedModelId = modelIdRaw.trim();
    if (!requestedModelId) {
      input.writeStdout(buildModelNotice("切换模型失败", [
        "目标模型为空。",
      ]));
      return;
    }
    await switchModel(requestedModelId);
  };

  const resetModel = async (): Promise<void> => {
    if (!startupPrimaryModel || startupPrimaryModel.length === 0) {
      input.writeStdout(buildModelNotice("恢复启动模型失败", [
        "启动模型不可用。",
      ]));
      return;
    }
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(buildModelNotice("恢复启动模型失败", [
        `${available.message}。`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (!available.modelIds.includes(startupPrimaryModel)) {
      input.writeStdout(buildModelNotice("恢复启动模型失败", [
        `启动模型 "${startupPrimaryModel}" 不在通道 ${available.providerName} 的模型列表中。`,
        `可用模型 ${available.modelIds.join(", ")}`,
      ]));
      return;
    }
    const persisted = await applyModelSelection(startupPrimaryModel);
    if (!persisted.ok) {
      input.writeStdout(buildModelNotice("恢复启动模型失败", [
        `${persisted.message}。`,
      ]));
      return;
    }
    input.writeStdout(
      buildModelNotice("已恢复启动模型", buildPersistedModelLines({
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
      input.writeStdout(buildModelNotice("模型选择器不可用", [
        `${available.message}。`,
      ]));
      return;
    }
    updateModelContextWindowTokensCache(available.modelContextWindowTokensById);
    if (available.modelIds.length === 0) {
      input.writeStdout(buildModelNotice("没有可用模型", [
        `通道 ${available.providerName}`,
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
        title: "选择模型",
        subtitle:
          "切换当前配置模型，后续会话沿用；自定义模型用 /model use <id>。",
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
