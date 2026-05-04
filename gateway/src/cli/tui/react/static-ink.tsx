import React, {
  type ReactElement,
  type ReactNode,
} from "react";
import { type CliTheme, type CliThemeToken } from "../theme/ansi-theme";
import {
  measureDisplayWidth,
  padToDisplayWidth,
} from "../terminal/display-width";

const BOX_TYPE = "grobot.static-ink.box";
const TEXT_TYPE = "grobot.static-ink.text";
const DIVIDER_TYPE = "grobot.static-ink.divider";

type StaticElementType = typeof BOX_TYPE | typeof TEXT_TYPE | typeof DIVIDER_TYPE;

export interface BoxProps {
  children?: ReactNode;
  flexDirection?: "row" | "column";
  gap?: number;
  paddingTop?: number;
  paddingX?: number;
}

export interface TextProps {
  children?: ReactNode;
  tone?: CliThemeToken;
  bold?: boolean;
}

export interface DividerProps {
  width: number;
  tone?: CliThemeToken;
  char?: string;
}

interface StaticElementProps {
  children?: ReactNode;
  flexDirection?: "row" | "column";
  gap?: number;
  paddingTop?: number;
  paddingX?: number;
  tone?: CliThemeToken;
  bold?: boolean;
  width?: number;
  char?: string;
}

interface RenderContext {
  theme: CliTheme;
}

export function Box(props: BoxProps): ReactElement {
  return React.createElement(BOX_TYPE, props);
}

export function Text(props: TextProps): ReactElement {
  return React.createElement(TEXT_TYPE, props);
}

export function Divider(props: DividerProps): ReactElement {
  return React.createElement(DIVIDER_TYPE, props);
}

function isStaticElementType(value: unknown): value is StaticElementType {
  return value === BOX_TYPE || value === TEXT_TYPE || value === DIVIDER_TYPE;
}

function isReactFragment(value: unknown): boolean {
  return value === React.Fragment;
}

function normalizeLines(value: string): string[] {
  return value.split(/\r?\n/);
}

function renderInlineText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => renderInlineText(child)).join("");
  }
  if (React.isValidElement(node)) {
    const element = node as ReactElement<StaticElementProps>;
    if (typeof element.type === "function") {
      return renderInlineText(
        (element.type as (props: StaticElementProps) => ReactNode)(element.props),
      );
    }
    if (isReactFragment(element.type)) {
      return renderInlineText(element.props.children);
    }
    if (element.type === TEXT_TYPE) {
      return renderInlineText(element.props.children);
    }
  }
  return "";
}

function applyTextStyle(
  value: string,
  props: StaticElementProps,
  context: RenderContext,
): string {
  let rendered = value;
  if (props.tone) {
    rendered = context.theme.color(props.tone, rendered);
  }
  if (props.bold) {
    rendered = context.theme.bold(rendered);
  }
  return rendered;
}

function applyPaddingX(lines: string[], paddingX: number | undefined): string[] {
  const padding = Math.max(0, Math.floor(paddingX ?? 0));
  if (padding <= 0) {
    return lines;
  }
  const prefix = " ".repeat(padding);
  return lines.map((line) => `${prefix}${line}${prefix}`);
}

function blockWidth(lines: string[]): number {
  return lines.reduce(
    (width, line) => Math.max(width, measureDisplayWidth(line)),
    0,
  );
}

function renderRow(childBlocks: string[][], gap: number): string[] {
  if (childBlocks.length === 0) {
    return [];
  }
  const widths = childBlocks.map((block) => blockWidth(block));
  const lineCount = childBlocks.reduce(
    (count, block) => Math.max(count, block.length),
    0,
  );
  const gapText = " ".repeat(Math.max(0, Math.floor(gap)));
  const lines: string[] = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const cells = childBlocks.map((block, blockIndex) =>
      padToDisplayWidth(block[lineIndex] ?? "", widths[blockIndex] ?? 0)
    );
    lines.push(cells.join(gapText));
  }
  return lines;
}

function renderNode(node: ReactNode, context: RenderContext): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }
  if (typeof node === "string" || typeof node === "number") {
    return normalizeLines(String(node));
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => renderNode(child, context));
  }
  if (!React.isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<StaticElementProps>;
  if (typeof element.type === "function") {
    return renderNode(
      (element.type as (props: StaticElementProps) => ReactNode)(element.props),
      context,
    );
  }
  if (isReactFragment(element.type)) {
    return renderNode(element.props.children, context);
  }
  if (!isStaticElementType(element.type)) {
    return renderNode(element.props.children, context);
  }

  if (element.type === TEXT_TYPE) {
    const text = renderInlineText(element.props.children);
    return normalizeLines(text).map((line) =>
      applyTextStyle(line, element.props, context)
    );
  }
  if (element.type === DIVIDER_TYPE) {
    const width = Math.max(1, Math.floor(element.props.width ?? 1));
    const char = element.props.char ?? "─";
    const raw = char.repeat(width);
    return [element.props.tone ? context.theme.color(element.props.tone, raw) : raw];
  }

  const children = React.Children.toArray(element.props.children);
  const childBlocks = children.map((child) => renderNode(child, context));
  const direction = element.props.flexDirection ?? "column";
  const gap = Math.max(0, Math.floor(element.props.gap ?? 0));
  const lines = direction === "row"
    ? renderRow(childBlocks, gap)
    : childBlocks.flatMap((block, index) =>
      index > 0 && gap > 0 ? [...Array(gap).fill(""), ...block] : block
    );
  const withTopPadding = [
    ...Array(Math.max(0, Math.floor(element.props.paddingTop ?? 0))).fill(""),
    ...lines,
  ];
  return applyPaddingX(withTopPadding, element.props.paddingX);
}

export function renderStaticInk(node: ReactNode, theme: CliTheme): string {
  return renderNode(node, { theme }).join("\n");
}
