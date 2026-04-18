import { SessionStoreRuntime } from "../services/session-store";
import { maskRedisUrl } from "../services/memory-store-config";
import { createCliUiRenderer } from "../ui/kernel/renderer";
import { type StartScreenViewModel } from "../ui/screens/startup-screen";

interface RunStartBannerInput {
  homeDir: string;
  projectRoot: string;
  projectName: string;
  workDir: string;
  sessionKey: string;
  sessionNamespaceKey: string;
  activeSessionId: string;
  sessionStoreRuntime: SessionStoreRuntime;
  sessionRegistryFilePathValue: string;
  handoffAutoOnExit: boolean;
  handoffRecentTurns: number;
  handoffPath: string;
  restoredTurns: number;
  restoreSource: "store" | "empty";
}

export function printRunStartBanner(input: RunStartBannerInput): void {
  const rows: string[] = [];
  rows.push(`  home:      ${input.homeDir}`);
  rows.push(`  root:      ${input.projectRoot}`);
  rows.push(`  project:   ${input.projectName}`);
  rows.push(`  work_dir:  ${input.workDir}`);
  rows.push(`  session:   ${input.sessionKey}`);
  rows.push(`  namespace: ${input.sessionNamespaceKey}`);
  rows.push(`  session_id:${input.activeSessionId}`);
  rows.push(
    `  store:     ${input.sessionStoreRuntime.backend} (source=${input.sessionStoreRuntime.source}, registry=${input.sessionRegistryFilePathValue})`,
  );
  if (input.sessionStoreRuntime.redisUrl) {
    rows.push(`  store_redis:${maskRedisUrl(input.sessionStoreRuntime.redisUrl)}`);
  }
  if (input.sessionStoreRuntime.fallbackReason) {
    rows.push(`  store_fallback:${input.sessionStoreRuntime.fallbackReason}`);
  }
  rows.push(
    `  handoff:   auto=${input.handoffAutoOnExit ? "on" : "off"} recent_turns=${String(input.handoffRecentTurns)} path=${input.handoffPath}`,
  );
  if (input.restoredTurns > 0) {
    rows.push(`  restored:  ${String(input.restoredTurns)} turns from ${input.restoreSource}`);
  }
  const viewModel: StartScreenViewModel = {
    title: "Grobot started",
    rows,
    commandHint:
      "Enter message (`/sessions`, `/new`, `/switch [id]`, `/continue [id]`, `/health`, `/model`, `/model current`, `/model list`, `/model use <id>`, `/plan <goal>`, `/plan status`, `/plan apply`, `/plan cancel`, `/interrupt`, `/handoff`, `/help`, `/exit`; CLI Esc also requests turn interrupt; no id => open picker):",
  };
  const uiRenderer = createCliUiRenderer({
    stdinIsTTY: process.stdin.isTTY,
  });
  process.stdout.write(
    uiRenderer.renderStartupScreen(viewModel),
  );
}
