import { type CliRenderMode } from "../kernel/render-mode";

export type CliThemeToken = "accent" | "muted" | "info" | "title";

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_ACCENT = "\x1b[92m";
const ANSI_INFO = "\x1b[96m";
const ANSI_MUTED = "\x1b[90m";

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

function wrap(open: string, value: string): string {
  return `${open}${value}${ANSI_RESET}`;
}

const ansiTheme: CliTheme = {
  bold: (value) => wrap(ANSI_BOLD, value),
  color: (token, value) => {
    if (token === "accent") {
      return wrap(ANSI_ACCENT, value);
    }
    if (token === "info") {
      return wrap(ANSI_INFO, value);
    }
    if (token === "muted") {
      return wrap(ANSI_MUTED, value);
    }
    return wrap(ANSI_BOLD, value);
  },
  pointer: (value) => wrap(ANSI_ACCENT, value),
  currentTag: (value) => wrap(ANSI_INFO, value),
};

export function createCliTheme(mode: CliRenderMode): CliTheme {
  if (mode === "interactive_tty") {
    return ansiTheme;
  }
  return noColorTheme;
}
