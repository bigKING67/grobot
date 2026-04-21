import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRunStartUserCommandsRuntime } from "../../orchestration/entrypoints/dev-cli/start/run-start-user-commands";

async function main(): Promise<void> {
  const tempRoot = `${process.cwd()}/.tmp-user-commands-contract-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const homeDir = `${tempRoot}/.grobot`;
  mkdirSync(homeDir, { recursive: true });
  const stdoutRows: string[] = [];
  const executedPrompts: string[] = [];
  let failureMarked = false;

  const runtime = createRunStartUserCommandsRuntime({
    homeDir,
    writeStdout: (message) => {
      stdoutRows.push(message);
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
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  rmSync(tempRoot, { recursive: true, force: true });
}

void main();
