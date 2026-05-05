import { formatProviderHealthSnapshot } from "../status/provider-health";
import type { RunStartModelSnapshot } from "../model-ops";
import { compactSingleLine } from "../session/history";
import { resolveAgentsInstructionBlock } from "../../services/agents-instructions";
import { measureDisplayWidth } from "../../tui/terminal/display-width";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
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
      input.output.writeStdout(renderInfoPanel({
        title: "对话历史",
        subtitle: "最近对话记录",
        sections: [
          {
            rows: [
              {
                title: "暂无对话历史",
              },
            ],
          },
        ],
      }));
      return;
    }

    const filteredRows =
      query.length > 0
        ? allRows.filter((row) => row.content.toLowerCase().includes(query))
        : allRows;
    const renderRows = filteredRows.slice(-20);
    const historySummaryLine = `总数 ${String(allRows.length)} · 匹配 ${String(filteredRows.length)} · 查询 ${query.length > 0 ? query : "无"} · 最近 ${String(renderRows.length)}`;
    const historyWidth = Math.max(
      96,
      measureDisplayWidth(historySummaryLine) + 10,
      ...renderRows.map((row) =>
        measureDisplayWidth(`${row.role === "assistant" ? "助手" : "用户"} ${compactSingleLine(row.content, 220)}`) + 10,
      ),
    );

    if (renderRows.length === 0) {
      input.output.writeStdout(renderInfoPanel({
        title: "对话历史",
        subtitle: "最近对话记录",
        sections: [
          {
            rows: [
              {
                title: `总数 ${String(allRows.length)} · 匹配 ${String(filteredRows.length)} · 查询 ${query.length > 0 ? query : "无"}`,
                detailLines: ["没有匹配记录。"],
              },
            ],
          },
        ],
        terminalColumns: historyWidth,
      }));
      return;
    }

    input.output.writeStdout(renderInfoPanel({
      title: "对话历史",
      subtitle: "最近对话记录",
      sections: [
        {
          rows: [
            {
              title: historySummaryLine,
              detailLines: renderRows.map((row) => {
                const role = row.role === "assistant" ? "助手" : "用户";
                return `${role} ${compactSingleLine(row.content, 220)}`;
              }),
            },
          ],
        },
      ],
      terminalColumns: historyWidth,
    }));
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
    const autoCompactLabel =
      typeof input.contextEngineConfig.autoCompactTokenLimit === "number"
        ? String(input.contextEngineConfig.autoCompactTokenLimit)
        : "自动";
    const contextSummaryLine = `上下文引擎 · ${input.contextEngineConfig.enabled ? "开启" : "关闭"} · 档位 ${input.contextEngineConfig.profile}`;
    const contextWidth = Math.max(
      96,
      measureDisplayWidth("系统提示 · SYSTEM.md 内置") + 10,
      measureDisplayWidth(contextSummaryLine) + 10,
      measureDisplayWidth(`窗口 ${typeof effectiveWindow === "number" ? String(effectiveWindow) : "未知"} · 自动压缩 ${autoCompactLabel}`) + 10,
      measureDisplayWidth(`历史 ${String(input.runtimeState.getHistoryMessages().length)} 条`) + 10,
      measureDisplayWidth(`项目指令 ${agentsInstructions.sources.length > 0 ? agentsInstructions.sources.join(",") : "无"}`) + 10,
      measureDisplayWidth("记忆是可检索素材，不等同于当前上下文窗口") + 10,
    );

    input.output.writeStdout(renderInfoPanel({
      title: "上下文",
      subtitle: "每轮发送前组装的上下文窗口",
      sections: [
        {
          rows: [
            {
              title: "系统提示 · SYSTEM.md 内置",
            },
            {
              title: contextSummaryLine,
              detailLines: [
                `窗口 ${typeof effectiveWindow === "number" ? String(effectiveWindow) : "未知"} · 自动压缩 ${autoCompactLabel}`,
                `历史 ${String(input.runtimeState.getHistoryMessages().length)} 条`,
              ],
            },
            {
              title: "项目指令",
              detailLines: [
                agentsInstructions.sources.length > 0
                  ? agentsInstructions.sources.join(",")
                  : "无",
              ],
            },
            {
              title: "关系",
              detailLines: [
                "记忆是可检索素材，不等同于当前上下文窗口",
              ],
            },
          ],
        },
      ],
      terminalColumns: contextWidth,
    }));
  };

  const showMemoryStatus = (): void => {
    const policy = input.memoryOrchestrator.policySnapshot();
    const sessionKey = input.runtimeState.getSessionKey();
    const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
    const memorySummaryLine = `记忆编排 · ${policy.enabled ? "开启" : "关闭"} · 版本 ${policy.version}`;
    const memoryWidth = Math.max(
      96,
      measureDisplayWidth(memorySummaryLine) + 10,
      measureDisplayWidth(`预算比例 ${policy.injectBudgetRatio.toFixed(2)} · 单段上限 ${String(policy.maxSectionTokens)}`) + 10,
      measureDisplayWidth(`个人记忆 ${String(policy.maxGaMemoryRows)} 行 · 团队经验 ${String(policy.maxTeamExperienceRows)} 行 · 团队最低分 ${policy.minTeamExperienceScore.toFixed(2)}`) + 10,
      measureDisplayWidth(`最大行 ${String(policy.decayMaxRowsPerSession)} · 最小保留 ${String(policy.decayMinRowsToKeep)}`) + 10,
      measureDisplayWidth(`记忆 ${String(gaState?.memory.length ?? 0)} 条 · 技能卡 ${String(gaState?.skillCards.length ?? 0)} 张 · 反思 ${String(gaState?.reflectionQueue.length ?? 0)} 条 · 待处理询问 ${String(gaState?.pendingAskQueue?.length ?? 0)} 项`) + 10,
      measureDisplayWidth("记忆是持久素材，只有被选中的片段会进入当前上下文窗口") + 10,
    );

    input.output.writeStdout(renderInfoPanel({
      title: "记忆",
      subtitle: "跨回合、跨会话、跨项目的持久记忆",
      sections: [
        {
          rows: [
            {
              title: memorySummaryLine,
              detailLines: [
                `预算比例 ${policy.injectBudgetRatio.toFixed(2)} · 单段上限 ${String(policy.maxSectionTokens)}`,
                `个人记忆 ${String(policy.maxGaMemoryRows)} 行 · 团队经验 ${String(policy.maxTeamExperienceRows)} 行 · 团队最低分 ${policy.minTeamExperienceScore.toFixed(2)}`,
              ],
            },
            {
              title: `衰减 · ${policy.decayEnabled ? "开启" : "关闭"}`,
              detailLines: [
                `最大行 ${String(policy.decayMaxRowsPerSession)} · 最小保留 ${String(policy.decayMinRowsToKeep)}`,
              ],
            },
            {
              title: "当前会话记忆",
              detailLines: [
                `记忆 ${String(gaState?.memory.length ?? 0)} 条 · 技能卡 ${String(gaState?.skillCards.length ?? 0)} 张 · 反思 ${String(gaState?.reflectionQueue.length ?? 0)} 条 · 待处理询问 ${String(gaState?.pendingAskQueue?.length ?? 0)} 项`,
              ],
            },
            {
              title: "关系",
              detailLines: [
                "记忆是持久素材，只有被选中的片段会进入当前上下文窗口",
              ],
            },
          ],
        },
      ],
      terminalColumns: memoryWidth,
    }));
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
    const mcpSummaryLine = `服务 · ${serverNames}`;
    const mcpWidth = Math.max(
      96,
      measureDisplayWidth(mcpSummaryLine) + 10,
      measureDisplayWidth(`指令包 · ${hasInstructionPack ? "已加载" : "无"}`) + 10,
      measureDisplayWidth(`指令检查 ${input.mcpInstructionStrictFailure ?? "通过"}`) + 10,
      measureDisplayWidth("代理按需选择 MCP 服务与工具") + 10,
      measureDisplayWidth("/health 查看模型通道；启动时会提示 MCP 指令注入") + 10,
    );

    input.output.writeStdout(renderInfoPanel({
      title: "MCP",
      subtitle: "服务清单与指令注入状态",
      sections: [
        {
          rows: [
            {
              title: mcpSummaryLine,
            },
            {
              title: `指令包 · ${hasInstructionPack ? "已加载" : "无"}`,
              detailLines: [
                `指令检查 ${input.mcpInstructionStrictFailure ?? "通过"}`,
                "代理按需选择 MCP 服务与工具",
              ],
            },
          ],
        },
      ],
      footerLines: [
        "/health 查看模型通道；启动时会提示 MCP 指令注入",
      ],
      terminalColumns: mcpWidth,
    }));
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
