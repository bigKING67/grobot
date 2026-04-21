import { createCliUiRenderer } from "../../orchestration/entrypoints/dev-cli/ui/kernel/renderer";
import { measureDisplayWidth } from "../../orchestration/entrypoints/dev-cli/ui/interactive/display-width";
import { type StartScreenViewModel } from "../../orchestration/entrypoints/dev-cli/ui/screens/startup-screen";
import { type TerminalSelectMenuInput } from "../../orchestration/entrypoints/dev-cli/ui/screens/select-menu-screen";

function hasAnsi(text: string): boolean {
  return /\x1b\[[0-9;?]+[A-Za-z]/.test(text);
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]+[A-Za-z]/g, "");
}

function renderStartupAtColumns(
  renderer: ReturnType<typeof createCliUiRenderer>,
  viewModel: StartScreenViewModel,
  columns: number,
): string {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  try {
    Object.defineProperty(process.stdout, "columns", {
      value: columns,
      configurable: true,
    });
    return renderer.renderStartupScreen(viewModel);
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, "columns", descriptor);
    }
  }
}

function extractStartupBodyLines(rendered: string): string[] {
  return stripAnsi(rendered)
    .split("\n")
    .filter((line) => line.startsWith("│ "));
}

function extractRightPanelSegment(line: string): string | undefined {
  const parts = line.split("│");
  if (parts.length < 4) {
    return undefined;
  }
  return parts[2]?.trim();
}

const startupViewModel: StartScreenViewModel = {
  title: "Grobot v0.1.0",
  hero: {
    brandLabel: "Grobot",
    iconLines: [
      " __  ||  __ ",
      "/  \\ || /  \\",
      "\\   \\||/   /",
      " \\___||___/ ",
      "    _||_    ",
    ],
    infoLines: [
      "Grobot CLI v0.1.0",
      "alpha/model · 200k ctx budget · API Usage",
      "/tmp/project",
      "session abc123 (demo)",
    ],
  },
  feeds: [
    {
      title: "Tips for getting started",
      lines: [
        "Run /init to create a CLAUDE.md file with instructions",
      ],
      footer: "Use /help to list all commands",
    },
    {
      title: "Recent activity",
      lines: [
        "2h ago  Session planning update",
      ],
      emptyMessage: "No recent activity",
      footer: "/sessions for more",
    },
  ],
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

const startupBrandSymbolViewModel: StartScreenViewModel = {
  title: "Grobot v0.1.0",
  hero: {
    brandLabel: "",
    iconLines: [
      "  G R O L A N D®  ",
    ],
    infoLines: [],
  },
  feeds: [
    {
      title: "Tips for getting started",
      lines: [
        "Run /init to create a CLAUDE.md file with instructions",
      ],
    },
    {
      title: "Recent activity",
      lines: [
        "[store] history migrated from legacy path (/tmp/demo.history.json)",
      ],
      emptyMessage: "No recent activity",
      footer: "/sessions for more",
    },
  ],
  rows: [
    "claude-sonnet-4-5 (200K context) · API Usage Billing",
    "~/tmp/project",
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
const startupVariants = [96, 110, 120].map((columns) =>
  renderStartupAtColumns(interactiveRenderer, startupViewModel, columns)
);
const startupVariantBodies = startupVariants.map((rendered) => extractStartupBodyLines(rendered));
const startupNoJoinArtifact = startupVariants.every((rendered) => {
  const plain = stripAnsi(rendered);
  return plain.includes("┤ │") === false;
});
const startupNoTeeGlyph = startupVariantBodies.every((lines) =>
  lines.every((line) => line.includes("├") === false && line.includes("┤") === false)
);
const startupBodyWidthConsistent = startupVariantBodies.every((lines) => {
  if (lines.length === 0) {
    return false;
  }
  const widths = lines.map((line) => measureDisplayWidth(line));
  return new Set(widths).size === 1;
});
const startupDividerCountExpected = startupVariantBodies.every((lines) => {
  const dividerCount = lines.filter((line) => {
    const rightPanelSegment = extractRightPanelSegment(line);
    return typeof rightPanelSegment === "string" && /^─+$/.test(rightPanelSegment);
  }).length;
  return dividerCount === 1;
});
const startupBrandSymbolVariants = [96, 110, 120].map((columns) =>
  renderStartupAtColumns(interactiveRenderer, startupBrandSymbolViewModel, columns)
);
const startupBrandSymbolBodies = startupBrandSymbolVariants.map((rendered) =>
  extractStartupBodyLines(rendered)
);
const startupBrandSymbolBodyLengthConsistent = startupBrandSymbolBodies.every((lines) => {
  if (lines.length === 0) {
    return false;
  }
  const lengths = lines.map((line) => line.length);
  return new Set(lengths).size === 1;
});
const startupRegisteredSymbolSingleWidth = measureDisplayWidth("®") === 1;
const menuInteractive = interactiveRenderer.renderSelectMenu(menuInput, 0);
const menuPlain = plainRenderer.renderSelectMenu(menuInput, 0);
const menuNonTty = nonTtyRenderer.renderSelectMenu(menuInput, 0);

const payload = {
  interactive_mode: interactiveRenderer.mode,
  plain_mode: plainRenderer.mode,
  non_tty_mode: nonTtyRenderer.mode,
  startup_has_title: startupInteractive.includes("Grobot v0.1.0"),
  startup_has_brand_label: startupInteractive.includes("Grobot"),
  startup_has_logo_headline: startupInteractive.includes("Grobot CLI v0.1.0"),
  startup_has_logo_runtime_line: startupInteractive.includes("alpha/model · 200k ctx budget · API Usage"),
  startup_has_session_line: startupInteractive.includes("session_id:session-main"),
  startup_has_command_hint: startupInteractive.includes("Enter message"),
  startup_has_tips_title: startupInteractive.includes("Tips for getting started"),
  startup_has_recent_activity_title: startupInteractive.includes("Recent activity"),
  startup_has_recent_activity_empty_or_items:
    startupInteractive.includes("No recent activity")
    || startupInteractive.includes("2h ago  Session planning update"),
  startup_has_no_join_artifact: startupNoJoinArtifact,
  startup_has_no_tee_glyph: startupNoTeeGlyph,
  startup_body_width_consistent: startupBodyWidthConsistent,
  startup_feed_divider_count_expected: startupDividerCountExpected,
  startup_brand_symbol_body_length_consistent: startupBrandSymbolBodyLengthConsistent,
  startup_registered_symbol_single_width: startupRegisteredSymbolSingleWidth,
  menu_interactive_has_ansi: hasAnsi(menuInteractive),
  menu_plain_has_ansi: hasAnsi(menuPlain),
  menu_non_tty_has_ansi: hasAnsi(menuNonTty),
  menu_plain_has_pointer: menuPlain.includes("❯"),
  menu_interactive_has_current_check: menuInteractive.includes("✓"),
  menu_plain_has_secondary_description: menuPlain.includes("\n  Current active model"),
  menu_hint_is_compact: menuPlain.includes("·"),
  menu_hint_has_escape_back: menuPlain.includes("Esc back"),
  menu_hint_has_enter_space_action: menuPlain.includes("Enter/Space select"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
