import type { SessionStoreRuntime } from "../../services/session-store";
import type { GaMechanismRuntime } from "../../services/ga-mechanism-runtime";
import type { StatusLineConfigInput } from "../../tui/screens/status-line-screen";
import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import type { RuntimeAttachment } from "../../../models/types";
import type { ContextEngineConfig } from "../../../tools/context";
import type { MemoryOrchestrator } from "../../../tools/memory";
import type {
  InteractiveDiagnosticsMode,
  RunStartInteractiveModeInput,
} from "../interactive-mode";
import type {
  RunStartModelOps,
} from "../model-ops";
import type { RunStartOutput } from "../output";
import type { RunStartPlanMode } from "../plan-mode";
import type { RunStartRuntimeState } from "../runtime-state";
import type { RunStartSessionMenuOps } from "../session-menu-ops";
import type {
  RuntimeFailoverConfig,
  RuntimeProviderCandidate,
} from "../turn";
import type { RunStartWire } from "../wire";

export interface CreateRunStartInteractiveModeInput {
  homeDir: string;
  projectRoot: string;
  projectName: string;
  workDir: string;
  sessionNamespaceKey: string;
  sessionStoreRuntime: SessionStoreRuntime;
  sessionRegistryFilePathValue: string;
  handoffAutoOnExit: boolean;
  handoffRecentTurns: number;
  handoffPath: string;
  contextWindowTokens?: number;
  contextEngineConfig: ContextEngineConfig;
  memoryOrchestrator: MemoryOrchestrator;
  mcpInstructionPromptPrefix?: string;
  mcpInstructionServerNames: string[];
  mcpInstructionStrictFailure?: string;
  interactiveDiagnosticsEnabled?: boolean;
  interactiveDiagnosticsMode?: InteractiveDiagnosticsMode;
  buildHelpText(): string;
  statusLineConfig?: StatusLineConfigInput;
  runtimeProviderChain: ReadonlyArray<RuntimeProviderCandidate>;
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeState: RunStartRuntimeState;
  gaMechanismRuntime: GaMechanismRuntime;
  output: Pick<RunStartOutput, "writeStdout">;
  runSelectMenu?: typeof runTerminalSelectMenu;
  modelOps: RunStartModelOps;
  sessionMenuOps: RunStartSessionMenuOps;
  wire: RunStartWire;
  planMode: RunStartPlanMode;
  requestRuntimeInterrupt(source: "command" | "cli_esc"): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      attachments?: RuntimeAttachment[];
      promptPrelude?: string;
      autoOpenAskUserPanel?: boolean;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
}

export type InteractiveModeBindingPatch = Pick<
  RunStartInteractiveModeInput,
  | "showHealthStatus"
  | "showContextStatus"
  | "showMemoryStatus"
  | "showSkillsStatus"
  | "showMcpStatus"
  | "getPendingAskPromptSummary"
  | "selectPendingAskAnswer"
  | "showPendingAskQueue"
  | "showHistory"
  | "openHistorySearch"
  | "promptSkillCreatorRequirement"
  | "runSkillCreator"
  | "runInitProjectInstructions"
>;
