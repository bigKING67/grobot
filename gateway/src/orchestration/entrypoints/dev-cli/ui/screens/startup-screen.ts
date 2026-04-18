import { resolveCliRenderMode, type CliEnv } from "../kernel/render-mode";
import { createCliTheme } from "../theme/ansi-theme";

export interface StartScreenViewModel {
  title: string;
  rows: string[];
  commandHint: string;
}

export interface RenderStartScreenOptions {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}

export function renderStartScreen(
  viewModel: StartScreenViewModel,
  options: RenderStartScreenOptions = {},
): string {
  const mode = resolveCliRenderMode({
    stdinIsTTY: options.stdinIsTTY,
    stdoutIsTTY: options.stdoutIsTTY,
    env: options.env,
  });
  const theme = createCliTheme(mode);
  const lines: string[] = [];
  lines.push(theme.bold(viewModel.title));
  lines.push(...viewModel.rows);
  lines.push("");
  lines.push(viewModel.commandHint);
  return `${lines.join("\n")}\n`;
}
