import { type TerminalSelectMenuInput } from "../../../cli/tui/components/select-menu/contract";
import { type StartScreenViewModel } from "../../../cli/tui/components/startup/contract";

export const startupViewModel: StartScreenViewModel = {
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
      title: "Get started",
      lines: [
        "Run /init to create AGENTS.md instructions",
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
  commandHint: "",
};

export const startupBrandSymbolViewModel: StartScreenViewModel = {
  title: "Grobot 0.1.0 developed by 67",
  titleSegments: [
    {
      text: "Grobot",
      token: "brand",
    },
    {
      text: " 0.1.0 developed by 67",
      token: "muted",
    },
  ],
  hero: {
    brandLabel: "",
    iconLines: [
      "  G R O L A N D®  ",
    ],
    infoLines: [],
  },
  feeds: [
    {
      title: "Get started",
      lines: [
        "Run /init to create AGENTS.md instructions",
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
  commandHint: "",
};

export const menuInput: TerminalSelectMenuInput = {
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

export const disabledMenuInput: TerminalSelectMenuInput = {
  title: "Select action",
  subtitle: "Disabled row contract",
  hint: "Use arrows",
  items: [
    {
      id: "run-checks",
      label: "Run checks",
      description: "Available action",
    },
    {
      id: "deploy",
      label: "Deploy",
      description: "Requires a release build",
      disabled: true,
    },
  ],
};

export const filteredMenuInput: TerminalSelectMenuInput = {
  title: "Select command",
  subtitle: "Command palette",
  hint: "Use arrows",
  search: {
    active: true,
    query: "mod",
    matchedCount: 1,
    totalCount: 4,
  },
  items: [
    {
      id: "model",
      label: "/model",
      description: "Switch model",
    },
  ],
};

export const highlightedFilteredMenuInput: TerminalSelectMenuInput = {
  title: "Select command",
  subtitle: "Command palette",
  hint: "Use arrows",
  search: {
    active: true,
    query: "mod",
    matchedCount: 2,
    totalCount: 4,
  },
  items: [
    {
      id: "model",
      label: "/model",
      description: "Switch model",
    },
    {
      id: "model-routes",
      label: "/model routes",
      current: true,
      description: "Inspect model routing",
    },
  ],
};

export const emptyFilteredMenuInput: TerminalSelectMenuInput = {
  title: "Select command",
  subtitle: "Command palette",
  hint: "Use arrows",
  search: {
    active: true,
    query: "zzz",
    matchedCount: 0,
    totalCount: 4,
  },
  items: [],
};

export const modelPickerInput: TerminalSelectMenuInput = {
  title: "Select model",
  subtitle: "Switch the configured model for future sessions; use /model use <id> for custom models.",
  hint: "Enter confirm · Esc exit",
  variant: "model_picker",
  modelPickerMeta: {
    providerName: "alpha",
    currentModel: "model-a",
    startupModel: "model-b",
    totalModelCount: 2,
    sessionId: "session-main",
    sessionTitle: "demo session",
    sessionSummary: "switch between session and startup defaults",
    effortLevel: "high",
    effortSupported: true,
    effortDefaultLevel: "high",
  },
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
      description: "Startup model",
    },
  ],
};

export const filteredModelPickerInput: TerminalSelectMenuInput = {
  ...modelPickerInput,
  search: {
    active: true,
    query: "model-a",
    matchedCount: 1,
    totalCount: 2,
  },
  items: [
    {
      id: "model-a",
      label: "model-a",
      current: true,
      description: "Current active model",
    },
  ],
  viewport: {
    startIndex: 0,
    visibleCount: 1,
    totalCount: 1,
  },
};

export const highlightedFilteredModelPickerInput: TerminalSelectMenuInput = {
  ...modelPickerInput,
  search: {
    active: true,
    query: "model",
    matchedCount: 2,
    totalCount: 2,
  },
  viewport: {
    startIndex: 0,
    visibleCount: 2,
    totalCount: 2,
  },
};

export const askUserMenuInput: TerminalSelectMenuInput = {
  title: "Confirmation needed · Scope · 1/2",
  subtitle: "Choose execution mode · [Scope] Risk Submit",
  hint: "↑/↓ select · 1-2 direct · Enter confirm · Esc back to input",
  variant: "ask_user",
  items: [
    {
      id: "safe",
      label: "safe",
      description: "Run checks before continuing",
    },
    {
      id: "fast",
      label: "fast",
      description: "Skip optional checks",
    },
  ],
};

export const planApprovalMenuInput: TerminalSelectMenuInput = {
  title: "Ready to implement?",
  hint: "↑/↓ select · Enter confirm · Esc back to input",
  variant: "plan_approval",
  planApprovalMeta: {
    agentName: "Grobot",
    editorName: "vim",
    planPath: ".grobot/plans/demo/001-contract-plan.md",
    planContent: [
      "# Contract Plan",
      "",
      "## Goal",
      "",
      "Align the plan mode approval surface with the reference implementation.",
      "",
      "## Validation",
      "",
      "- npm run check:gateway:ts; expected: pass.",
    ].join("\n"),
  },
  items: [
    {
      id: "approve",
      label: "Confirm, implement plan",
    },
    {
      id: "keep_planning",
      label: "Refine plan",
      description: "Shift+Tab approves with feedback",
      input: {
        placeholder: "Tell Grobot what to adjust",
        showLabelWithValue: true,
        labelValueSeparator: ": ",
        resetCursorOnUpdate: true,
      },
    },
  ],
};

export const unsafePlanApprovalMenuInput: TerminalSelectMenuInput = {
  title: "\u001B[31mReady to implement?\u001B[0m\u202E",
  subtitle: "Confirm\u001B[31m hidden\u001B[0m\u202E plan",
  hint: "Enter\u001B[31m confirm\u001B[0m\u202E",
  variant: "plan_approval",
  planApprovalMeta: {
    agentName: "\u001B[31mGrobot\u001B[0m\u202E",
    editorName: "vim\u001B]0;pwnd\u0007",
    planPath: ".grobot/plans/demo/\u001B[31munsafe\u001B[0m\u202E.md",
    planContent: [
      "# \u001B[31mUnsafe\u001B[0m\u202E Plan",
      "Run\u001B[31m checks\u001B[0m\u202E\tbefore continuing",
      "OSC\u001B]0;pwnd\u0007 title",
      "NUL\u0000 marker",
    ].join("\n"),
  },
  items: [
    {
      id: "approve",
      label: "\u001B[31mConfirm\u001B[0m\u202E",
    },
    {
      id: "keep_planning",
      label: "Refine\u001B[31m plan\u001B[0m\u202E",
      description: "Add\u001B[31m feedback\u001B[0m\u202E",
      input: {
        placeholder: "Tell\u001B[31m Grobot\u001B[0m\u202E what to adjust",
        showLabelWithValue: true,
        labelValueSeparator: ": ",
        resetCursorOnUpdate: true,
      },
    },
  ],
};

export const emptyPlanApprovalMenuInput: TerminalSelectMenuInput = {
  title: "Exit plan mode?",
  hint: "Enter confirm · Esc back to input",
  variant: "plan_approval",
  visibleOptionCount: 2,
  planApprovalMeta: {
    agentName: "Grobot",
    editorName: "vim",
    planPath: ".grobot/plans/demo/empty.md",
    planContent: "",
    emptyPlan: true,
  },
  items: [
    {
      id: "approve",
      label: "Yes, exit",
    },
    {
      id: "keep_planning",
      label: "No, keep planning",
    },
  ],
};

export const longModelPickerInput: TerminalSelectMenuInput = {
  title: "Select model",
  subtitle: "Switch the configured model for future sessions; use /model use <id> for custom models.",
  hint: "Enter confirm · Esc exit",
  variant: "model_picker",
  modelPickerMeta: {
    providerName: "alpha",
    currentModel: "very-long-provider-name/gpt-5.4-codex-ultra-preview-with-routing",
    startupModel: "fallback-provider/kimi-k2-2026-04-experimental-context-window",
    effortLevel: "medium",
    effortSupported: false,
  },
  items: [
    {
      id: "very-long-provider-name/gpt-5.4-codex-ultra-preview-with-routing",
      label: "very-long-provider-name/gpt-5.4-codex-ultra-preview-with-routing",
      current: true,
      description: "Provider available with long context notes and routing metadata",
    },
    {
      id: "fallback-provider/kimi-k2-2026-04-experimental-context-window",
      label: "fallback-provider/kimi-k2-2026-04-experimental-context-window",
      description: "Startup fallback model with a long provider detail",
    },
  ],
};

export const longMenuInput: TerminalSelectMenuInput = {
  title: "Select command",
  subtitle: "Long row contract",
  hint: "Use arrows",
  items: [
    {
      id: "long-command",
      label: "/very-long-command-name-that-should-not-break-the-terminal-layout",
      current: true,
      description: "A long command description that should wrap in the right column",
    },
    {
      id: "other-command",
      label: "/another-long-command-name-for-narrow-terminal-rendering",
      description: "Another long command description for layout safety",
    },
  ],
};

export const hideIndexInlineMenuInput: TerminalSelectMenuInput = {
  title: "Select action",
  subtitle: "CustomSelect parity",
  hint: "Use arrows",
  hideIndexes: true,
  inlineDescriptions: true,
  items: [
    {
      id: "apply",
      label: "Apply",
      description: "Run the selected action",
    },
    {
      id: "cancel",
      label: "Cancel",
      description: "Return to input",
    },
  ],
};

export const compactVerticalMenuInput: TerminalSelectMenuInput = {
  title: "Select action",
  subtitle: "Compact vertical layout",
  hint: "Use arrows",
  layout: "compact-vertical",
  items: [
    {
      id: "apply",
      label: "Apply changes",
      description: "Review the plan, then run the implementation path.",
    },
    {
      id: "revise",
      label: "Revise first",
      description: "Keep planning and collect more feedback.",
    },
  ],
};

export const expandedMenuInput: TerminalSelectMenuInput = {
  title: "Select action",
  subtitle: "Expanded layout",
  hint: "Use arrows",
  layout: "expanded",
  items: [
    {
      id: "safe",
      label: "Safe path",
      description: "Run all verification before applying.",
    },
    {
      id: "fast",
      label: "Fast path",
      description: "Skip optional verification.",
    },
  ],
};

export const unsafeDefaultMenuInput: TerminalSelectMenuInput = {
  title: "\u001B[31mSelect command\u001B[0m\u202E",
  subtitle: "Command\u001B[31m palette\u001B[0m\u202E",
  hint: "Use\u001B[31m arrows\u001B[0m\u202E",
  items: [
    {
      id: "unsafe",
      label: "\u001B[31m/unsafe\u001B[0m\u202E",
      description: "Open\u001B[31m hidden\u001B[0m\u202E command",
    },
  ],
};

export const viewportMenuInput: TerminalSelectMenuInput = {
  title: "Select command",
  subtitle: "Viewport contract",
  hint: "Use arrows",
  viewport: {
    startIndex: 7,
    visibleCount: 4,
    totalCount: 12,
  },
  items: [
    {
      id: "cmd-8",
      label: "/context",
      description: "Show context",
    },
    {
      id: "cmd-9",
      label: "/model",
      description: "Switch model",
    },
    {
      id: "cmd-10",
      label: "/status",
      description: "Show status",
    },
    {
      id: "cmd-11",
      label: "/commands",
      description: "Browse commands",
    },
  ],
};

export const directLargeMenuInput: TerminalSelectMenuInput = {
  title: "Select command",
  subtitle: "Direct renderer visible count",
  hint: "Use arrows",
  items: Array.from({ length: 8 }, (_, index) => ({
    id: `cmd-${String(index + 1)}`,
    label: `/cmd-${String(index + 1)}`,
    description: `Command ${String(index + 1)}`,
  })),
};

export const directLargeModelPickerInput: TerminalSelectMenuInput = {
  title: "Select model",
  subtitle: "Switch the configured model for future sessions; use /model use <id> for custom models.",
  hint: "Enter confirm · Esc exit",
  variant: "model_picker",
  modelPickerMeta: {
    providerName: "alpha",
    currentModel: "model-1",
    totalModelCount: 12,
    effortLevel: "high",
    effortSupported: true,
    effortDefaultLevel: "medium",
  },
  items: Array.from({ length: 12 }, (_, index) => ({
    id: `model-${String(index + 1)}`,
    label: `model-${String(index + 1)}`,
    current: index === 0,
    description: `Model ${String(index + 1)}`,
  })),
};
