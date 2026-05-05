import { resolveCliRenderMode } from "../../kernel/render-mode";
import { renderReactInfoPanel } from "../../react/info-panel";
import type { RenderInfoPanelOptions } from "./contract";
import type { InfoPanelViewModel } from "./contract";

const DEFAULT_INFO_PANEL_COLUMNS = 96;

function resolveTerminalColumns(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(40, Math.floor(value));
  }
  return DEFAULT_INFO_PANEL_COLUMNS;
}

export function renderInfoPanel(
  viewModel: InfoPanelViewModel,
  options: RenderInfoPanelOptions = {},
): string {
  const mode = options.interactiveMode ?? viewModel.interactiveMode;
  const renderMode = typeof mode === "boolean"
    ? mode ? "interactive_tty" : "plain_tty"
    : resolveCliRenderMode(options);
  const rendered = renderReactInfoPanel({
    ...viewModel,
    terminalColumns: resolveTerminalColumns(
      options.terminalColumns ?? viewModel.terminalColumns,
    ),
    interactiveMode: renderMode === "interactive_tty",
  });
  return `${rendered}\n`;
}
