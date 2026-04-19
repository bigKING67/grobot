import { createCliUiRenderer } from "../../orchestration/entrypoints/dev-cli/ui/kernel/renderer";
import { type StartScreenViewModel } from "../../orchestration/entrypoints/dev-cli/ui/screens/startup-screen";
import { type TerminalSelectMenuInput } from "../../orchestration/entrypoints/dev-cli/ui/screens/select-menu-screen";

function hasAnsi(text: string): boolean {
  return /\x1b\[[0-9;?]+[A-Za-z]/.test(text);
}

const startupViewModel: StartScreenViewModel = {
  title: "Grobot started",
  hero: {
    brandLabel: "Grobot",
    iconLines: [
      "   .----.   ",
      "  / .--. \\  ",
      " | | () | | ",
      " |  '--'  | ",
      "  \\_====_/  ",
    ],
    infoLines: [
      "Grobot CLI v0.1.0",
      "alpha/model · 200k ctx budget · API Usage",
      "/tmp/project",
      "session abc123 (demo)",
    ],
  },
  rows: [
    "  home:      /tmp/home",
    "  root:      /tmp/project",
    "  project:   grobot",
    "  work_dir:  /tmp/work",
    "  session:   feishu:grobot:dm:ui-contract",
    "  namespace: feishu:grobot:dm",
    "  session_id:session-main",
  ],
  commandHint: "Enter message (`/help`, `/exit`):",
};

const menuInput: TerminalSelectMenuInput = {
  title: "Select Model",
  subtitle: "Provider: alpha",
  items: [
    {
      id: "model-a",
      label: "model-a",
      current: true,
      description: "Current active model",
    },
    {
      id: "model-b",
      label: "model-b",
    },
  ],
};

const interactiveRenderer = createCliUiRenderer({
  stdinIsTTY: true,
  stdoutIsTTY: true,
  env: {
    TERM: "xterm-256color",
  },
});
const plainRenderer = createCliUiRenderer({
  stdinIsTTY: true,
  stdoutIsTTY: true,
  env: {
    TERM: "dumb",
  },
});
const nonTtyRenderer = createCliUiRenderer({
  stdinIsTTY: false,
  stdoutIsTTY: false,
  env: {
    TERM: "xterm-256color",
  },
});

const startupInteractive = interactiveRenderer.renderStartupScreen(startupViewModel);
const menuInteractive = interactiveRenderer.renderSelectMenu(menuInput, 0);
const menuPlain = plainRenderer.renderSelectMenu(menuInput, 0);
const menuNonTty = nonTtyRenderer.renderSelectMenu(menuInput, 0);

const payload = {
  interactive_mode: interactiveRenderer.mode,
  plain_mode: plainRenderer.mode,
  non_tty_mode: nonTtyRenderer.mode,
  startup_has_title: startupInteractive.includes("Grobot started"),
  startup_has_brand_label: startupInteractive.includes("Grobot"),
  startup_has_logo_headline: startupInteractive.includes("Grobot CLI v0.1.0"),
  startup_has_logo_runtime_line: startupInteractive.includes("alpha/model · 200k ctx budget · API Usage"),
  startup_has_session_line: startupInteractive.includes("session_id:session-main"),
  startup_has_command_hint: startupInteractive.includes("Enter message"),
  menu_interactive_has_ansi: hasAnsi(menuInteractive),
  menu_plain_has_ansi: hasAnsi(menuPlain),
  menu_non_tty_has_ansi: hasAnsi(menuNonTty),
  menu_plain_has_pointer: menuPlain.includes("›"),
  menu_interactive_has_current_tag: menuInteractive.includes("(current)"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
