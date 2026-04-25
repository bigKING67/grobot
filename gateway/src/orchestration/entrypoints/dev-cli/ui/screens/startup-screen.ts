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

export interface StartScreenTitleSegment {
  text: string;
  token?: CliThemeToken;
}

export interface StartScreenViewModel {
  title: string;
  titleSegments?: StartScreenTitleSegment[];
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
  text: string;
  token?: CliThemeToken;
  align?: "left" | "center";
}

interface StartScreenFeedSection {
  title: string;
  lines: string[];
  footer?: string;
}

interface StartScreenFeedColumnLine {
  kind: "content" | "divider";
  text: string;
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
    if (centerHeroLayout) {
      lines.push(createTextLine(""));
    }
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
      if (centerHeroLayout) {
        lines.push(createTextLine(""));
      }
    }
    for (const row of compactRows) {
      lines.push(createTextLine(row, "muted", centerHeroLayout ? "center" : "left"));
    }
  }

  if (centerHeroLayout) {
    while (lines.length < 8) {
      lines.push(createTextLine(""));
    }
  }

  if (lines.length === 0) {
    lines.push(createTextLine("Welcome to Grobot."));
  }
  return lines;
}

function buildFeedSections(viewModel: StartScreenViewModel): StartScreenFeedSection[] {
  const sections: StartScreenFeedSection[] = [];
  for (const feed of viewModel.feeds ?? []) {
    const title = feed.title.trim();
    if (title.length === 0) {
      continue;
    }
    const contentLines = compactLineRows(feed.lines);
    const emptyMessage = (feed.emptyMessage ?? "").trim();
    const footer = (feed.footer ?? "").trim();
    sections.push({
      title,
      lines: contentLines.length > 0
        ? contentLines
        : emptyMessage.length > 0
          ? [emptyMessage]
          : [],
      footer: footer.length > 0 ? footer : undefined,
    });
  }
  return sections;
}

function measureTextLine(line: StartScreenLine): number {
  return measureDisplayWidth(line.text);
}

function measureFeedSectionWidth(section: StartScreenFeedSection): number {
  let width = measureDisplayWidth(section.title);
  for (const line of section.lines) {
    width = Math.max(width, measureDisplayWidth(line));
  }
  if (section.footer) {
    width = Math.max(width, measureDisplayWidth(section.footer));
  }
  return width;
}

function measureFeedColumnWidth(sections: StartScreenFeedSection[]): number {
  return sections.reduce(
    (width, section) => Math.max(width, measureFeedSectionWidth(section)),
    0,
  );
}

function renderFeedDividerLine(
  width: number,
  theme: ReturnType<typeof createCliTheme>,
): StartScreenFeedColumnLine {
  return {
    kind: "divider",
    text: theme.color("brand", "─".repeat(Math.max(1, width))),
  };
}

function renderFeedSectionLines(
  section: StartScreenFeedSection,
  width: number,
  theme: ReturnType<typeof createCliTheme>,
): StartScreenFeedColumnLine[] {
  const lines: StartScreenFeedColumnLine[] = [];
  lines.push({
    kind: "content",
    text: theme.color("brand", padLine(section.title, width)),
  });
  for (const line of section.lines) {
    lines.push({
      kind: "content",
      text: theme.color("muted", padLine(line, width)),
    });
  }
  if (section.footer) {
    lines.push({
      kind: "content",
      text: theme.color("muted", padLine(section.footer, width)),
    });
  }
  return lines;
}

function renderFeedColumnLines(
  sections: StartScreenFeedSection[],
  width: number,
  theme: ReturnType<typeof createCliTheme>,
): StartScreenFeedColumnLine[] {
  const sectionWidth = Math.max(1, width);
  const lines: StartScreenFeedColumnLine[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    if (index > 0) {
      lines.push(renderFeedDividerLine(sectionWidth, theme));
    }
    lines.push(...renderFeedSectionLines(sections[index]!, sectionWidth, theme));
  }
  return lines;
}

function renderLineWithStyle(
  line: StartScreenLine,
  width: number,
  theme: ReturnType<typeof createCliTheme>,
): string {
  const content = line.align === "center"
    ? centerLine(line.text, width)
    : padLine(line.text, width);
  if (line.token) {
    return theme.color(line.token, content);
  }
  return content;
}

function resolveTitleSegments(viewModel: StartScreenViewModel): StartScreenTitleSegment[] {
  const explicitSegments = (viewModel.titleSegments ?? []).filter((segment) =>
    segment.text.length > 0
  );
  if (explicitSegments.length > 0) {
    return explicitSegments;
  }
  const titleText = viewModel.title.trim().length > 0 ? viewModel.title.trim() : "Grobot";
  return [
    {
      text: titleText,
      token: "brand",
    },
  ];
}

