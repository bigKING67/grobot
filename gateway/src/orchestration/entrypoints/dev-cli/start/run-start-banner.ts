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
  providerName: string;
  modelName: string;
  sessionTopic?: string;
  contextWindowTargetTokens?: number;
}

const STARTUP_ICON_LINES = [
  "   .----.   ",
  "  / .--. \\  ",
  " | | () | | ",
  " |  '--'  | ",
  "  \\_====_/  ",
];

function resolveCliVersionLabel(): string {
  const candidates = [
    process.env.GROBOT_VERSION,
    process.env.npm_package_version,
  ];
  for (const candidate of candidates) {
    const normalized = (candidate ?? "").trim();
    if (!normalized) {
      continue;
    }
    return normalized.startsWith("v") ? normalized : `v${normalized}`;
  }
  return "dev";
}

function compactSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    return "<none>";
  }
  if (normalized.length <= 8) {
    return normalized;
  }
  return normalized.slice(0, 8);
}

function compactSessionTopic(topic: string | undefined): string {
  const normalized = (topic ?? "").trim();
  if (!normalized) {
    return "无主题";
  }
  if (normalized.length <= 24) {
    return normalized;
  }
  return `${normalized.slice(0, 24)}...`;
}

function summarizeStoreFallback(reason: string | undefined): string | undefined {
  const normalized = (reason ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("ECONNREFUSED")) {
    return "redis unavailable; fallback to file";
  }
  if (normalized.length <= 96) {
    return normalized;
  }
  return `${normalized.slice(0, 96)}...`;
}

export function printRunStartBanner(input: RunStartBannerInput): void {
  const contextWindowLabel = typeof input.contextWindowTargetTokens === "number"
    && Number.isFinite(input.contextWindowTargetTokens)
    ? `${String(Math.round(input.contextWindowTargetTokens / 1_000))}k tok window`
    : undefined;
  const runtimeLine = [
    `${input.providerName}/${input.modelName}`,
    contextWindowLabel,
    "API Usage",
  ].filter((segment) => typeof segment === "string" && segment.trim().length > 0).join(" · ");
  const sessionLine = `session ${compactSessionId(input.activeSessionId)} (${compactSessionTopic(input.sessionTopic)})`;
  const rows: string[] = [];
  const fallbackSummary = summarizeStoreFallback(input.sessionStoreRuntime.fallbackReason);
  if (fallbackSummary) {
    rows.push(`storage: ${fallbackSummary}`);
  } else if (input.sessionStoreRuntime.redisUrl) {
    rows.push(`storage: ${input.sessionStoreRuntime.backend} (${maskRedisUrl(input.sessionStoreRuntime.redisUrl)})`);
  }
  if (input.restoredTurns > 0) {
    rows.push(`restored: ${String(input.restoredTurns)} turns (${input.restoreSource})`);
  }
  const viewModel: StartScreenViewModel = {
    title: "Grobot started",
    hero: {
      brandLabel: "Grobot",
      iconLines: STARTUP_ICON_LINES,
      infoLines: [
        `Grobot CLI ${resolveCliVersionLabel()}`,
        runtimeLine,
        input.projectRoot,
        sessionLine,
      ],
    },
    rows,
    commandHint: "Enter message (`/help`, `/sessions`, `/model`, `/status`, `/exit`):",
  };
  const uiRenderer = createCliUiRenderer({
    stdinIsTTY: process.stdin.isTTY,
  });
  process.stdout.write(
    uiRenderer.renderStartupScreen(viewModel),
  );
}
