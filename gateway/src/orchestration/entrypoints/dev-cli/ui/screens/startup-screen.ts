import { resolveCliRenderMode, type CliEnv } from "../kernel/render-mode";
import { createCliTheme, type CliThemeToken } from "../theme/ansi-theme";
import {
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../interactive/display-width";

export interface StartScreenHeroViewModel {
  brandLabel: string;
  iconLines: string[];
  infoLines: string[];
}

export interface StartScreenFeedViewModel {
  title: string;
  lines: string[];
  emptyMessage?: string;
  footer?: string;
}

export interface StartScreenViewModel {
  title: string;
  hero?: StartScreenHeroViewModel;
  feeds?: StartScreenFeedViewModel[];
  rows: string[];
  commandHint: string;
}

export interface RenderStartScreenOptions {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}

interface StartScreenLine {
  kind: "text" | "separator";
  text?: string;
  token?: CliThemeToken;
  align?: "left" | "center";
}

interface StartScreenCardLayout {
  bodyLines: string[];
  contentWidth: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function createTextLine(
  text: string,
  token?: CliThemeToken,
  align: "left" | "center" = "left",
): StartScreenLine {
  return {
    kind: "text",
    text,
    token,
    align,
  };
}

function renderHeroBlock(hero: StartScreenHeroViewModel): string[] {
  const iconWidth = hero.iconLines.reduce(
    (width, line) => Math.max(width, measureDisplayWidth(line)),
    0,
  );
  const rowCount = Math.max(hero.iconLines.length, hero.infoLines.length);
  const lines: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const icon = padToDisplayWidth(hero.iconLines[index] ?? "", iconWidth);
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
  const stdoutIsTTY = typeof options.stdoutIsTTY === "boolean"
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
  return truncateDisplayWidth(value.trimEnd(), maxWidth, {
    ellipsis: "...",
  });
}

function padLine(value: string, width: number): string {
  return padToDisplayWidth(truncateLine(value, width), width);
}

function centerLine(value: string, width: number): string {
  const truncated = truncateLine(value, width);
  const displayWidth = measureDisplayWidth(truncated);
  if (displayWidth >= width) {
    return truncated;
  }
  const leftPad = Math.floor((width - displayWidth) / 2);
  const rightPad = Math.max(0, width - displayWidth - leftPad);
  return `${" ".repeat(leftPad)}${truncated}${" ".repeat(rightPad)}`;
}

function compactLineRows(rows: string[]): string[] {
  return rows.map((line) => line.trim()).filter((line) => line.length > 0);
}

function buildLeftPanelLines(viewModel: StartScreenViewModel): StartScreenLine[] {
  const lines: StartScreenLine[] = [];
  const centerHeroLayout = (viewModel.hero?.infoLines.length ?? -1) === 0;
  if (viewModel.hero) {
    lines.push(createTextLine("Welcome back!", "title", "center"));
    lines.push(createTextLine(""));
    const heroLines = renderHeroBlock(viewModel.hero).map((line) =>
      centerHeroLayout ? line.trim() : line.trimEnd()
    );
    const heroAlign = centerHeroLayout ? "center" : "left";
    for (const line of heroLines) {
      lines.push(createTextLine(line, centerHeroLayout ? "brand" : undefined, heroAlign));
    }
  }

  const compactRows = compactLineRows(viewModel.rows);
  if (compactRows.length > 0) {
    if (lines.length > 0) {
      lines.push(createTextLine(""));
    }
    for (const row of compactRows) {
      lines.push(createTextLine(row, "muted", centerHeroLayout ? "center" : "left"));
    }
  }

  if (lines.length === 0) {
    lines.push(createTextLine("Welcome to Grobot."));
  }
  return lines;
}

function buildRightPanelLines(viewModel: StartScreenViewModel): StartScreenLine[] {
  const feeds = (viewModel.feeds ?? []).filter((feed) => feed.title.trim().length > 0);
  if (feeds.length === 0) {
    return [];
  }
  const lines: StartScreenLine[] = [];
  for (let index = 0; index < feeds.length; index += 1) {
    const feed = feeds[index];
    if (index > 0) {
      lines.push({
        kind: "separator",
        token: "brand",
      });
    }
    lines.push(createTextLine(feed.title.trim(), "accent"));

    const compactFeedLines = feed.lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (compactFeedLines.length > 0) {
      for (const line of compactFeedLines) {
        lines.push(createTextLine(line, "muted"));
      }
    } else if ((feed.emptyMessage ?? "").trim().length > 0) {
      lines.push(createTextLine(feed.emptyMessage!.trim(), "muted"));
    }

    const footer = (feed.footer ?? "").trim();
    if (footer.length > 0) {
      lines.push(createTextLine(footer, "info"));
    }
  }
  return lines;
}

function measureTextLine(line: StartScreenLine): number {
  if (line.kind === "separator") {
    return 0;
  }
  return measureDisplayWidth(line.text ?? "");
}

function renderLineWithStyle(
  line: StartScreenLine,
  width: number,
  theme: ReturnType<typeof createCliTheme>,
): string {
  if (line.kind === "separator") {
    const token = line.token ?? "brand";
    return theme.color(token, "─".repeat(width));
  }
  const content = line.align === "center"
    ? centerLine(line.text ?? "", width)
    : padLine(line.text ?? "", width);
  if (line.token) {
    return theme.color(line.token, content);
  }
  return content;
}

function buildCardBorders(
  title: string,
  contentWidth: number,
): {
  topBorder: string;
  bottomBorder: string;
} {
  const titleText = title.trim().length > 0 ? title.trim() : "Grobot";
  const topTitle = ` ${truncateLine(titleText, Math.max(1, contentWidth))} `;
  const fillWidth = Math.max(0, contentWidth + 2 - measureDisplayWidth(topTitle));
  return {
    topBorder: `╭${topTitle}${"─".repeat(fillWidth)}╮`,
    bottomBorder: `╰${"─".repeat(contentWidth + 2)}╯`,
  };
}

function renderSingleColumnCard(
  viewModel: StartScreenViewModel,
  maxContentWidth: number,
  theme: ReturnType<typeof createCliTheme>,
): StartScreenCardLayout {
  const bodyLines = buildLeftPanelLines(viewModel);
  const rightLines = buildRightPanelLines(viewModel);
  if (rightLines.length > 0) {
    bodyLines.push({
      kind: "separator",
      token: "brand",
    });
    bodyLines.push(...rightLines);
  }
  const computedWidth = bodyLines.reduce(
    (width, line) => Math.max(width, measureTextLine(line)),
    0,
  );
  const contentWidth = clamp(computedWidth, 56, maxContentWidth);
  return {
    contentWidth,
    bodyLines: bodyLines.map((line) => renderLineWithStyle(line, contentWidth, theme)),
  };
}

function renderTwoColumnCard(
  viewModel: StartScreenViewModel,
  maxContentWidth: number,
  theme: ReturnType<typeof createCliTheme>,
): StartScreenCardLayout | undefined {
  const leftLines = buildLeftPanelLines(viewModel);
  const rightLines = buildRightPanelLines(viewModel);
  if (rightLines.length === 0) {
    return undefined;
  }

  const dividerWidth = 1;
  const leftMin = 32;
  const rightMin = 24;
  const leftMax = Math.max(58, maxContentWidth - dividerWidth - rightMin);
  if (maxContentWidth < leftMin + dividerWidth + rightMin) {
    return undefined;
  }

  const leftNatural = leftLines.reduce(
    (width, line) => Math.max(width, measureTextLine(line)),
    0,
  );
  const rightNatural = rightLines.reduce(
    (width, line) => Math.max(width, measureTextLine(line)),
    0,
  );
  const leftDesired = clamp(leftNatural + 2, leftMin, leftMax);
  const rightDesired = Math.max(rightMin, rightNatural + 2);

  let leftWidth = Math.min(leftDesired, maxContentWidth - dividerWidth - rightMin);
  let rightWidth = maxContentWidth - dividerWidth - leftWidth;
  if (rightWidth < rightMin || rightWidth < Math.min(24, rightDesired)) {
    return undefined;
  }

  const lineCount = Math.max(leftLines.length, rightLines.length);
  const bodyLines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const leftLine = leftLines[index] ?? createTextLine("");
    const rightLine = rightLines[index] ?? createTextLine("");
    const leftText = renderLineWithStyle(leftLine, leftWidth, theme);
    if (rightLine.kind === "separator") {
      // Match tools/all Divider behavior: keep separator inset so it never touches vertical strokes.
      const separatorCoreWidth = Math.max(1, rightWidth - 2);
      const separator = theme.color("brand", ` ${"─".repeat(separatorCoreWidth)} `);
      bodyLines.push(`${leftText}${theme.color("brand", "│")}${separator}`);
      continue;
    }
    const rightContentWidth = Math.max(1, rightWidth - 1);
    const rightContent = renderLineWithStyle(rightLine, rightContentWidth, theme);
    bodyLines.push(`${leftText}${theme.color("brand", "│")} ${rightContent}`);
  }

  return {
    contentWidth: leftWidth + dividerWidth + rightWidth,
    bodyLines,
  };
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

  const feeds = viewModel.feeds ?? [];
  if (feeds.length > 0) {
    lines.push("");
    for (const feed of feeds) {
      const title = feed.title.trim();
      if (title.length > 0) {
        lines.push(`${title}:`);
      }
      const compactFeedLines = feed.lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (compactFeedLines.length > 0) {
        for (const line of compactFeedLines) {
          lines.push(`- ${line}`);
        }
      } else if ((feed.emptyMessage ?? "").trim().length > 0) {
        lines.push(`- ${feed.emptyMessage!.trim()}`);
      }
      const footer = (feed.footer ?? "").trim();
      if (footer.length > 0) {
        lines.push(`- ${footer}`);
      }
      lines.push("");
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
  }

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
  const effectiveColumns = columns ?? 110;
  const maxContentWidth = clamp(effectiveColumns - 8, 72, 116);
  const supportsTwoColumn = effectiveColumns >= 96;
  const titleText = viewModel.title.trim().length > 0 ? viewModel.title.trim() : "Grobot";

  const cardLayout = supportsTwoColumn
    ? renderTwoColumnCard(viewModel, maxContentWidth, theme)
      ?? renderSingleColumnCard(viewModel, maxContentWidth, theme)
    : renderSingleColumnCard(viewModel, maxContentWidth, theme);
  const borders = buildCardBorders(titleText, cardLayout.contentWidth);

  const lines: string[] = [];
  if (viewModel.hero?.brandLabel) {
    lines.push(theme.color("accent", viewModel.hero.brandLabel));
  }
  lines.push(theme.color("brand", borders.topBorder));
  for (const line of cardLayout.bodyLines) {
    lines.push(`${theme.color("brand", "│")} ${line} ${theme.color("brand", "│")}`);
  }
  lines.push(theme.color("brand", borders.bottomBorder));
  const compactHint = viewModel.commandHint.trim();
  if (compactHint.length > 0) {
    lines.push("");
    lines.push(theme.color("info", compactHint));
  }
  return `${lines.join("\n")}\n`;
}
