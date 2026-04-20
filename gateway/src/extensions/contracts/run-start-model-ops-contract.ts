import { createRunStartModelOps } from "../../orchestration/entrypoints/dev-cli/start/run-start-model-ops";
import { type ProviderModelListResult } from "../../orchestration/entrypoints/dev-cli/provider-probe";

function parseModelField(
  snapshot: string,
  key:
    | "model"
    | "source"
    | "session_id"
    | "session_title"
    | "session_summary",
): string {
  const marker = `${key}: `;
  const index = snapshot.indexOf(marker);
  if (index < 0) {
    return "";
  }
  const start = index + marker.length;
  const end = snapshot.indexOf("\n", start);
  if (end < 0) {
    return snapshot.slice(start).trim();
  }
  return snapshot.slice(start, end).trim();
}

async function main(): Promise<void> {
  let activeSessionId = "session-main";
  let listCalls = 0;
  const persistCalls: string[] = [];
  const stdoutChunks: string[] = [];
  const primaryModelConfig = {
    baseUrl: "https://model-provider.example.com/v1",
    apiKey: "model-provider-key",
    model: "model-default",
  };
  const sessionMetadata = new Map<string, { title: string; summary: string }>([
    [
      "session-main",
      {
        title: "Main Session",
        summary: "Trace model override and reset contract",
      },
    ],
    [
      "session-branch",
      {
        title: "Branch Session",
        summary: "Follow-up fallback regression",
      },
    ],
  ]);
  const runtimeModelConfigSource = { model: "config:provider:model" };
  const ops = createRunStartModelOps({
    runtimeProviderChain: [
      {
        name: "provider-main",
        modelConfig: primaryModelConfig,
      },
    ],
    runtimeModelConfig: undefined,
    runtimeModelConfigSource,
    homeDir: "/tmp",
    workDir: "/tmp/grobot-contract-workdir",
    projectName: "grobot-contract-project",
    getActiveSessionId: () => activeSessionId,
    getActiveSessionMetadata: () => sessionMetadata.get(activeSessionId),
    writeStdout: (message) => {
      stdoutChunks.push(message);
    },
    persistModelToConfig: async ({ providerName, modelId }) => {
      persistCalls.push(`${providerName}:${modelId}`);
      return {
        ok: true,
        source: "config_toml:provider.model",
        path: "/tmp/grobot-contract.config.toml",
        providerName,
      };
    },
    listProviderModelsByConnection: async (
      baseUrl: string,
      apiKey: string,
    ): Promise<ProviderModelListResult> => {
      listCalls += 1;
      if (
        baseUrl !== "https://model-provider.example.com/v1"
        || apiKey !== "model-provider-key"
      ) {
        return {
          state: "error",
          detail: "unexpected connection",
          modelIds: [],
        };
      }
      return {
        state: "ok",
        detail: "contract list",
        modelIds: ["model-default", "model-variant"],
      };
    },
  });

  const initialModelSnapshot = ops.getCurrentModelSnapshot();

  const captureOutput = async (operation: () => Promise<void>): Promise<string> => {
    const start = stdoutChunks.length;
    await operation();
    return stdoutChunks.slice(start).join("");
  };

  const initialSnapshot = await captureOutput(async () => {
    await ops.showModelCurrent();
  });

  await captureOutput(async () => {
    await ops.useModel("model-variant");
  });
  const mainSessionSnapshot = await captureOutput(async () => {
    await ops.showModelCurrent();
  });
  await captureOutput(async () => {
    await ops.resetModel();
  });
  const mainSessionAfterResetSnapshot = await captureOutput(async () => {
    await ops.showModelCurrent();
  });

  activeSessionId = "session-branch";
  ops.applyModelOverrideForActiveSession();
  const branchSessionSnapshot = await captureOutput(async () => {
    await ops.showModelCurrent();
  });

  const listedSnapshot = await captureOutput(async () => {
    await ops.listModels();
  });

  const payload = {
    initial_snapshot_provider: initialModelSnapshot.providerName,
    initial_snapshot_model: initialModelSnapshot.model,
    initial_snapshot_source: initialModelSnapshot.source,
    initial_model: parseModelField(initialSnapshot, "model"),
    initial_source: parseModelField(initialSnapshot, "source"),
    initial_session_title: parseModelField(initialSnapshot, "session_title"),
    initial_session_summary: parseModelField(initialSnapshot, "session_summary"),
    main_model_after_use: parseModelField(mainSessionSnapshot, "model"),
    main_source_after_use: parseModelField(mainSessionSnapshot, "source"),
    main_session_id_after_use: parseModelField(mainSessionSnapshot, "session_id"),
    main_session_title_after_use: parseModelField(
      mainSessionSnapshot,
      "session_title",
    ),
    main_session_summary_after_use: parseModelField(
      mainSessionSnapshot,
      "session_summary",
    ),
    main_model_after_reset: parseModelField(mainSessionAfterResetSnapshot, "model"),
    main_source_after_reset: parseModelField(mainSessionAfterResetSnapshot, "source"),
    branch_model_after_switch: parseModelField(branchSessionSnapshot, "model"),
    branch_source_after_switch: parseModelField(branchSessionSnapshot, "source"),
    branch_session_id_after_switch: parseModelField(branchSessionSnapshot, "session_id"),
    branch_session_title_after_switch: parseModelField(
      branchSessionSnapshot,
      "session_title",
    ),
    branch_session_summary_after_switch: parseModelField(
      branchSessionSnapshot,
      "session_summary",
    ),
    list_calls: listCalls,
    persist_call_count: persistCalls.length,
    persist_first_call: persistCalls[0] ?? "",
    persist_second_call: persistCalls[1] ?? "",
    list_output_has_current_marker: listedSnapshot.includes("* model-default"),
    list_output_has_variant: listedSnapshot.includes(" model-variant"),
    runtime_source_after_switch: runtimeModelConfigSource.model,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
