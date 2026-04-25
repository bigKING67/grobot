import {
  MigrationOptions,
  RuntimeAttachment,
  RuntimeClient,
  RuntimeExecuteOptions,
  RuntimeModelConfig,
  RuntimeRequest,
  RuntimeToolContext,
  RuntimeTurnResult,
  ShadowComparison,
  TurnExecutionReport,
  TurnRequest,
  TurnVerifier,
} from "../../models/types";
import { evaluateTurnGovernance } from "../../governance/evaluator";

export interface TurnContextAssembler {
  assemble(turn: TurnRequest): Promise<string[]>;
}

export interface TurnPersister {
  persist(report: TurnExecutionReport): Promise<void>;
}

export interface AgentLoopDependencies {
  contextAssembler: TurnContextAssembler;
  runtimeClient: RuntimeClient;
  verifier: TurnVerifier;
  persister: TurnPersister;
  shadowRuntimeClient?: RuntimeClient;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildRuntimeRequest(
  turn: TurnRequest,
  contextLines: string[],
  migration: MigrationOptions,
  runtimeModelConfig?: RuntimeModelConfig,
  runtimeToolContext?: RuntimeToolContext,
  runtimeAttachments?: RuntimeAttachment[],
  runtimeSystemPrompt?: string,
): RuntimeRequest {
  return {
    protocolVersion: "runtime.v1",
    requestId: turn.requestId,
    sessionKey: turn.sessionKey,
    systemPrompt: runtimeSystemPrompt,
    userMessage: turn.userMessage,
    contextLines,
    modelConfig: runtimeModelConfig,
    toolContext: runtimeToolContext,
    attachments: runtimeAttachments,
    metadata: {
      ...turn.metadata,
      gatewayImpl: migration.gatewayImpl,
      runtimeImpl: migration.runtimeImpl,
      shadowMode: migration.shadowMode,
    },
  };
}

function compareRuntimeResults(
  primary: RuntimeTurnResult,
  shadow: RuntimeTurnResult,
): ShadowComparison {
  return {
    assistantMessageMatch:
      primary.assistantMessage.trim() === shadow.assistantMessage.trim(),
    eventCountDelta: Math.abs(primary.events.length - shadow.events.length),
    runtimeLabel: shadow.runtimeLabel,
  };
}

export class AgentLoop {
  private readonly deps: AgentLoopDependencies;

  public constructor(deps: AgentLoopDependencies) {
    this.deps = deps;
  }

  public async runTurn(
    turn: TurnRequest,
    migration: MigrationOptions,
    runtimeModelConfig?: RuntimeModelConfig,
    runtimeToolContext?: RuntimeToolContext,
    runtimeAttachments?: RuntimeAttachment[],
    runtimeExecuteOptions?: RuntimeExecuteOptions,
    runtimeSystemPrompt?: string,
  ): Promise<TurnExecutionReport> {
    const startedAt = nowIso();
    const contextLines = await this.deps.contextAssembler.assemble(turn);
    const runtimeRequest = buildRuntimeRequest(
      turn,
      contextLines,
      migration,
      runtimeModelConfig,
      runtimeToolContext,
      runtimeAttachments,
      runtimeSystemPrompt,
    );

    const primary = await this.deps.runtimeClient.executeTurn(runtimeRequest, runtimeExecuteOptions);

    let shadowComparison: ShadowComparison | undefined;
    if (migration.shadowMode && this.deps.shadowRuntimeClient) {
      if (runtimeExecuteOptions?.signal?.aborted) {
        throw new Error("runtime turn interrupted class=turn_interrupted detail=aborted_before_shadow_runtime_call");
      }
      const shadow = await this.deps.shadowRuntimeClient.executeTurn(runtimeRequest, runtimeExecuteOptions);
      shadowComparison = compareRuntimeResults(primary, shadow);
    }

    const verification = await this.deps.verifier.verify(primary);
    const governance = evaluateTurnGovernance(verification, shadowComparison);

    const report: TurnExecutionReport = {
      traceId: primary.traceId,
      requestId: turn.requestId,
      sessionKey: turn.sessionKey,
      startedAtIso: startedAt,
      finishedAtIso: nowIso(),
      primaryRuntime: primary.runtimeLabel,
      assistantMessage: primary.assistantMessage,
      runtimeInterrupt: primary.interrupt,
      verification,
      governance,
      shadowComparison,
      eventCount: primary.events.length,
    };

    await this.deps.persister.persist(report);
    return report;
  }
}
