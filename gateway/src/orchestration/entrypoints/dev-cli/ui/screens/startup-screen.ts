import { resolveCliRenderMode, type CliEnv } from "../kernel/render-mode";
import { createCliTheme } from "../theme/ansi-theme";

export interface StartScreenHeroViewModel {
  brandLabel: string;
  iconLines: string[];
  infoLines: string[];
}

export interface StartScreenViewModel {
  title: string;
  hero?: StartScreenHeroViewModel;
  rows: string[];
  commandHint: string;
}

export interface RenderStartScreenOptions {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}

function renderHeroBlock(hero: StartScreenHeroViewModel): string[] {
  const iconWidth = hero.iconLines.reduce((width, line) => Math.max(width, line.length), 0);
  const rowCount = Math.max(hero.iconLines.length, hero.infoLines.length);
  const lines: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const icon = (hero.iconLines[index] ?? "").padEnd(iconWidth, " ");
    const info = hero.infoLines[index] ?? "";
    lines.push(`${icon}  ${info}`);
  }
  return lines;
}

function resolveTerminalColumns(options: RenderStartScreenOptions): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  const stdoutIsTTY =
    typeof options.stdoutIsTTY === "boolean"
      ? options.stdoutIsTTY
      : Boolean(stdout.isTTY);
  if (!stdoutIsTTY) {
    return undefined;
  }
  if (typeof stdout.columns !== "number" || !Number.isFinite(stdout.columns) || stdout.columns <= 0) {
    return undefined;
  }
  return Math.floor(stdout.columns);
}

function truncateLine(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  const normalized = value.trimEnd();
  if (normalized.length <= maxWidth) {
    return normalized;
  }
  if (maxWidth <= 3) {
    return normalized.slice(0, maxWidth);
  }
  return `${normalized.slice(0, maxWidth - 3)}...`;
}

function padLine(value: string, width: number): string {
  const truncated = truncateLine(value, width);
  return truncated.padEnd(width, " ");
}

function renderPlainStartScreen(viewModel: StartScreenViewModel): string {
  const lines: string[] = [];
  if (viewModel.hero) {
    lines.push(viewModel.hero.brandLabel);
    lines.push("");
    lines.push(...renderHeroBlock(viewModel.hero));
    lines.push("");
  }
  if (viewModel.title.trim().length > 0) {
    lines.push(viewModel.title.trim());
  }
  lines.push(...viewModel.rows);
  lines.push("");
  lines.push(viewModel.commandHint);
  return `${lines.join("\n")}\n`;
}

export function renderStartScreen(
  viewModel: StartScreenViewModel,
  options: RenderStartScreenOptions = {},
): string {
  const mode = resolveCliRenderMode({
    stdinIsTTY: options.stdinIsTTY,
    stdoutIsTTY: options.stdoutIsTTY,
    env: options.env,
  });
  const theme = createCliTheme(mode);
  if (mode === "non_tty") {
    return renderPlainStartScreen(viewModel);
  }

  const columns = resolveTerminalColumns(options);
  const maxContentWidth = columns
    ? Math.max(56, Math.min(112, columns - 6))
    : 88;
  const heroLines = viewModel.hero
    ? renderHeroBlock(viewModel.hero)
    : [];
  const bodyLines: string[] = [];
  if (viewModel.hero) {
    bodyLines.push("Welcome back!");
    bodyLines.push("");
    bodyLines.push(...heroLines);
  }
  const compactRows = viewModel.rows.map((line) => line.trim()).filter((line) => line.length > 0);
  if (compactRows.length > 0) {
    if (bodyLines.length > 0) {
      bodyLines.push("");
    }
    bodyLines.push(...compactRows);
  }
  const compactHint = viewModel.commandHint.trim();
  if (compactHint.length > 0) {
    if (bodyLines.length > 0) {
      bodyLines.push("");
    }
    bodyLines.push(compactHint);
  }
  if (bodyLines.length === 0) {
    bodyLines.push("Welcome to Grobot.");
  }

  const computedWidth = bodyLines.reduce((width, line) => Math.max(width, line.length), 0);
  const contentWidth = Math.max(56, Math.min(maxContentWidth, computedWidth));
  const titleText = viewModel.title.trim().length > 0 ? viewModel.title.trim() : "Grobot";
  const titleSegment = ` ${titleText} `;
  const topBorderFillWidth = Math.max(0, contentWidth + 2 - titleSegment.length);
  const topBorder = `╭${titleSegment}${"─".repeat(topBorderFillWidth)}╮`;
  const bottomBorder = `╰${"─".repeat(contentWidth + 2)}╯`;

  const lines: string[] = [];
  if (viewModel.hero?.brandLabel) {
    lines.push(theme.color("accent", viewModel.hero.brandLabel));
  }
  lines.push(theme.color("brand", topBorder));
  for (const line of bodyLines) {
    lines.push(
      `${theme.color("brand", "│")} ${padLine(line, contentWidth)} ${theme.color("brand", "│")}`,
    );
  }
  lines.push(theme.color("brand", bottomBorder));
  return `${lines.join("\n")}\n`;
}
