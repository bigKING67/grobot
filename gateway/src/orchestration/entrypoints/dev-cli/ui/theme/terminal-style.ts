export const TERMINAL_ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  accent: "\x1b[92m",
  brand: "\x1b[38;2;202;124;94m",
  info: "\x1b[96m",
  remember: "\x1b[38;2;166;170;255m",
  muted: "\x1b[90m",
} as const;

export const TERMINAL_SYMBOL = {
  pointer: "›",
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
  info(value: string): string {
    return wrap(TERMINAL_ANSI.info, value);
  },
  remember(value: string): string {
    return wrap(TERMINAL_ANSI.remember, value);
  },
  muted(value: string): string {
    return wrap(TERMINAL_ANSI.muted, value);
  },
  selected(value: string): string {
    return `${TERMINAL_ANSI.bold}${TERMINAL_ANSI.info}${value}${TERMINAL_ANSI.reset}`;
  },
  pointer(value: string = TERMINAL_SYMBOL.pointer): string {
    return wrap(TERMINAL_ANSI.accent, value);
  },
  currentTag(value: string): string {
    return wrap(TERMINAL_ANSI.info, value);
  },
} as const;
