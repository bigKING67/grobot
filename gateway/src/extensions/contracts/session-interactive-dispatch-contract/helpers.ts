import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
  type SessionInteractiveRewindCheckpointSummary,
  type SessionInteractiveSessionSummary,
} from "../../../cli/start/session-interactive";

interface DispatchCaseResult {
  action: SessionInteractiveAction;
  events: string[];
  stdout: string;
}

const controls: SessionInteractiveControls = {
  withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
};

export function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const DEFAULT_SESSION_SUMMARIES: readonly SessionInteractiveSessionSummary[] = [
  {
    id: "main",
    title: "Main Session",
    summary: "active",
    updatedAt: "2026-04-20T00:00:00.000Z",
    active: true,
  },
  {
    id: "session-legacy",
    title: "Legacy Session",
    summary: "historical",
    updatedAt: "2026-04-19T23:59:00.000Z",
    active: false,
  },
  {
    id: "session-archive",
    title: "Archive Session",
    summary: "old",
    updatedAt: "2026-04-18T23:59:00.000Z",
    active: false,
  },
];

const DEFAULT_REWIND_CHECKPOINTS: readonly SessionInteractiveRewindCheckpointSummary[] = [
  {
    checkpointId: "latest",
    createdAt: "2026-04-20T08:00:00.000Z",
    userText: "latest checkpoint",
    assistantText: "latest assistant",
    historyBeforeCount: 24,
    historyAfterCount: 26,
    changedFilesCount: 2,
  },
  {
    checkpointId: "legacy-a",
    createdAt: "2026-04-19T08:00:00.000Z",
    userText: "legacy checkpoint alpha",
    assistantText: "legacy assistant alpha",
    historyBeforeCount: 12,
    historyAfterCount: 14,
    changedFilesCount: 1,
  },
  {
    checkpointId: "legacy-b",
    createdAt: "2026-04-18T08:00:00.000Z",
    userText: "legacy checkpoint beta",
    assistantText: "legacy assistant beta",
    historyBeforeCount: 10,
    historyAfterCount: 11,
    changedFilesCount: 3,
  },
];

