import {
  type RenderStartScreenOptions,
  type StartScreenViewModel,
} from "../components/startup/contract";
import { renderStartScreen } from "../components/startup/render";
import {
  renderTerminalSelectMenu,
} from "../components/select-menu/render";
import {
  type TerminalSelectMenuInput,
} from "../components/select-menu/contract";
import { resolveCliRenderMode, type CliRenderMode } from "./render-mode";

export interface CliUiRenderer {
  readonly mode: CliRenderMode;
  renderStartupScreen(
    viewModel: StartScreenViewModel,
    renderOptions?: Pick<RenderStartScreenOptions, "terminalColumns">,
  ): string;
  renderSelectMenu(
    menu: TerminalSelectMenuInput,
    activeIndex: number,
    renderOptions?: Pick<RenderStartScreenOptions, "terminalColumns">,
  ): string;
}

export function createCliUiRenderer(options: RenderStartScreenOptions = {}): CliUiRenderer {
  const mode = resolveCliRenderMode({
    stdinIsTTY: options.stdinIsTTY,
    stdoutIsTTY: options.stdoutIsTTY,
    env: options.env,
  });
  return {
    mode,
    renderStartupScreen: (viewModel, renderOptions) =>
      renderStartScreen(viewModel, {
        stdinIsTTY: options.stdinIsTTY,
        stdoutIsTTY: options.stdoutIsTTY,
        terminalColumns: renderOptions?.terminalColumns ?? options.terminalColumns,
        env: options.env,
      }),
    renderSelectMenu: (menu, activeIndex, renderOptions) =>
      renderTerminalSelectMenu({
        menu,
        activeIndex,
        stdinIsTTY: options.stdinIsTTY,
        stdoutIsTTY: options.stdoutIsTTY,
        terminalColumns: renderOptions?.terminalColumns ?? options.terminalColumns,
        env: options.env,
      }),
  };
}
