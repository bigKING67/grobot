import { SessionStoreRuntime } from "../services/session-store";
import { createCliUiRenderer } from "../ui/kernel/renderer";
import { type StartScreenViewModel } from "../ui/screens/startup-screen";
import { sanitizeTerminalDisplayText } from "../ui/interactive/terminal-text-sanitizer";
import {
  inferModelApiContextWindowTokens,
  resolveModelDisplayName,
} from "./run-start-model-context";

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
  "  G R O L A N D®  ",
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
  const normalized = sanitizeTerminalDisplayText(value).trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatContextWindowLabel(tokens: number | undefined): string | undefined {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return undefined;
  }
  const inK = Math.max(1, Math.round(tokens / 1000));
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

function resolveDisplayProjectPath(input: {
  homeDir: string;
  projectRoot: string;
}): string {
  const homeDir = input.homeDir.trim().replace(/[\\/]+$/, "");
  const projectRoot = input.projectRoot.trim();
  const basePath = projectRoot.length > 0 ? projectRoot : homeDir;
  if (!basePath) {
    return "~";
  }
  if (!homeDir) {
    return basePath;
  }
  if (basePath === homeDir) {
    return "~";
  }
  if (basePath.startsWith(`${homeDir}/`)) {
    return `~/${basePath.slice(homeDir.length + 1)}`;
  }
  return basePath;
}

export function printRunStartBanner(input: RunStartBannerInput): void {
  const versionLabel = resolveCliVersionLabel();
  const contextWindowLabel = formatContextWindowLabel(
    inferModelApiContextWindowTokens({
      modelName: input.modelName,
      fallback: input.contextWindowTokens,
    }),
  );
  const modelLabel = resolveModelDisplayName(input.modelName);
  const runtimeLine = contextWindowLabel
    ? `${modelLabel} (${contextWindowLabel}) · API Usage Billing`
    : `${modelLabel} · API Usage Billing`;
  const displayProjectPath = resolveDisplayProjectPath({
    homeDir: input.homeDir,
    projectRoot: input.projectRoot,
  });
  const rows: string[] = [
    compactFeedText(runtimeLine, 180),
    compactFeedText(displayProjectPath, 180),
  ];
  const recentActivityLines = resolveRecentActivityLines(input.recentSessions);
  const viewModel: StartScreenViewModel = {
    title: compactFeedText(`Grobot ${versionLabel}`, 64),
    hero: {
      brandLabel: "",
      iconLines: STARTUP_ICON_LINES,
      infoLines: [],
    },
    feeds: [
      {
        title: "Tips for getting started",
        lines: [
          "Run /init to create an AGENTS.md file with instructions",
        ],
      },
      {
        title: "Recent activity",
        lines: recentActivityLines,
        emptyMessage: "No recent activity",
        footer: "/sessions for more",
      },
    ],
    rows,
    commandHint:
      "Enter message (`/help`, `/sessions`, `/resume`, `/rewind`, `/commands`, `/skill-creator`, `/history`, `/model`, `/plan`, `/exit`; Ctrl+r: history search):",
  };
  const uiRenderer = createCliUiRenderer({
    stdinIsTTY: process.stdin.isTTY,
  });
  process.stdout.write(
    uiRenderer.renderStartupScreen(viewModel),
  );
}
