import {
  renderStartScreen,
  type RenderStartScreenOptions,
  type StartScreenViewModel,
} from "../screens/startup-screen";
import {
  renderTerminalSelectMenu,
  type TerminalSelectMenuInput,
} from "../screens/select-menu-screen";
import { resolveCliRenderMode, type CliRenderMode } from "./render-mode";

export interface CliUiRenderer {
  readonly mode: CliRenderMode;
  renderStartupScreen(viewModel: StartScreenViewModel): string;
  renderSelectMenu(menu: TerminalSelectMenuInput, activeIndex: number): string;
}

export function createCliUiRenderer(options: RenderStartScreenOptions = {}): CliUiRenderer {
  const mode = resolveCliRenderMode({
    stdinIsTTY: options.stdinIsTTY,
    stdoutIsTTY: options.stdoutIsTTY,
    env: options.env,
  });
  return {
    mode,
    renderStartupScreen: (viewModel) =>
      renderStartScreen(viewModel, {
        stdinIsTTY: options.stdinIsTTY,
        stdoutIsTTY: options.stdoutIsTTY,
        env: options.env,
      }),
    renderSelectMenu: (menu, activeIndex) =>
      renderTerminalSelectMenu({
        menu,
        activeIndex,
        stdinIsTTY: options.stdinIsTTY,
        stdoutIsTTY: options.stdoutIsTTY,
        env: options.env,
      }),
  };
}
