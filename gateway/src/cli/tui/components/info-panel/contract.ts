import { type CliEnv } from "../../kernel/render-mode";

export type InfoPanelTone = "brand" | "muted" | "info" | "remember" | "planMode";

export interface InfoPanelRow {
  title: string;
  tone?: InfoPanelTone;
  detailLines?: readonly string[];
}

export interface InfoPanelSection {
  title?: string;
  rows: readonly InfoPanelRow[];
}

export interface InfoPanelViewModel {
  title: string;
  titleTone?: InfoPanelTone;
  subtitle?: string;
  sections: readonly InfoPanelSection[];
  footerLines?: readonly string[];
  terminalColumns?: number;
  interactiveMode?: boolean;
}

export interface RenderInfoPanelOptions {
  terminalColumns?: number;
  interactiveMode?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}
