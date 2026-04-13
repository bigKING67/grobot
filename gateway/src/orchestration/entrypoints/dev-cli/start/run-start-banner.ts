import { SessionStoreRuntime } from "../services/session-store";
import { maskRedisUrl } from "../services/memory-store-config";

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
  process.stdout.write("Grobot started\n");
  process.stdout.write(`  home:      ${input.homeDir}\n`);
  process.stdout.write(`  root:      ${input.projectRoot}\n`);
  process.stdout.write(`  project:   ${input.projectName}\n`);
  process.stdout.write(`  work_dir:  ${input.workDir}\n`);
  process.stdout.write(`  session:   ${input.sessionKey}\n`);
  process.stdout.write(`  namespace: ${input.sessionNamespaceKey}\n`);
  process.stdout.write(`  session_id:${input.activeSessionId}\n`);
  process.stdout.write(
    `  store:     ${input.sessionStoreRuntime.backend} (source=${input.sessionStoreRuntime.source}, registry=${input.sessionRegistryFilePathValue})\n`,
  );
  if (input.sessionStoreRuntime.redisUrl) {
    process.stdout.write(`  store_redis:${maskRedisUrl(input.sessionStoreRuntime.redisUrl)}\n`);
  }
  if (input.sessionStoreRuntime.fallbackReason) {
    process.stdout.write(`  store_fallback:${input.sessionStoreRuntime.fallbackReason}\n`);
  }
  process.stdout.write(
    `  handoff:   auto=${input.handoffAutoOnExit ? "on" : "off"} recent_turns=${String(input.handoffRecentTurns)} path=${input.handoffPath}\n`,
  );
  if (input.restoredTurns > 0) {
    process.stdout.write(`  restored:  ${String(input.restoredTurns)} turns from ${input.restoreSource}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write(
    "Enter message (`/sessions`, `/new`, `/switch <id>`, `/continue <id>`, `/handoff`, `/help`, `/exit`):\n",
  );
}
