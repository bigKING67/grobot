import { runTerminalSelectMenu } from "../tui/components/select-menu/controller";
import { type RunStartModelOps } from "./model-ops";
import { type RewindRestoreMode } from "./rewind-store";
import { type RunStartRuntimeState } from "./runtime-state";
import { runSessionMenuPicker } from "./session-menu";
import { type RunStartSessionOps } from "./session-ops";
import { resolveStartupResumeDisambiguation } from "./session-resume-startup-disambiguation";
import { resolveStartupResumeTarget } from "./session-resume-startup";
import { resolveStartupRewindDisambiguation } from "./session-rewind-startup-disambiguation";
import { resolveStartupRewindTarget } from "./session-rewind-startup";
import { formatStartupPickerPreview } from "./startup-preview";

export interface RunStartupSessionActionsInput {
  resumeRequested: boolean;
  resumeLastRequested: boolean;
  resumeAllRequested: boolean;
  resumeSelector?: string;
  rewindRequested: boolean;
  rewindSelector?: string;
  rewindMode: RewindRestoreMode;
  forkSession: boolean;
  resumeSessionAt?: string;
  rewindFiles?: readonly string[];
  sessionNamespaceKey: string;
  runtimeState: RunStartRuntimeState;
  sessionOps: RunStartSessionOps;
  modelOps: RunStartModelOps;
  writeStdout(message: string): void;
}

export async function runStartupSessionActions(
  input: RunStartupSessionActionsInput,
): Promise<void> {
  let resumed = false;
  const resumeTarget = resolveStartupResumeTarget({
    resumeRequested: input.resumeRequested,
    resumeLastRequested: input.resumeLastRequested,
    resumeAllRequested: input.resumeAllRequested,
    resumeQuery: input.resumeSelector,
    sessions: input.sessionOps.listSessions(),
  });
  let targetResumeSessionId = resumeTarget.targetSessionId;
  if (resumeTarget.notice) {
    input.writeStdout(resumeTarget.notice);
  }
  if (resumeTarget.requiresDisambiguation) {
    const disambiguation = await resolveStartupResumeDisambiguation({
      resumeTarget,
      stdinIsTTY: Boolean(process.stdin.isTTY),
      pickSession: async (candidates) =>
        runSessionMenuPicker({
          mode: "resume",
          sessionNamespaceKey: input.sessionNamespaceKey,
          sessions: candidates,
          withInputPaused: async <T>(operation: () => Promise<T>) =>
            operation(),
        }),
    });
    targetResumeSessionId = disambiguation.targetSessionId;
    for (const message of disambiguation.messages) {
      input.writeStdout(message);
    }
  }
  if (targetResumeSessionId) {
    resumed = await input.sessionOps.resumeFromSession(
      targetResumeSessionId,
      "cli:resume",
    );
    if (resumed) {
      input.modelOps.applyModelOverrideForActiveSession();
    }
  }

  const hasLegacyRewindCheckpointId =
    typeof input.resumeSessionAt === "string" &&
    input.resumeSessionAt.trim().length > 0;
  const shouldRunRewind =
    input.rewindRequested ||
    hasLegacyRewindCheckpointId ||
    (Array.isArray(input.rewindFiles) && input.rewindFiles.length > 0);
  if (shouldRunRewind) {
    const rewindQuery =
      (input.rewindSelector?.trim() ?? "") ||
      (input.resumeSessionAt?.trim() ?? "");
    const rewindTarget = resolveStartupRewindTarget({
      rewindRequested: shouldRunRewind,
      rewindQuery,
      rewindQueryStrict:
        rewindQuery.length > 0 &&
        hasLegacyRewindCheckpointId &&
        !input.rewindSelector?.trim(),
      checkpoints: input.sessionOps.listRewindCheckpoints(
        input.runtimeState.getActiveSessionId(),
        64,
      ),
    });
    let targetCheckpointId = rewindTarget.targetCheckpointId;
    if (rewindTarget.notice) {
      input.writeStdout(rewindTarget.notice);
    }
    if (rewindTarget.requiresDisambiguation) {
      const disambiguation = await resolveStartupRewindDisambiguation({
        rewindTarget,
        stdinIsTTY: Boolean(process.stdin.isTTY),
        pickCheckpoint: async (candidates) => {
          const picked = await runTerminalSelectMenu({
            title: "启动回退 Checkpoint",
            subtitle: `会话: ${input.runtimeState.getActiveSessionId()}`,
            hint: "↑/↓ 选择 · Enter 确认 · Esc 跳过",
            items: candidates.map((checkpoint) => ({
              id: checkpoint.checkpointId,
              label: checkpoint.checkpointId,
              description: `${checkpoint.createdAt} | 文件=${String(checkpoint.changedFilesCount)} | 用户=${formatStartupPickerPreview(
                checkpoint.userText,
              )} | 助手=${formatStartupPickerPreview(checkpoint.assistantText)}`,
            })),
          });
          if (picked.kind === "cancelled") {
            return { kind: "cancelled" };
          }
          return {
            kind: "checkpoint",
            checkpointId: picked.item.id,
          };
        },
      });
      targetCheckpointId = disambiguation.targetCheckpointId;
      for (const message of disambiguation.messages) {
        input.writeStdout(message);
      }
    }
    if (targetCheckpointId) {
      await input.sessionOps.rewindSession({
        sessionId: input.runtimeState.getActiveSessionId(),
        checkpointId: targetCheckpointId,
        mode: input.rewindMode,
        fileFilter: input.rewindFiles,
        reason: resumed ? "cli:resume+rewind" : "cli:rewind",
      });
    }
  }

  if (input.forkSession) {
    const forked = await input.sessionOps.forkFromSession(
      input.runtimeState.getActiveSessionId(),
      "cli:fork-session",
    );
    if (forked) {
      input.modelOps.applyModelOverrideForActiveSession();
    }
  }
}
