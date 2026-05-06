export const TERMINAL_RGB = {
  brand: { r: 202, g: 124, b: 94 },
  success: { r: 112, g: 178, b: 126 },
  error: { r: 190, g: 72, b: 88 },
  info: { r: 176, g: 150, b: 134 },
  remember: { r: 174, g: 141, b: 123 },
  planMode: { r: 72, g: 150, b: 140 },
  muted: { r: 153, g: 153, b: 153 },
} as const;

function ansiRgb(color: { r: number; g: number; b: number }): string {
  return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
}

export const TERMINAL_ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  brand: ansiRgb(TERMINAL_RGB.brand),
  accent: ansiRgb(TERMINAL_RGB.brand),
  success: ansiRgb(TERMINAL_RGB.success),
  error: ansiRgb(TERMINAL_RGB.error),
  info: ansiRgb(TERMINAL_RGB.info),
  remember: ansiRgb(TERMINAL_RGB.remember),
  planMode: ansiRgb(TERMINAL_RGB.planMode),
  muted: "\x1b[90m",
} as const;

export const TERMINAL_SYMBOL = {
  pointer: "❯",
  scrollUp: "↑",
  scrollDown: "↓",
} as const;

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/;

function wrap(open: string, value: string): string {
  return `${open}${value}${TERMINAL_ANSI.reset}`;
}

export const terminalStyle = {
  hasAnsi(value: string): boolean {
    return ANSI_ESCAPE_PATTERN.test(value);
  },
  bold(value: string): string {
    return wrap(TERMINAL_ANSI.bold, value);
  },
  accent(value: string): string {
    return wrap(TERMINAL_ANSI.accent, value);
  },
  brand(value: string): string {
    return wrap(TERMINAL_ANSI.brand, value);
  },
  success(value: string): string {
    return wrap(TERMINAL_ANSI.success, value);
  },
  error(value: string): string {
    return wrap(TERMINAL_ANSI.error, value);
  },
  info(value: string): string {
    return wrap(TERMINAL_ANSI.info, value);
  },
  remember(value: string): string {
    return wrap(TERMINAL_ANSI.remember, value);
  },
  planMode(value: string): string {
    return wrap(TERMINAL_ANSI.planMode, value);
  },
  muted(value: string): string {
    return wrap(TERMINAL_ANSI.muted, value);
  },
  selected(value: string): string {
    return `${TERMINAL_ANSI.bold}${TERMINAL_ANSI.brand}${value}${TERMINAL_ANSI.reset}`;
  },
  pointer(value: string = TERMINAL_SYMBOL.pointer): string {
    return wrap(TERMINAL_ANSI.brand, value);
  },
  currentTag(value: string): string {
    return wrap(TERMINAL_ANSI.brand, value);
  },
} as const;