function truncateTitleSegments(
  segments: StartScreenTitleSegment[],
  maxWidth: number,
): StartScreenTitleSegment[] {
  const truncated: StartScreenTitleSegment[] = [];
  let remainingWidth = maxWidth;
  for (const segment of segments) {
    if (remainingWidth <= 0) {
      break;
    }
    const segmentWidth = measureDisplayWidth(segment.text);
    if (segmentWidth <= remainingWidth) {
      truncated.push(segment);
      remainingWidth -= segmentWidth;
      continue;
    }
    const text = truncateDisplayWidth(segment.text, remainingWidth, {
      ellipsis: "...",
    });
    if (text.length > 0) {
      truncated.push({
        ...segment,
        text,
      });
    }
    break;
  }
  return truncated;
}

function renderCardTopBorder(
  viewModel: StartScreenViewModel,
  contentWidth: number,
  theme: ReturnType<typeof createCliTheme>,
): string {
  const segments = truncateTitleSegments(
    resolveTitleSegments(viewModel),
    Math.max(1, contentWidth),
  );
  const titleWidth = segments.reduce(
    (width, segment) => width + measureDisplayWidth(segment.text),
    0,
  );
  const fillWidth = Math.max(0, contentWidth + 2 - titleWidth - 2);
  const titleText = segments.map((segment) =>
    segment.token ? theme.color(segment.token, segment.text) : segment.text
  ).join("");
  return [
    theme.color("brand", "╭ "),
    titleText,
    theme.color("brand", ` ${"─".repeat(fillWidth)}╮`),
  ].join("");
}

function renderCardBottomBorder(
  contentWidth: number,
  theme: ReturnType<typeof createCliTheme>,
): string {
  return theme.color("brand", `╰${"─".repeat(contentWidth + 2)}╯`);
}

function renderSingleColumnCard(
  viewModel: StartScreenViewModel,
  maxContentWidth: number,
  theme: ReturnType<typeof createCliTheme>,
): StartScreenCardLayout {
  const leftLines = buildLeftPanelLines(viewModel);
  const feedSections = buildFeedSections(viewModel);
  const computedWidth = Math.max(
    leftLines.reduce(
      (width, line) => Math.max(width, measureTextLine(line)),
      0,
    ),
    measureFeedColumnWidth(feedSections),
  );
  const contentWidth = clamp(computedWidth, 56, maxContentWidth);
  const bodyLines: string[] = leftLines.map((line) => renderLineWithStyle(line, contentWidth, theme));
  if (feedSections.length > 0) {
    bodyLines.push(renderFeedDividerLine(contentWidth, theme).text);
    for (const line of renderFeedColumnLines(feedSections, contentWidth, theme)) {
      bodyLines.push(line.text);
    }
  }
  return {
    contentWidth,
    bodyLines,
  };
}

function renderTwoColumnCard(
  viewModel: StartScreenViewModel,
  maxContentWidth: number,
  theme: ReturnType<typeof createCliTheme>,
): StartScreenCardLayout | undefined {
  const leftLines = buildLeftPanelLines(viewModel);
  const feedSections = buildFeedSections(viewModel);
  if (feedSections.length === 0) {
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
  const rightNatural = measureFeedColumnWidth(feedSections);
  const leftDesired = clamp(leftNatural + 2, leftMin, leftMax);
  const rightDesired = Math.max(rightMin, rightNatural + 2);

  let leftWidth = Math.min(leftDesired, maxContentWidth - dividerWidth - rightMin);
  let rightWidth = maxContentWidth - dividerWidth - leftWidth;
  if (rightWidth < rightMin || rightWidth < Math.min(24, rightDesired)) {
    return undefined;
  }

  const rightContentWidth = Math.max(1, rightWidth - 1);
  const rightLines = renderFeedColumnLines(feedSections, rightContentWidth, theme);
  const lineCount = Math.max(leftLines.length, rightLines.length);
  const bodyLines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const leftLine = leftLines[index] ?? createTextLine("");
    const leftText = renderLineWithStyle(leftLine, leftWidth, theme);
    const rightContent = rightLines[index]?.text ?? padLine("", rightContentWidth);
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

  const compactHint = viewModel.commandHint.trim();
  if (compactHint.length > 0) {
    lines.push("");
    lines.push(compactHint);
  }
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

  const cardLayout = supportsTwoColumn
    ? renderTwoColumnCard(viewModel, maxContentWidth, theme)
      ?? renderSingleColumnCard(viewModel, maxContentWidth, theme)
    : renderSingleColumnCard(viewModel, maxContentWidth, theme);

  const lines: string[] = [];
  if (viewModel.hero?.brandLabel) {
    lines.push(theme.color("accent", viewModel.hero.brandLabel));
  }
  lines.push(renderCardTopBorder(viewModel, cardLayout.contentWidth, theme));
  for (const line of cardLayout.bodyLines) {
    lines.push(`${theme.color("brand", "│")} ${line} ${theme.color("brand", "│")}`);
  }
  lines.push(renderCardBottomBorder(cardLayout.contentWidth, theme));
  const compactHint = viewModel.commandHint.trim();
  if (compactHint.length > 0) {
    lines.push("");
    lines.push(theme.color("muted", compactHint));
  }
  return `${lines.join("\n")}\n`;
}
