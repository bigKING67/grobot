import { formatProviderHealthSnapshot } from "../provider-health";
import type { RunStartModelSnapshot } from "../model-ops";
import { compactSingleLine } from "../session-history";
import { resolveAgentsInstructionBlock } from "../../services/agents-instructions";
import { buildCompactNotice } from "./notice-surface";
import { buildSkillsStatusSurface } from "./skill-surfaces";
import type {
  CreateRunStartInteractiveModeInput,
  InteractiveModeBindingPatch,
} from "./contract";

export function createInteractiveStatusSurfaces(
  input: CreateRunStartInteractiveModeInput,
  getModelSnapshot: () => RunStartModelSnapshot,
): Pick<
  InteractiveModeBindingPatch,
  | "showHealthStatus"
  | "showContextStatus"
  | "showMemoryStatus"
  | "showSkillsStatus"
  | "showMcpStatus"
  | "showHistory"
> {
  const showHistory = async (queryRaw?: string): Promise<void> => {
    const query = (queryRaw ?? "").trim().toLowerCase();
    const allRows = input.runtimeState.getHistoryMessages();
    if (allRows.length === 0) {
      input.output.writeStdout(
        buildCompactNotice("对话历史", ["暂无对话历史。"]),
      );
      return;
    }
    const filteredRows =
      query.length > 0
        ? allRows.filter((row) => row.content.toLowerCase().includes(query))
        : allRows;
    const renderRows = filteredRows.slice(-20);
    const lines: string[] = [
      "● 对话历史",
      `  总数: ${String(allRows.length)}`,
      `  匹配: ${String(filteredRows.length)}`,
      `  查询: ${query.length > 0 ? query : "无"}`,
      `  显示最近: ${String(renderRows.length)}`,
    ];
    if (renderRows.length === 0) {
      lines.push("  没有匹配记录。");
      lines.push("");
      input.output.writeStdout(`${lines.join("\n")}\n`);
      return;
    }
    for (const row of renderRows) {
      const role = row.role === "assistant" ? "助手" : "用户";
      lines.push(`- ${role}: ${compactSingleLine(row.content, 220)}`);
    }
    lines.push("");
    input.output.writeStdout(`${lines.join("\n")}\n`);
  };

  const showContextStatus = (): void => {
    const agentsInstructions = resolveAgentsInstructionBlock({
      projectRoot: input.projectRoot,
      workDir: input.workDir,
    });
    const modelSnapshot = getModelSnapshot();
    const cachedModelWindow = input.modelOps.getCachedModelContextWindowTokens(
      modelSnapshot.model,
    );
    const effectiveWindow =
      typeof cachedModelWindow === "number"
        ? cachedModelWindow
        : input.contextEngineConfig.contextWindowTokens;
    input.output.writeStdout(
      [
        "● 上下文",
        "  定义: 本轮发送前组装的有界上下文窗口",
        "  系统提示: SYSTEM.md 内置",
        `  上下文引擎: ${input.contextEngineConfig.enabled ? "开启" : "关闭"} · profile ${input.contextEngineConfig.profile}`,
        `  上下文窗口 tokens: ${typeof effectiveWindow === "number" ? String(effectiveWindow) : "未知"}`,
        `  自动压缩阈值: ${typeof input.contextEngineConfig.autoCompactTokenLimit === "number" ? String(input.contextEngineConfig.autoCompactTokenLimit) : "auto"}`,
        `  历史消息: ${String(input.runtimeState.getHistoryMessages().length)}`,
        `  项目指令来源: ${agentsInstructions.sources.length > 0 ? agentsInstructions.sources.join(",") : "无"}`,
        "  关系: memory 是可检索素材，不等同于当前上下文窗口",
        "",
      ].join("\n"),
    );
  };

  const showMemoryStatus = (): void => {
    const policy = input.memoryOrchestrator.policySnapshot();
    const sessionKey = input.runtimeState.getSessionKey();
    const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
    input.output.writeStdout(
      [
        "● 记忆",
        "  定义: 跨回合/会话/项目的持久记忆层",
        `  记忆编排: ${policy.enabled ? "开启" : "关闭"} · version ${policy.version} · 预算比例 ${policy.injectBudgetRatio.toFixed(2)} · 单段上限 ${String(policy.maxSectionTokens)} · GA 行 ${String(policy.maxGaMemoryRows)} · 团队行 ${String(policy.maxTeamExperienceRows)} · 团队最低分 ${policy.minTeamExperienceScore.toFixed(2)}`,
        `  衰减: ${policy.decayEnabled ? "开启" : "关闭"} · 最大行 ${String(policy.decayMaxRowsPerSession)} · 最小保留 ${String(policy.decayMinRowsToKeep)}`,
        `  GA 状态: 记忆行 ${String(gaState?.memory.length ?? 0)} · skill 卡 ${String(gaState?.skillCards.length ?? 0)} · 反思 ${String(gaState?.reflectionQueue.length ?? 0)} · 待处理询问 ${String(gaState?.pendingAskQueue?.length ?? 0)}`,
        "  关系: memory 是持久素材，只有被选中的片段会进入当前上下文窗口",
        "",
      ].join("\n"),
    );
  };

  const showSkillsStatus = (): void => {
    input.output.writeStdout(
      buildSkillsStatusSurface({
        homeDir: input.homeDir,
        projectRoot: input.projectRoot,
      }),
    );
  };

  const showMcpStatus = (): void => {
    const hasInstructionPack =
      (input.mcpInstructionPromptPrefix?.trim() ?? "").length > 0;
    const serverNames =
      input.mcpInstructionServerNames.length > 0
        ? input.mcpInstructionServerNames.join(",")
        : "无";
    input.output.writeStdout(
      [
        "● MCP",
        `  服务: ${serverNames}`,
        `  指令包: ${hasInstructionPack ? "已加载" : "无"}`,
        `  严格失败: ${input.mcpInstructionStrictFailure ?? "无"}`,
        "  显式调用: mcp_call(server, tool)",
        "  路由提示: /health 查看 provider failover；启动诊断会显示 MCP 指令注入",
        "",
      ].join("\n"),
    );
  };

  const showHealthStatus = (): void => {
    input.output.writeStdout(
      formatProviderHealthSnapshot({
        sessionKey: input.runtimeState.getSessionKey(),
        stickyProvider: input.runtimeState.getStickyProvider(),
        failureThreshold: input.runtimeFailoverConfig.circuitFailures,
        cooldownSecs: input.runtimeFailoverConfig.circuitCooldownSecs,
        providers: input.runtimeProviderChain.map((provider) => ({
          name: provider.name,
          maxInFlight: provider.maxInFlight,
          requestsPerMinute: provider.requestsPerMinute,
          burst: provider.burst,
        })),
        states: input.runtimeState.getProviderRuntimeStates(),
      }),
    );
  };

  return {
    showHealthStatus,
    showContextStatus,
    showMemoryStatus,
    showSkillsStatus,
    showMcpStatus,
    showHistory,
  };
}
