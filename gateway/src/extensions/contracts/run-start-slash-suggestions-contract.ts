import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { listRunStartSlashSuggestions } from "../../orchestration/entrypoints/dev-cli/start/run-start-slash-suggestions";

interface UserCommandFixture {
  name: string;
  description: string;
  enabled: boolean;
}

function writeUserCommand(homeDir: string, fixture: UserCommandFixture): void {
  const commandsDir = `${homeDir}/commands`;
  mkdirSync(commandsDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    `${commandsDir}/${fixture.name}.json`,
    `${JSON.stringify({
      schema_version: 1,
      name: fixture.name,
      description: fixture.description,
      prompt: `执行命令：${fixture.name} {{args}}`,
      enabled: fixture.enabled,
      created_at: now,
      updated_at: now,
    }, undefined, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  const tempRoot = `${process.cwd()}/.tmp-run-start-slash-suggestions-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const homeDir = `${tempRoot}/.grobot`;
  mkdirSync(homeDir, { recursive: true });
  writeUserCommand(homeDir, {
    name: "shipit",
    description: "Publish current branch",
    enabled: true,
  });
  writeUserCommand(homeDir, {
    name: "pause_release",
    description: "Pause deployment pipeline",
    enabled: false,
  });

  const topLevel = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/",
    maxItems: 80,
  });
  const modelOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/model ",
    maxItems: 80,
  });
  const shipOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/ship",
    maxItems: 80,
  });
  const plainInput = listRunStartSlashSuggestions({
    homeDir,
    userInput: "hello world",
    maxItems: 80,
  });

  const payload = {
    root_has_builtin_model: topLevel.some((item) => item.command === "/model" && item.source === "builtin"),
    root_has_builtin_commands: topLevel.some((item) => item.command === "/commands" && item.source === "builtin"),
    root_has_user_shipit: topLevel.some((item) => item.command === "/shipit" && item.source === "user"),
    root_disabled_marked: topLevel.some(
      (item) => item.command === "/pause_release" && item.description.includes("disabled"),
    ),
    model_filter_only_model_related: modelOnly.every((item) => item.command.startsWith("/model")),
    ship_filter_only_shipit: shipOnly.length === 1 && shipOnly[0]?.command === "/shipit",
    plain_input_empty: plainInput.length === 0,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  rmSync(tempRoot, { recursive: true, force: true });
}

void main();
