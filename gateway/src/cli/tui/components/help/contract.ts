import { type CliEnv } from "../../kernel/render-mode";

export interface HelpCommandItem {
  command: string;
  description: string;
}

export interface HelpShortcutItem {
  key: string;
  description: string;
}

export interface HelpSectionViewModel {
  title: string;
  items: readonly HelpCommandItem[];
}

export interface HelpScreenViewModel {
  title: string;
  subtitle: string;
  shortcutsTitle: string;
  shortcuts: readonly HelpShortcutItem[];
  sections: readonly HelpSectionViewModel[];
  notesTitle: string;
  notes: readonly string[];
  footer: string;
  terminalColumns?: number;
  interactiveMode?: boolean;
}

export interface BuildHelpScreenInput {
  primaryHelpLines?: readonly string[];
  utilityHelpLines?: readonly string[];
  compatibilityNotes?: readonly string[];
  terminalColumns?: number;
  interactiveMode?: boolean;
}

export interface RenderHelpScreenOptions {
  terminalColumns?: number;
  interactiveMode?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}
