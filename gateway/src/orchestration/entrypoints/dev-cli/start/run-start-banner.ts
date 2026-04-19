import { SessionStoreRuntime } from "../services/session-store";
import { maskRedisUrl } from "../services/memory-store-config";
import { createCliUiRenderer } from "../ui/kernel/renderer";
import { type StartScreenViewModel } from "../ui/screens/startup-screen";

interface StartBannerRecentSession {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
}

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
  contextWindowTokens?: number;
  recentSessions?: ReadonlyArray<StartBannerRecentSession>;
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

function formatRelativeTimeAgo(value: string): string | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const deltaMs = Math.max(0, Date.now() - parsed);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (deltaMs < minuteMs) {
    return "just now";
  }
  if (deltaMs < hourMs) {
    return `${String(Math.floor(deltaMs / minuteMs))}m ago`;
  }
  if (deltaMs < dayMs) {
    return `${String(Math.floor(deltaMs / hourMs))}h ago`;
  }
  return `${String(Math.floor(deltaMs / dayMs))}d ago`;
}

function compactFeedText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function resolveModelDisplayName(modelName: string): string {
  const normalized = modelName.trim();
  const lower = normalized.toLowerCase();
  if (lower.includes("kimi-k2.5") || lower.includes("kimi 2.5") || lower.includes("k2.5")) {
    return "Kimi 2.5";
  }
  if (normalized.length > 0) {
    return normalized;
  }
  return "Model";
}

function inferApiContextWindowTokens(input: {
  modelName: string;
  fallback?: number;
}): number | undefined {
  const lower = input.modelName.trim().toLowerCase();
  if (lower.includes("kimi-k2.5") || lower.includes("kimi 2.5") || lower.includes("k2.5")) {
    return 262_144;
  }
  if (
    typeof input.fallback === "number"
    && Number.isFinite(input.fallback)
    && input.fallback > 0
  ) {
    return Math.floor(input.fallback);
  }
  return undefined;
}

function formatContextWindowLabel(tokens: number | undefined): string | undefined {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return undefined;
  }
  const inK = Math.max(1, Math.round(tokens / 1024));
  return `${String(inK)}K context`;
}

function resolveRecentActivityLines(
  sessions: ReadonlyArray<StartBannerRecentSession> | undefined,
): string[] {
  if (!sessions || sessions.length === 0) {
    return [];
  }
  const lines: string[] = [];
  for (const session of sessions) {
    const title = compactFeedText(session.title, 44);
    const summary = compactFeedText(session.summary, 52);
    const label = title.length > 0
      ? title
      : summary.length > 0
        ? summary
        : compactFeedText(session.id, 44);
    if (!label) {
      continue;
    }
    const timestamp = formatRelativeTimeAgo(session.updatedAt);
    lines.push(timestamp ? `${timestamp}  ${label}` : label);
    if (summary.length > 0 && summary !== label) {
      lines.push(`    ${summary}`);
    }
  }
  return lines;
}

export function printRunStartBanner(input: RunStartBannerInput): void {
  const contextWindowLabel = formatContextWindowLabel(
    inferApiContextWindowTokens({
      modelName: input.modelName,
      fallback: input.contextWindowTokens,
    }),
  );
  const runtimeHeadline = [
    resolveModelDisplayName(input.modelName),
    contextWindowLabel,
  ].filter((segment) => typeof segment === "string" && segment.trim().length > 0).join(" · ");
  const runtimeDetail = [
    `${input.providerName}/${input.modelName}`,
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
  const recentActivityLines = resolveRecentActivityLines(input.recentSessions);
  const viewModel: StartScreenViewModel = {
    title: "Grobot started",
    hero: {
      brandLabel: "Grobot",
      iconLines: STARTUP_ICON_LINES,
      infoLines: [
        `Grobot CLI ${resolveCliVersionLabel()}`,
        runtimeHeadline,
        runtimeDetail,
        input.projectRoot,
        sessionLine,
      ],
    },
    feeds: [
      {
        title: "Tips for getting started",
        lines: [
          "Run /init to create a CLAUDE.md file with instructions",
        ],
        footer: "Use /help to list all commands",
      },
      {
        title: "Recent activity",
        lines: recentActivityLines,
        emptyMessage: "No recent activity",
        footer: "/sessions for more",
      },
    ],
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
