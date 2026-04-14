import { type RuntimeModelConfig } from "../../../../models/types";
import {
  listProviderModels,
  type ProviderModelListResult,
} from "../provider-probe";
import {
  runTerminalSelectMenu,
  type TerminalSelectMenuItem,
} from "./run-start-io";

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

interface CreateRunStartModelOpsInput {
  runtimeProviderChain: ReadonlyArray<RuntimeProviderEntry>;
  runtimeModelConfig?: RuntimeModelConfig;
  runtimeModelConfigSource: { model: string };
  getActiveSessionId(): string;
  getActiveSessionMetadata?(): ActiveSessionMetadata | undefined;
  writeStdout(message: string): void;
  listProviderModelsByConnection?(
    baseUrl: string,
    apiKey: string,
  ): Promise<ProviderModelListResult>;
}

interface FetchAvailableModelsOk {
  ok: true;
  providerName: string;
  currentModel?: string;
  modelIds: string[];
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

export interface RunStartModelOps {
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

function resolveModelSourceLabel(input: {
  sessionId: string;
  sessionModelOverrides: ReadonlyMap<string, string>;
  defaultModelSource: string;
}): string {
  if (input.sessionModelOverrides.has(input.sessionId)) {
    return "session:/model";
  }
  return input.defaultModelSource;
}

function buildModelMenuItems(input: {
  modelIds: ReadonlyArray<string>;
  currentModel?: string;
}): TerminalSelectMenuItem[] {
  return input.modelIds.map((modelId) => ({
    id: modelId,
    label: modelId,
    description:
      modelId === input.currentModel ? "Current active model" : undefined,
    current: modelId === input.currentModel,
  }));
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

export function createRunStartModelOps(
  input: CreateRunStartModelOpsInput,
): RunStartModelOps {
  const listProviderModelsByConnection =
    input.listProviderModelsByConnection ?? listProviderModels;
  const sessionModelOverrides = new Map<string, string>();
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

  const initialPrimaryTarget = resolvePrimaryModelTarget();
  const defaultPrimaryModel = initialPrimaryTarget.modelConfig?.model?.trim();
  const defaultModelSource = input.runtimeModelConfigSource.model;

  const applyModelOverrideForSession = (sessionId: string): void => {
    const target = resolvePrimaryModelTarget();
    if (!target.modelConfig) {
      return;
    }
    const overrideModel = sessionModelOverrides.get(sessionId);
    const effectiveModel = overrideModel ?? defaultPrimaryModel;
    if (effectiveModel && effectiveModel.trim().length > 0) {
      target.modelConfig.model = effectiveModel.trim();
    } else {
      delete target.modelConfig.model;
    }
    input.runtimeModelConfigSource.model = resolveModelSourceLabel({
      sessionId,
      sessionModelOverrides,
      defaultModelSource,
    });
  };

  const applyModelOverrideForActiveSession = (): void => {
    applyModelOverrideForSession(input.getActiveSessionId());
  };

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
      };
    };

  const applyModelToActiveSession = (modelId: string): void => {
    const activeSessionId = input.getActiveSessionId();
    sessionModelOverrides.set(activeSessionId, modelId);
    applyModelOverrideForSession(activeSessionId);
  };

  const showModelCurrent = async (): Promise<void> => {
    const connection = resolveModelConnection();
    const activeSessionId = input.getActiveSessionId();
    const source = resolveModelSourceLabel({
      sessionId: activeSessionId,
      sessionModelOverrides,
      defaultModelSource,
    });
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
        `[model]\nprovider: ${connection.providerName}\nmodel: ${connection.currentModel ?? "<unset>"}\nsource: ${source}\nsession_id: ${activeSessionId}\nsession_title: ${sessionTitle}\nsession_summary: ${sessionSummary}\n\n`,
      );
    };

  const listModels = async (): Promise<void> => {
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(`[model] list failed: ${available.message}\n\n`);
      return;
    }
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
        input.writeStdout("Usage: /model use <model_id>\n\n");
        return;
      }
    const available = await fetchAvailableModels();
    if (!available.ok) {
      input.writeStdout(`[model] switch failed: ${available.message}\n\n`);
      return;
    }
    if (!available.modelIds.includes(requestedModelId)) {
      input.writeStdout(
        `[model] switch failed: "${requestedModelId}" not found for provider=${available.providerName}\n`,
      );
      input.writeStdout(
        `[model] available: ${available.modelIds.join(", ")}\n\n`,
      );
      return;
      }
      applyModelToActiveSession(requestedModelId);
      input.writeStdout(
        `[model] switched session=${input.getActiveSessionId()} provider=${available.providerName} model=${requestedModelId}\n\n`,
      );
    };

    const resetModel = async (): Promise<void> => {
      const activeSessionId = input.getActiveSessionId();
      sessionModelOverrides.delete(activeSessionId);
      applyModelOverrideForSession(activeSessionId);
      const connection = resolveModelConnection();
      input.writeStdout(
        `[model] reset session=${activeSessionId} provider=${connection.providerName} model=${connection.currentModel ?? "<unset>"}\n\n`,
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
    if (available.modelIds.length === 0) {
      input.writeStdout(
        `[model] provider=${available.providerName} returned no models.\n\n`,
      );
      return;
    }
    const items = buildModelMenuItems({
      modelIds: available.modelIds,
      currentModel: available.currentModel,
    });
    const initialIndex = resolveModelMenuInitialIndex({
      items,
      currentModel: available.currentModel,
    });
    const picked = await withInputPaused(() =>
      runTerminalSelectMenu({
        title: "Select Model",
        subtitle: `Provider: ${available.providerName}`,
        hint: "Use ↑/↓ (or j/k), Enter to confirm, Esc to cancel.",
        items,
        initialIndex,
      }),
    );
    if (picked.kind === "cancelled") {
      input.writeStdout("[model] picker cancelled.\n\n");
      return;
    }
    applyModelToActiveSession(picked.item.id);
    input.writeStdout(
      `[model] switched session=${input.getActiveSessionId()} provider=${available.providerName} model=${picked.item.id}\n\n`,
    );
  };

    return {
      showModelCurrent,
      listModels,
      useModel,
      resetModel,
      openModelMenu,
      applyModelOverrideForSession,
      applyModelOverrideForActiveSession,
    };
  }
