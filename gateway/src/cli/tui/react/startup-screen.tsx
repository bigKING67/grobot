import React from "react";
import { createCliTheme } from "../theme/ansi-theme";
import { resolveCliRenderMode } from "../kernel/render-mode";
import type {
  RenderStartScreenOptions,
  StartScreenFeedViewModel,
  StartScreenLine,
  StartScreenTitleSegment,
  StartScreenViewModel,
} from "../components/startup/contract";
import {
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../terminal/display-width";
import { Box, Divider, Text, renderStaticInk } from "./static-ink";

interface StartupColumn {
  lines: StartScreenLine[];
  width: number;
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

function compactLineRows(rows: string[]): string[] {
  return rows.map((line) => line.trim()).filter((line) => line.length > 0);
}

function line(text = "", tone?: StartScreenLine["token"], align: StartScreenLine["align"] = "left"): StartScreenLine {
  return {
    text,
    token: tone,
    align,
  };
}

function renderHeroBlock(viewModel: StartScreenViewModel): string[] {
  if (!viewModel.hero) {
    return [];
  }
  const iconWidth = viewModel.hero.iconLines.reduce(
    (width, heroLine) => Math.max(width, measureDisplayWidth(heroLine)),
    0,
  );
  const rowCount = Math.max(viewModel.hero.iconLines.length, viewModel.hero.infoLines.length);
  const lines: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const icon = padToDisplayWidth(viewModel.hero.iconLines[index] ?? "", iconWidth);
    const info = viewModel.hero.infoLines[index] ?? "";
    lines.push(`${icon}${info.length > 0 ? `  ${info}` : ""}`.trimEnd());
  }
  return lines;
}

function buildIdentityColumn(viewModel: StartScreenViewModel): StartupColumn {
  const output: StartScreenLine[] = [];
  const centerHero = (viewModel.hero?.infoLines.length ?? -1) === 0;
  if (viewModel.hero) {
    output.push(line("Welcome back", "title", "center"));
    output.push(line(""));
    output.push(...renderHeroBlock(viewModel).map((heroLine) =>
      line(heroLine.trim(), centerHero ? "brand" : undefined, centerHero ? "center" : "left")
    ));
  }
  const rows = compactLineRows(viewModel.rows);
  if (rows.length > 0) {
    if (output.length > 0) {
      output.push(line(""));
    }
    for (const row of rows) {
      output.push(line(row, "muted", centerHero ? "center" : "left"));
    }
  }
  while (centerHero && output.length < 8) {
    output.push(line(""));
  }
  if (output.length === 0) {
    output.push(line("Welcome to Grobot."));
  }
  const width = clamp(
    output.reduce((max, item) => Math.max(max, measureDisplayWidth(item.text)), 0) + 2,
    34,
    58,
  );
  return {
    lines: output,
    width,
  };
}

function buildFeedLines(feeds: StartScreenFeedViewModel[]): StartScreenLine[] {
  const output: StartScreenLine[] = [];
  for (const feed of feeds) {
    const title = feed.title.trim();
    if (!title) {
      continue;
    }
    if (output.length > 0) {
      output.push(line("divider", "brand"));
    }
    output.push(line(title, "brand"));
    const content = compactLineRows(feed.lines);
    const fallback = (feed.emptyMessage ?? "").trim();
    for (const feedLine of content.length > 0 ? content : fallback ? [fallback] : []) {
      output.push(line(feedLine, "muted"));
    }
    const footer = (feed.footer ?? "").trim();
    if (footer) {
      output.push(line(footer, "muted"));
    }
  }
  return output;
}

function buildFeedColumn(viewModel: StartScreenViewModel): StartupColumn | undefined {
  const lines = buildFeedLines(viewModel.feeds ?? []);
  if (lines.length === 0) {
    return undefined;
  }
  const width = clamp(
    lines.reduce((max, item) => {
      if (item.text === "divider") {
        return max;
      }
      return Math.max(max, measureDisplayWidth(item.text));
    }, 0) + 2,
    26,
    54,
  );
  return {
    lines,
    width,
  };
}

function resolveColumns(options: RenderStartScreenOptions): number {
  const stdoutIsTTY = typeof options.stdoutIsTTY === "boolean"
    ? options.stdoutIsTTY
    : false;
  if (
    !stdoutIsTTY
    || typeof options.terminalColumns !== "number"
    || !Number.isFinite(options.terminalColumns)
  ) {
    return 110;
  }
  return Math.max(72, Math.floor(options.terminalColumns));
}

function alignText(raw: string, width: number, align: StartScreenLine["align"]): string {
  const text = truncateDisplayWidth(raw, width, { ellipsis: "..." });
  const textWidth = measureDisplayWidth(text);
  if (align !== "center" || textWidth >= width) {
    return padToDisplayWidth(text, width);
  }
  const left = Math.floor((width - textWidth) / 2);
  return `${" ".repeat(left)}${padToDisplayWidth(text, width - left)}`;
}

function renderScreenLine(item: StartScreenLine, width: number): React.ReactElement {
  if (item.text === "divider" && item.token === "brand") {
    return <Divider width={width} tone="brand" />;
  }
  return (
    <Text tone={item.token}>
      {alignText(item.text, width, item.align)}
    </Text>
  );
}

function resolveTitleSegments(viewModel: StartScreenViewModel): StartScreenTitleSegment[] {
  const explicit = (viewModel.titleSegments ?? []).filter((segment) => segment.text.length > 0);
  if (explicit.length > 0) {
    return explicit;
  }
  return [
    {
      text: viewModel.title.trim() || "Grobot",
      token: "brand",
    },
  ];
}

function titleWidth(segments: StartScreenTitleSegment[]): number {
  return segments.reduce((width, segment) => width + measureDisplayWidth(segment.text), 0);
}

function resolveTwoColumnWidths(input: {
  bodyWidth: number;
  identityWidth: number;
  feedWidth: number;
}): { identityWidth: number; feedWidth: number } {
  const available = Math.max(2, input.bodyWidth - 3);
  if (input.identityWidth + input.feedWidth <= available) {
    return {
      identityWidth: input.identityWidth,
      feedWidth: input.feedWidth,
    };
  }
  const minIdentityWidth = Math.min(input.identityWidth, 34);
  const minFeedWidth = Math.min(input.feedWidth, 26);
  let feedWidth = Math.min(
    input.feedWidth,
    Math.max(minFeedWidth, Math.floor(available * 0.42)),
  );
  let identityWidth = Math.min(input.identityWidth, available - feedWidth);
  if (identityWidth < minIdentityWidth) {
    identityWidth = minIdentityWidth;
    feedWidth = Math.min(input.feedWidth, Math.max(1, available - identityWidth));
  }
  return {
    identityWidth: Math.max(1, identityWidth),
    feedWidth: Math.max(1, feedWidth),
  };
}

function renderTitle(segments: StartScreenTitleSegment[], maxWidth: number): React.ReactElement[] {
  const rendered: React.ReactElement[] = [];
  let remaining = maxWidth;
  for (let index = 0; index < segments.length; index += 1) {
    if (remaining <= 0) {
      break;
    }
    const segment = segments[index]!;
    const text = truncateDisplayWidth(segment.text, remaining, { ellipsis: "..." });
    if (text.length > 0) {
      rendered.push(<Text key={index} tone={segment.token}>{text}</Text>);
      remaining -= measureDisplayWidth(text);
    }
  }
  return rendered;
}

function renderPlainStartScreen(viewModel: StartScreenViewModel): string {
  const lines: string[] = [];
  if (viewModel.hero?.brandLabel) {
    lines.push(viewModel.hero.brandLabel);
    lines.push("");
  }
  lines.push(...renderHeroBlock(viewModel));
  if (viewModel.title.trim().length > 0) {
    lines.push("");
    lines.push(viewModel.title.trim());
  }
  lines.push(...viewModel.rows);
  for (const feed of viewModel.feeds ?? []) {
    lines.push("");
    lines.push(`${feed.title.trim()}:`);
    const content = compactLineRows(feed.lines);
    const fallback = (feed.emptyMessage ?? "").trim();
    for (const item of content.length > 0 ? content : fallback ? [fallback] : []) {
      lines.push(`- ${item}`);
    }
    const footer = (feed.footer ?? "").trim();
    if (footer) {
      lines.push(`- ${footer}`);
    }
  }
  const hint = viewModel.commandHint.trim();
  if (hint) {
    lines.push("");
    lines.push(hint);
  }
  return `${lines.filter((item, index, array) =>
    !(item === "" && array[index - 1] === "")
  ).join("\n")}\n`;
}

function StartupScreen({
  viewModel,
  columns,
}: {
  viewModel: StartScreenViewModel;
  columns: number;
}): React.ReactElement {
  const identity = buildIdentityColumn(viewModel);
  const feed = buildFeedColumn(viewModel);
  const horizontalPadding = 2;
  const contentBudget = clamp(columns - 8 - (horizontalPadding * 2), 56, 116);
  const useTwoColumns = Boolean(feed) && columns >= 96;
  const feedWidth = feed?.width ?? 0;
  const bodyWidth = useTwoColumns
    ? Math.min(contentBudget, identity.width + 3 + feedWidth)
    : Math.min(contentBudget, Math.max(identity.width, feedWidth, 56));
  const segments = resolveTitleSegments(viewModel);
  const surfaceWidth = bodyWidth + (horizontalPadding * 2);
  const renderedTitleWidth = Math.min(
    titleWidth(segments),
    Math.max(1, surfaceWidth - 2),
  );
  const topFill = Math.max(1, surfaceWidth - renderedTitleWidth - 1);
  const columnWidths = useTwoColumns && feed
    ? resolveTwoColumnWidths({
      bodyWidth,
      identityWidth: identity.width,
      feedWidth,
    })
    : {
      identityWidth: bodyWidth,
      feedWidth: bodyWidth,
    };
  const lineCount = useTwoColumns && feed
    ? Math.max(identity.lines.length, feed.lines.length)
    : identity.lines.length + (feed ? 1 + feed.lines.length : 0);
  const rows: React.ReactElement[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (useTwoColumns && feed) {
      rows.push(
        <Box key={index} flexDirection="row" gap={1}>
          {renderScreenLine(identity.lines[index] ?? line(""), columnWidths.identityWidth)}
          <Text tone="brand">│</Text>
          {renderScreenLine(feed.lines[index] ?? line(""), columnWidths.feedWidth)}
        </Box>,
      );
    } else {
      const mergedLines = feed
        ? [...identity.lines, line("divider", "brand"), ...feed.lines]
        : identity.lines;
      rows.push(renderScreenLine(mergedLines[index] ?? line(""), bodyWidth));
    }
  }
  return (
    <Box flexDirection="column">
      {viewModel.hero?.brandLabel ? <Text tone="accent">{viewModel.hero.brandLabel}</Text> : null}
      <Box flexDirection="row">
        {renderTitle(segments, renderedTitleWidth)}
        <Text tone="brand"> {"─".repeat(topFill)}</Text>
      </Box>
      <Box flexDirection="column" paddingX={horizontalPadding}>
        {rows}
      </Box>
      {viewModel.commandHint.trim() ? (
        <Box paddingTop={1}>
          <Text tone="muted">{viewModel.commandHint.trim()}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function renderReactStartScreen(
  viewModel: StartScreenViewModel,
  options: RenderStartScreenOptions = {},
): string {
  const mode = resolveCliRenderMode({
    stdinIsTTY: options.stdinIsTTY,
    stdoutIsTTY: options.stdoutIsTTY,
    env: options.env,
  });
  if (mode === "non_tty") {
    return renderPlainStartScreen(viewModel);
  }
  const rendered = renderStaticInk(
    <StartupScreen viewModel={viewModel} columns={resolveColumns(options)} />,
    createCliTheme(mode),
  );
  return `${rendered}\n`;
}
