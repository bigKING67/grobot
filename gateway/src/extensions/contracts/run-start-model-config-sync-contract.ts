import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { persistRunStartModelToConfig } from "../../orchestration/entrypoints/dev-cli/start/run-start-model-config-sync";

async function main(): Promise<void> {
  const tempRoot = `${process.cwd()}/.tmp-run-start-model-config-sync-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const homeDir = `${tempRoot}/home`;
  const workDirMain = `${tempRoot}/workspace-main`;
  const workDirFallback = `${tempRoot}/workspace-fallback`;

  mkdirSync(homeDir, { recursive: true });
  mkdirSync(workDirMain, { recursive: true });
  mkdirSync(workDirFallback, { recursive: true });

  try {
    const updateConfigPath = `${tempRoot}/config-update.toml`;
    writeFileSync(
      updateConfigPath,
      [
        "[[projects]]",
        'name = "grobot"',
        `work_dir = "${workDirMain}"`,
        "",
        "[projects.agent]",
        'provider = "provider-main"',
        "",
        "[[projects.agent.providers]]",
        'name = "provider-main"',
        'model = "model-old" # keep-me',
        "",
        "[[projects.agent.providers]]",
        'name = "provider-secondary"',
        'model = "secondary-old"',
        "",
      ].join("\n"),
      "utf8",
    );
    const updateResult = await persistRunStartModelToConfig({
      configTomlPath: updateConfigPath,
      projectName: "grobot",
      workDir: workDirMain,
      homeDir,
      providerName: "provider-main",
      modelId: "model-new",
    });
    const updateRaw = readFileSync(updateConfigPath, "utf8");

    const insertConfigPath = `${tempRoot}/config-insert.toml`;
    writeFileSync(
      insertConfigPath,
      [
        "[[projects]]",
        'name = "grobot"',
        `work_dir = "${workDirMain}"`,
        "",
        "[projects.agent]",
        'provider = "provider-main"',
        "",
        "[[projects.agent.providers]]",
        'name = "provider-main"',
        'base_url = "https://provider.example.com/v1"',
        "",
      ].join("\n"),
      "utf8",
    );
    const insertResult = await persistRunStartModelToConfig({
      configTomlPath: insertConfigPath,
      projectName: "grobot",
      workDir: workDirMain,
      homeDir,
      providerName: "provider-main",
      modelId: "fresh-model",
    });
    const insertRaw = readFileSync(insertConfigPath, "utf8");

    const fallbackConfigPath = `${tempRoot}/config-workdir-fallback.toml`;
    writeFileSync(
      fallbackConfigPath,
      [
        "[[projects]]",
        'name = "other-project"',
        `work_dir = "${workDirFallback}"`,
        "",
        "[projects.agent]",
        'provider = "provider-picked"',
        "",
        "[[projects.agent.providers]]",
        'name = "provider-picked"',
        'model = "picked-old"',
        "",
        "[[projects.agent.providers]]",
        'name = "provider-other"',
        'model = "other-old"',
        "",
      ].join("\n"),
      "utf8",
    );
    const fallbackResult = await persistRunStartModelToConfig({
      configTomlPath: fallbackConfigPath,
      projectName: "missing-project-name",
      workDir: workDirFallback,
      homeDir,
      providerName: "provider-not-exists",
      modelId: "picked-new",
    });
    const fallbackRaw = readFileSync(fallbackConfigPath, "utf8");

    const missingPathResult = await persistRunStartModelToConfig({
      projectName: "grobot",
      workDir: workDirMain,
      homeDir,
      providerName: "provider-main",
      modelId: "model-new",
    });
    const emptyModelResult = await persistRunStartModelToConfig({
      configTomlPath: updateConfigPath,
      projectName: "grobot",
      workDir: workDirMain,
      homeDir,
      providerName: "provider-main",
      modelId: "   ",
    });
    const missingFileResult = await persistRunStartModelToConfig({
      configTomlPath: `${tempRoot}/missing-config.toml`,
      projectName: "grobot",
      workDir: workDirMain,
      homeDir,
      providerName: "provider-main",
      modelId: "model-new",
    });

    const payload = {
      update_existing_ok: updateResult.ok,
      update_existing_previous_model:
        updateResult.ok && updateResult.previousModel === "model-old",
      update_existing_comment_preserved:
        updateRaw.includes('model = "model-new" # keep-me'),
      update_existing_secondary_untouched:
        updateRaw.includes('model = "secondary-old"'),
      insert_missing_ok: insertResult.ok,
      insert_missing_previous_model_empty:
        insertResult.ok && typeof insertResult.previousModel === "undefined",
      insert_missing_added_model:
        insertRaw.includes('model = "fresh-model"'),
      fallback_by_workdir_ok: fallbackResult.ok,
      fallback_selected_provider_updated:
        fallbackResult.ok
        && fallbackResult.providerName === "provider-picked"
        && /name\s*=\s*"provider-picked"[\s\S]*?model\s*=\s*"picked-new"/.test(fallbackRaw),
      fallback_non_selected_provider_untouched:
        fallbackRaw.includes('model = "other-old"'),
      missing_config_path_failed:
        !missingPathResult.ok
        && missingPathResult.message.includes("config_toml path is unavailable"),
      empty_model_failed:
        !emptyModelResult.ok
        && emptyModelResult.message.includes("target model is empty"),
      missing_file_failed:
        !missingFileResult.ok
        && missingFileResult.message.includes("unable to read config_toml"),
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

void main();
