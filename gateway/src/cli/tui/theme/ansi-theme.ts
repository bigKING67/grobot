import { type CliRenderMode } from "../kernel/render-mode";
import { terminalStyle } from "./terminal-style";

export type CliThemeToken =
  | "accent"
  | "brand"
  | "success"
  | "error"
  | "muted"
  | "info"
  | "remember"
  | "planMode"
  | "title";

export interface CliTheme {
  bold(value: string): string;
  color(token: CliThemeToken, value: string): string;
  pointer(value: string): string;
  currentTag(value: string): string;
}

const noColorTheme: CliTheme = {
  bold: (value) => value,
  color: (_token, value) => value,
  pointer: (value) => value,
  currentTag: (value) => value,
};

const ansiTheme: CliTheme = {
  bold: terminalStyle.bold,
  color: (token, value) => {
    if (token === "accent") {
      return terminalStyle.accent(value);
    }
    if (token === "brand") {
      return terminalStyle.brand(value);
    }
    if (token === "success") {
      return terminalStyle.success(value);
    }
    if (token === "error") {
      return terminalStyle.error(value);
    }
    if (token === "info") {
      return terminalStyle.info(value);
    }
    if (token === "remember") {
      return terminalStyle.remember(value);
    }
    if (token === "planMode") {
      return terminalStyle.planMode(value);
    }
    if (token === "muted") {
      return terminalStyle.muted(value);
    }
    return terminalStyle.bold(value);
  },
  pointer: terminalStyle.pointer,
  currentTag: terminalStyle.currentTag,
};

export function createCliTheme(mode: CliRenderMode): CliTheme {
  if (mode === "interactive_tty") {
    return ansiTheme;
  }
  return noColorTheme;
}
