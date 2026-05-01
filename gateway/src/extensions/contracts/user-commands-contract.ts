import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRunStartUserCommandsRuntime } from "../../orchestration/entrypoints/dev-cli/start/run-start-user-commands";
import {
  type TerminalLinePromptResult,
  type TerminalSelectMenuInput,
  type TerminalSelectMenuResult,
} from "../../orchestration/entrypoints/dev-cli/start/run-start-io";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

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

async function main(): Promise<void> {
  const tempRoot = `${process.cwd()}/.tmp-user-commands-contract-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const homeDir = `${tempRoot}/.grobot`;
  mkdirSync(homeDir, { recursive: true });
  const stdoutRows: string[] = [];
  const executedPrompts: string[] = [];
  const menuHints: string[] = [];
  let failureMarked = false;

  const runtime = createRunStartUserCommandsRuntime({
    homeDir,
    writeStdout: (message) => {
      stdoutRows.push(message);
    },
    runLinePrompt: async (): Promise<TerminalLinePromptResult> => ({
      kind: "cancelled",
    }),
    runSelectMenu: async (menu: TerminalSelectMenuInput): Promise<TerminalSelectMenuResult> => {
      menuHints.push(menu.hint ?? "");
      return { kind: "cancelled" };
    },
    executeTurn: async (userInput) => {
      executedPrompts.push(userInput);
      return 0;
    },
    markFailureObserved: () => {
      failureMarked = true;
    },
  });

  await runtime.handleManagementCommand("/commands new shipit 执行交付：{{args}}");
  const commandPath = `${homeDir}/commands/shipit.json`;
  const created = existsSync(commandPath);

  const firstInvocationHandled = await runtime.tryRunUserCommand("/shipit 本次发布");
  const firstInvocationPrompt = executedPrompts[0] ?? "";

  await runtime.handleManagementCommand("/commands disable shipit");
  const disabledInvocationHandled = await runtime.tryRunUserCommand("/shipit 禁用后测试");
  const promptsAfterDisable = executedPrompts.length;

  await runtime.handleManagementCommand("/commands enable shipit");
  await runtime.handleManagementCommand("/commands set shipit 第二版：{{args}}");
  const secondInvocationHandled = await runtime.tryRunUserCommand("/shipit 参数B");
  const secondInvocationPrompt = executedPrompts[1] ?? "";
  await runtime.handleManagementCommand("/commands list");

  await runtime.handleManagementCommand("/commands new model 不应创建");
  const builtinCollisionCreated = existsSync(`${homeDir}/commands/model.json`);
  await runtime.handleManagementCommand("/commands new skill-creator 不应创建");
  const skillCreatorCollisionCreated = existsSync(`${homeDir}/commands/skill-creator.json`);

  const builtinLegacyPath = `${homeDir}/commands/model.json`;
  writeFileSync(
    builtinLegacyPath,
    `${JSON.stringify({
      schema_version: 1,
      name: "model",
      description: "legacy invalid file",
      prompt: "legacy prompt",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  await runtime.handleManagementCommand("/commands delete model");
  const builtinDeleteBlocked = existsSync(builtinLegacyPath);
  rmSync(builtinLegacyPath, { force: true });

  await runtime.handleManagementCommand("/commands delete ../shipit");
  const traversalDeleteBlocked = existsSync(commandPath);
  const traversalInvocationHandled = await runtime.tryRunUserCommand("/../shipit should-not-run");

  const commandFileSnapshotBeforeDelete = existsSync(commandPath)
    ? JSON.parse(readFileSync(commandPath, "utf8"))
    : null;

  await runtime.handleManagementCommand("/commands delete shipit");
  const deleted = !existsSync(commandPath);
  const stdoutRowsBeforeMenuCancel = stdoutRows.length;
  await withStdinTty(true, async () =>
    runtime.openManagementMenu(async (operation) => operation())
  );
  const menuCancelOutput = stdoutRows.slice(stdoutRowsBeforeMenuCancel).join("");
  const stdoutText = stdoutRows.join("");
  const stdoutPlain = stripAnsi(stdoutText);

  const payload = {
    created,
    first_invocation_handled: firstInvocationHandled,
    first_invocation_prompt: firstInvocationPrompt,
    disabled_invocation_handled: disabledInvocationHandled,
    prompts_after_disable: promptsAfterDisable,
    second_invocation_handled: secondInvocationHandled,
    second_invocation_prompt: secondInvocationPrompt,
    builtin_collision_created: builtinCollisionCreated,
    skill_creator_collision_created: skillCreatorCollisionCreated,
    builtin_delete_blocked: builtinDeleteBlocked,
    traversal_delete_blocked: traversalDeleteBlocked,
    traversal_invocation_handled: traversalInvocationHandled,
    deleted,
    failure_marked: failureMarked,
    command_file_snapshot_before_delete: commandFileSnapshotBeforeDelete,
    stdout_rows_count: stdoutRows.length,
    command_surface_avoids_legacy_marker: !stdoutText.includes("[commands]"),
    command_created_surface_is_human:
      stdoutPlain.includes("已创建自定义命令")
      && stdoutPlain.includes("命令: /shipit")
      && !stdoutPlain.includes("[commands] 已创建"),
    command_disabled_surface_is_human:
      stdoutPlain.includes("自定义命令已停用")
      && stdoutPlain.includes("/shipit 当前不可调用。"),
    command_list_surface_is_human:
      stdoutPlain.includes("用户自定义命令")
      && stdoutPlain.includes("二级动作")
      && !stdoutPlain.includes("用户自定义命令（主入口）"),
    menu_hint_is_reference_compact:
      menuHints.includes("↑/↓ 选择 · Enter 确认 · Esc 返回"),
    menu_hint_omits_secondary_key_chords:
      menuHints.every((hint) =>
        !hint.includes("Ctrl+n/p")
        && !hint.includes("number to select directly")
        && !hint.includes("Enter/Space")
        && !hint.includes("Esc to cancel")
      ),
    menu_cancel_is_silent:
      menuCancelOutput.length === 0
      && !stdoutRows.join("").includes("[commands] menu cancelled")
      && !stdoutRows.join("").includes("[commands] input cancelled"),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  rmSync(tempRoot, { recursive: true, force: true });
}

void main();
