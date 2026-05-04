import { type CliEnv } from "../kernel/render-mode";
import { type CliThemeToken } from "../theme/ansi-theme";
import { renderReactStartScreen } from "../react/startup-screen";

export interface StartScreenHeroViewModel {
  brandLabel: string;
  iconLines: string[];
  infoLines: string[];
}

export interface StartScreenFeedViewModel {
  title: string;
  lines: string[];
  emptyMessage?: string;
  footer?: string;
}

export interface StartScreenTitleSegment {
  text: string;
  token?: CliThemeToken;
}

export interface StartScreenViewModel {
  title: string;
  titleSegments?: StartScreenTitleSegment[];
  hero?: StartScreenHeroViewModel;
  feeds?: StartScreenFeedViewModel[];
  rows: string[];
  commandHint: string;
}

export interface RenderStartScreenOptions {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}

export interface StartScreenLine {
  text: string;
  token?: CliThemeToken;
  align?: "left" | "center";
}

export function renderStartScreen(
  viewModel: StartScreenViewModel,
  options: RenderStartScreenOptions = {},
): string {
  return renderReactStartScreen(viewModel, options);
}
