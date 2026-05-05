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
        title: "Conversation history",
        subtitle: "Recent conversation records",
        sections: [
          {
            rows: [
              {
                title: "No conversation history",
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
    const historySummaryLine = `total ${String(allRows.length)} · matches ${String(filteredRows.length)} · query ${query.length > 0 ? query : "none"} · recent ${String(renderRows.length)}`;
    const historyWidth = Math.max(
      96,
      measureDisplayWidth(historySummaryLine) + 10,
      ...renderRows.map((row) =>
        measureDisplayWidth(`${row.role === "assistant" ? "assistant" : "user"} ${compactSingleLine(row.content, 220)}`) + 10,
      ),
    );

    if (renderRows.length === 0) {
      input.output.writeStdout(renderInfoPanel({
        title: "Conversation history",
        subtitle: "Recent conversation records",
        sections: [
          {
            rows: [
              {
                title: `total ${String(allRows.length)} · matches ${String(filteredRows.length)} · query ${query.length > 0 ? query : "none"}`,
                detailLines: ["No matching records."],
              },
            ],
          },
        ],
        terminalColumns: historyWidth,
      }));
      return;
    }

    input.output.writeStdout(renderInfoPanel({
      title: "Conversation history",
      subtitle: "Recent conversation records",
      sections: [
        {
          rows: [
            {
              title: historySummaryLine,
              detailLines: renderRows.map((row) => {
                const role = row.role === "assistant" ? "assistant" : "user";
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
        : "auto";
    const contextSummaryLine = `Context engine · ${input.contextEngineConfig.enabled ? "on" : "off"} · profile ${input.contextEngineConfig.profile}`;
    const contextWidth = Math.max(
      96,
      measureDisplayWidth("System prompt · built-in SYSTEM.md") + 10,
      measureDisplayWidth(contextSummaryLine) + 10,
      measureDisplayWidth(`window ${typeof effectiveWindow === "number" ? String(effectiveWindow) : "unknown"} · auto compact ${autoCompactLabel}`) + 10,
      measureDisplayWidth(`history ${String(input.runtimeState.getHistoryMessages().length)} messages`) + 10,
      measureDisplayWidth(`project instructions ${agentsInstructions.sources.length > 0 ? agentsInstructions.sources.join(",") : "none"}`) + 10,
      measureDisplayWidth("Memory is retrieval material, not the current context window") + 10,
    );

    input.output.writeStdout(renderInfoPanel({
      title: "Context",
      subtitle: "Context window assembled before each turn",
      sections: [
        {
          rows: [
            {
              title: "System prompt · built-in SYSTEM.md",
            },
            {
              title: contextSummaryLine,
              detailLines: [
                `window ${typeof effectiveWindow === "number" ? String(effectiveWindow) : "unknown"} · auto compact ${autoCompactLabel}`,
                `history ${String(input.runtimeState.getHistoryMessages().length)} messages`,
              ],
            },
            {
              title: "Project instructions",
              detailLines: [
                agentsInstructions.sources.length > 0
                  ? agentsInstructions.sources.join(",")
                  : "none",
              ],
            },
            {
              title: "Relationship",
              detailLines: [
                "Memory is retrieval material, not the current context window",
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
    const memorySummaryLine = `Memory orchestration · ${policy.enabled ? "on" : "off"} · version ${policy.version}`;
    const memoryWidth = Math.max(
      96,
      measureDisplayWidth(memorySummaryLine) + 10,
      measureDisplayWidth(`budget ratio ${policy.injectBudgetRatio.toFixed(2)} · max section ${String(policy.maxSectionTokens)}`) + 10,
      measureDisplayWidth(`personal memory ${String(policy.maxGaMemoryRows)} rows · team experience ${String(policy.maxTeamExperienceRows)} rows · min team score ${policy.minTeamExperienceScore.toFixed(2)}`) + 10,
      measureDisplayWidth(`max rows ${String(policy.decayMaxRowsPerSession)} · min keep ${String(policy.decayMinRowsToKeep)}`) + 10,
      measureDisplayWidth(`memory ${String(gaState?.memory.length ?? 0)} · skill cards ${String(gaState?.skillCards.length ?? 0)} · reflections ${String(gaState?.reflectionQueue.length ?? 0)} · pending asks ${String(gaState?.pendingAskQueue?.length ?? 0)}`) + 10,
      measureDisplayWidth("Memory is persistent material; only selected snippets enter the current context window") + 10,
    );

    input.output.writeStdout(renderInfoPanel({
      title: "Memory",
      subtitle: "Persistent memory across turns, sessions, projects",
      sections: [
        {
          rows: [
            {
              title: memorySummaryLine,
              detailLines: [
                `budget ratio ${policy.injectBudgetRatio.toFixed(2)} · max section ${String(policy.maxSectionTokens)}`,
                `personal memory ${String(policy.maxGaMemoryRows)} rows · team experience ${String(policy.maxTeamExperienceRows)} rows · min team score ${policy.minTeamExperienceScore.toFixed(2)}`,
              ],
            },
            {
              title: `Decay · ${policy.decayEnabled ? "on" : "off"}`,
              detailLines: [
                `max rows ${String(policy.decayMaxRowsPerSession)} · min keep ${String(policy.decayMinRowsToKeep)}`,
              ],
            },
            {
              title: "Current session memory",
              detailLines: [
                `memory ${String(gaState?.memory.length ?? 0)} · skill cards ${String(gaState?.skillCards.length ?? 0)} · reflections ${String(gaState?.reflectionQueue.length ?? 0)} · pending asks ${String(gaState?.pendingAskQueue?.length ?? 0)}`,
              ],
            },
            {
              title: "Relationship",
              detailLines: [
                "Memory is persistent material; only selected snippets enter the current context window",
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
        : "none";
    const mcpSummaryLine = `Services · ${serverNames}`;
    const mcpWidth = Math.max(
      96,
      measureDisplayWidth(mcpSummaryLine) + 10,
      measureDisplayWidth(`instruction pack · ${hasInstructionPack ? "loaded" : "none"}`) + 10,
      measureDisplayWidth(`instruction check ${input.mcpInstructionStrictFailure ?? "passed"}`) + 10,
      measureDisplayWidth("Agent selects MCP services and tools as needed") + 10,
      measureDisplayWidth("/health shows model providers; startup reports MCP instruction injection") + 10,
    );

    input.output.writeStdout(renderInfoPanel({
      title: "MCP",
      subtitle: "Service list and instruction injection status",
      sections: [
        {
          rows: [
            {
              title: mcpSummaryLine,
            },
            {
              title: `Instruction pack · ${hasInstructionPack ? "loaded" : "none"}`,
              detailLines: [
                `instruction check ${input.mcpInstructionStrictFailure ?? "passed"}`,
                "Agent selects MCP services and tools as needed",
              ],
            },
          ],
        },
      ],
      footerLines: [
        "/health shows model providers; startup reports MCP instruction injection",
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