async function withStdinTty<T>(stdinIsTty: boolean, operation: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  try {
    Object.defineProperty(process.stdin, "isTTY", {
      value: stdinIsTty,
      configurable: true,
    });
    return await operation();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, "isTTY", descriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
}

export async function runDispatchCase(
  input: string,
  options?: {
    stdinIsTty?: boolean;
    pendingAskCount?: number;
    planMode?: boolean;
    nowMs?: number;
    activeSessionId?: string;
    disableRewindSession?: boolean;
    sessionSummaries?: readonly SessionInteractiveSessionSummary[];
    rewindCheckpoints?: readonly SessionInteractiveRewindCheckpointSummary[];
  },
): Promise<DispatchCaseResult> {
  const events: string[] = [];
  const stdoutChunks: string[] = [];
  const pendingAskCount = Math.max(0, options?.pendingAskCount ?? 0);
  const activeSessionId = options?.activeSessionId ?? "main";
  const enableRewindSession = options?.disableRewindSession !== true;
  const sessionSummaries = options?.sessionSummaries ?? DEFAULT_SESSION_SUMMARIES;
  const rewindCheckpoints = options?.rewindCheckpoints ?? DEFAULT_REWIND_CHECKPOINTS;
  const invokeWithNow = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (typeof options?.nowMs !== "number") {
      return operation();
    }
    const originalNow = Date.now;
    Date.now = () => options.nowMs as number;
    try {
      return await operation();
    } finally {
      Date.now = originalNow;
    }
  };
  const handlers: SessionInteractiveHandlers = {
    writeStdout: (message) => {
      events.push("writeStdout");
      stdoutChunks.push(message);
    },
    hasPendingAsk: () => pendingAskCount > 0,
    getPendingAskQueueSize: () => pendingAskCount,
    getPendingAskPromptSummary: () =>
      pendingAskCount > 0
        ? "Enter 打开选择 · 1-2 直接回复"
        : undefined,
    showPendingAskQueue: (limit) => {
      events.push(`showPendingAskQueue:${typeof limit === "number" ? String(limit) : "default"}`);
    },
    selectPendingAskAnswer: async () => {
      events.push("selectPendingAskAnswer");
      return "core";
    },
    showHelp: () => {
      events.push("showHelp");
    },
    showHealthStatus: () => {
      events.push("showHealthStatus");
    },
    showContextStatus: () => {
      events.push("showContextStatus");
      events.push("writeStdout");
    },
    showMemoryStatus: () => {
      events.push("showMemoryStatus");
      events.push("writeStdout");
    },
    showSkillsStatus: () => {
      events.push("showSkillsStatus");
      events.push("writeStdout");
    },
    showMcpStatus: () => {
      events.push("showMcpStatus");
      events.push("writeStdout");
    },
    openModelMenu: async () => {
      events.push("openModelMenu");
    },
    showStatusCurrent: () => {
      events.push("showStatusCurrent");
    },
    setStatusTheme: (theme) => {
      events.push(`setStatusTheme:${theme}`);
    },
    setStatusLayoutMode: (layoutMode) => {
      events.push(`setStatusLayoutMode:${layoutMode}`);
    },
    setStatusSegmentEnabled: (segmentId, enabled) => {
      events.push(`setStatusSegmentEnabled:${segmentId}:${enabled ? "on" : "off"}`);
    },
    openStatusMenu: async () => {
      events.push("openStatusMenu");
    },
    openSessionMenu: async (mode) => {
      events.push(`openSessionMenu:${mode}`);
    },
    listSessionSummaries: () => [...sessionSummaries],
    getActiveSessionId: () => activeSessionId,
    listRewindCheckpoints: (sessionId) => {
      events.push(`listRewindCheckpoints:${sessionId}`);
      if (!activeSessionId || sessionId !== activeSessionId) {
        return [];
      }
      return [...rewindCheckpoints];
    },
    ...(enableRewindSession
      ? {
        rewindSession: async (inputValue: {
          sessionId: string;
          checkpointId?: string;
          mode: string;
          reason?: string;
        }) => {
          events.push("rewindSession");
          events.push(
            `rewindSession:${inputValue.sessionId}:${inputValue.checkpointId ?? "<latest>"}:${inputValue.mode}:${inputValue.reason ?? ""}`,
          );
          return true;
        },
      }
      : {}),
    createAndSwitchSession: async () => {
      events.push("createAndSwitchSession");
    },
    switchSession: async (targetSessionId) => {
      events.push("switchSession");
      events.push(`switchSession:${targetSessionId}`);
    },
    continueFromSession: async () => {
      events.push("continueFromSession");
    },
    writeHandoff: () => {
      events.push("writeHandoff");
    },
    isPlanMode: () => options?.planMode === true,
    showPlanStatus: async () => {
      events.push("showPlanStatus");
    },
    enterPlan: async (goal, withInputPaused) => {
      events.push(`enterPlan:${goal}`);
      if (typeof withInputPaused === "function") {
        events.push("enterPlan:hasInputPause");
      }
    },
    applyPlan: async () => {
      events.push("applyPlan");
    },
    cancelPlan: async () => {
      events.push("cancelPlan");
    },
    requestPlanInterrupt: async () => {
      events.push("requestPlanInterrupt");
    },
    requestRuntimeInterrupt: async () => {
      events.push("requestRuntimeInterrupt");
    },
    runPlanTurn: async (_userInput, withInputPaused) => {
      events.push("runPlanTurn");
      if (typeof withInputPaused === "function") {
        events.push("runPlanTurn:hasInputPause");
      }
    },
    handleUserCommandsCommand: async () => {
      events.push("handleUserCommandsCommand");
    },
    openCommandsMenu: async () => {
      events.push("openCommandsMenu");
    },
    openPlanInEditor: async () => {
      events.push("openPlanInEditor");
    },
    showHistory: async (query) => {
      events.push(`showHistory:${query ?? ""}`);
    },
    promptSkillCreatorRequirement: async () => {
      events.push("promptSkillCreatorRequirement");
      return "补齐技能需求";
    },
    runSkillCreator: async (requirement) => {
      events.push(`runSkillCreator:${requirement}`);
    },
    runInitProjectInstructions: async () => {
      events.push("runInitProjectInstructions");
    },
    tryRunUserCommand: async (userInput) => {
      events.push(`tryRunUserCommand:${userInput}`);
      return userInput === "/shipit";
    },
    runTurn: async (userInput) => {
      events.push(`runTurn:${userInput}`);
    },
    onTurnError: () => {
      events.push("onTurnError");
    },
  };
  const action = await invokeWithNow(async () =>
    typeof options?.stdinIsTty === "boolean"
      ? await withStdinTty(options.stdinIsTty, async () =>
        dispatchSessionInteractiveInput(input, controls, handlers))
      : await dispatchSessionInteractiveInput(input, controls, handlers));
  return { action, events, stdout: stdoutChunks.join("") };
}

export function includesEvent(events: readonly string[], target: string): boolean {
  return events.includes(target);
}
