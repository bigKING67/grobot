import { createRunStartModelOps } from "../../cli/start/model-ops";
import { type ProviderModelListResult } from "../../cli/provider-probe";
import {
  type TerminalSelectMenuInput,
} from "../../cli/tui/components/select-menu/contract";

function parseModelField(
  snapshot: string,
  key:
    | "model"
    | "source"
    | "session_id"
    | "session_title"
    | "session_summary",
): string {
  const localizedKey = {
    model: "模型",
    source: "来源",
    session_id: "会话",
    session_title: "主题",
    session_summary: "重点",
  }[key];
  const match = new RegExp(`(?:^|\\n)\\s*(?:⎿\\s+)?${localizedKey}(?:[:：])?\\s+([^\\n]+)`).exec(snapshot);
  if (!match) {
    return "";
  }
  return (match[1] ?? "").trim();
}

function hidesModelMachineSurface(snapshot: string): boolean {
  const forbidden = [
    "[model]",
    "[model-list]",
    "供应商=",
    "供应商:",
    "模型=",
    "来源=",
    "路径=",
  ];
  return forbidden.every((token) => !snapshot.includes(token));
}

async function main(): Promise<void> {
  let activeSessionId = "session-main";
  let listCalls = 0;
  let pauseCalls = 0;
  let capturedModelMenu: TerminalSelectMenuInput | undefined;
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
    runSelectMenu: async (menu) => {
      capturedModelMenu = menu;
      return {
        kind: "cancelled",
      };
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

  const switchModelOutput = await captureOutput(async () => {
    await ops.useModel("model-variant");
  });
  const mainSessionSnapshot = await captureOutput(async () => {
    await ops.showModelCurrent();
  });
  const resetModelOutput = await captureOutput(async () => {
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
  const modelMenuCancelledSnapshot = await captureOutput(async () => {
    await ops.openModelMenu(async (operation) => {
      pauseCalls += 1;
      return operation();
    });
  });
  const capturedCurrentItem = capturedModelMenu?.items.find((item) =>
    item.id === "model-default"
  );

  const payload = {
    initial_snapshot_provider: initialModelSnapshot.providerName,
    initial_snapshot_model: initialModelSnapshot.model,
    initial_snapshot_source: initialModelSnapshot.source,
    initial_model: parseModelField(initialSnapshot, "model"),
    initial_source: parseModelField(initialSnapshot, "source"),
    initial_session_title: parseModelField(initialSnapshot, "session_title"),
    initial_session_summary: parseModelField(initialSnapshot, "session_summary"),
    model_current_surface_is_human:
      initialSnapshot.includes("当前模型")
      && !initialSnapshot.includes("● 当前模型")
      && initialSnapshot.includes("• 通道 provider-main")
      && initialSnapshot.includes("⎿  模型 model-default")
      && initialSnapshot.includes("⎿  会话 session-main")
      && initialSnapshot.includes("⎿  主题 Main Session")
      && initialSnapshot.includes("⎿  重点 Trace model override and reset contract")
      && !initialSnapshot.includes("供应商")
      && !initialSnapshot.includes("标题")
      && !initialSnapshot.includes("摘要")
      && !initialSnapshot.includes("模型:")
      && !initialSnapshot.includes("会话:")
      && hidesModelMachineSurface(initialSnapshot),
    model_switch_surface_is_human:
      switchModelOutput.includes("已切换模型")
      && !switchModelOutput.includes("● 已切换模型")
      && switchModelOutput.includes("• 通道 provider-main")
      && switchModelOutput.includes("⎿  模型 model-variant")
      && switchModelOutput.includes("⎿  配置 /tmp/grobot-contract.config.toml")
      && hidesModelMachineSurface(switchModelOutput),
    model_reset_surface_is_human:
      resetModelOutput.includes("已恢复启动模型")
      && !resetModelOutput.includes("● 已恢复启动模型")
      && resetModelOutput.includes("• 通道 provider-main")
      && resetModelOutput.includes("⎿  模型 model-default")
      && resetModelOutput.includes("⎿  配置 /tmp/grobot-contract.config.toml")
      && hidesModelMachineSurface(resetModelOutput),
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
    list_surface_is_human:
      listedSnapshot.includes("可用模型")
      && !listedSnapshot.includes("● 可用模型")
      && listedSnapshot.includes("通道 provider-main")
      && listedSnapshot.includes("⎿  当前 model-default · 2 个模型")
      && !listedSnapshot.includes("供应商")
      && !listedSnapshot.includes("当前:")
      && !listedSnapshot.includes("数量")
      && hidesModelMachineSurface(listedSnapshot),
    list_output_has_current_marker: listedSnapshot.includes("* model-default"),
    list_output_has_variant: listedSnapshot.includes("• model-variant"),
    model_menu_pause_calls: pauseCalls,
    model_menu_variant: capturedModelMenu?.variant ?? "",
    model_menu_title_is_localized:
      capturedModelMenu?.title === "选择模型",
    model_menu_subtitle_is_compact:
      capturedModelMenu?.subtitle === "切换当前配置模型，后续会话沿用；自定义模型用 /model use <id>。",
    model_menu_hint_is_reference_compact:
      capturedModelMenu?.hint === "Enter 确认 · Esc 返回",
    model_menu_initial_index_points_to_current:
      capturedModelMenu?.initialIndex === 0,
    model_menu_current_item_marked: capturedCurrentItem?.current === true,
    model_menu_omits_noisy_default_descriptions:
      capturedModelMenu?.items.every((item) => item.description !== "Provider 可用") === true,
    model_menu_meta_current_model:
      capturedModelMenu?.modelPickerMeta?.currentModel ?? "",
    model_menu_meta_startup_model:
      capturedModelMenu?.modelPickerMeta?.startupModel ?? "",
    model_menu_cancel_is_silent: modelMenuCancelledSnapshot.length === 0,
    runtime_source_after_switch: runtimeModelConfigSource.model,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
