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

function renderSelectAtColumns(
  renderer: ReturnType<typeof createCliUiRenderer>,
  menu: TerminalSelectMenuInput,
  activeIndex: number,
  columns: number,
): string {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  try {
    Object.defineProperty(process.stdout, "columns", {
      value: columns,
      configurable: true,
    });
    return renderer.renderSelectMenu(menu, activeIndex);
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, "columns", descriptor);
    }
  }
}

function renderedLinesWithinColumns(rendered: string, columns: number): boolean {
  return stripAnsi(rendered)
    .split("\n")
    .every((line) => measureDisplayWidth(line) <= columns);
}

function renderedMenuRows(rendered: string): string[] {
  return stripAnsi(rendered)
    .split("\n")
    .filter((line) => /^(?:[›❯]\s*)?\d+\./.test(line.trimStart()));
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
      title: "开始使用",
      lines: [
        "运行 /init 创建 AGENTS.md 指令文件",
      ],
      footer: "Use /help to list all commands",
    },
    {
      title: "最近活动",
      lines: [
        "2h ago  Session planning update",
      ],
      emptyMessage: "暂无最近活动",
      footer: "/sessions 查看更多",
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

const startupBrandSymbolViewModel: StartScreenViewModel = {
  title: "Grobot 0.10.0 developed by 67",
  titleSegments: [
    {
      text: "Grobot",
      token: "brand",
    },
    {
      text: " 0.10.0 developed by 67",
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
      title: "开始使用",
      lines: [
        "运行 /init 创建 AGENTS.md 指令文件",
      ],
    },
    {
      title: "最近活动",
      lines: [
        "[store] history migrated from legacy path (/tmp/demo.history.json)",
      ],
      emptyMessage: "暂无最近活动",
      footer: "/sessions 查看更多",
    },
  ],
  rows: [
    "claude-sonnet-4-5 (200K context) · API Usage Billing",
    "~/tmp/project",
  ],
  commandHint: "",
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

const modelPickerInput: TerminalSelectMenuInput = {
  title: "选择模型",
  subtitle: "切换当前会话模型；历史/自定义模型可用 /model use <id>。",
  hint: "Enter 确认 · Esc 返回",
  variant: "model_picker",
  modelPickerMeta: {
    providerName: "alpha",
    currentModel: "model-a",
    startupModel: "model-b",
    totalModelCount: 2,
    sessionId: "session-main",
    sessionTitle: "demo session",
    sessionSummary: "switch between session and startup defaults",
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

const askUserMenuInput: TerminalSelectMenuInput = {
  title: "需要确认 · Scope · 1/2",
  subtitle: "Choose execution mode · [Scope] Risk 提交",
  hint: "↑/↓ 选择 · 1-2 直选 · Enter 确认 · Esc 返回输入框",
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

const planApprovalMenuInput: TerminalSelectMenuInput = {
  title: "准备开始实现？",
  hint: "↑/↓ 选择 · Enter 确认 · Esc 返回输入框",
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
      "把 plan mode approval surface 对齐参考实现。",
      "",
      "## Validation",
      "",
      "- npm run check:gateway:ts；预期通过。",
    ].join("\n"),
  },
  items: [
    {
      id: "approve",
      label: "确认，开始实现计划",
    },
    {
      id: "keep_planning",
      label: "继续完善计划",
      description: "Shift+Tab 可带反馈批准执行",
      input: {
        placeholder: "告诉 Grobot 需要调整什么",
        showLabelWithValue: true,
        labelValueSeparator: ": ",
        resetCursorOnUpdate: true,
      },
    },
  ],
};

const emptyPlanApprovalMenuInput: TerminalSelectMenuInput = {
  title: "退出 plan mode?",
  hint: "Enter 确认 · Esc 返回输入框",
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
      label: "是，退出",
    },
    {
      id: "keep_planning",
      label: "否，继续规划",
    },
  ],
};

const longModelPickerInput: TerminalSelectMenuInput = {
  title: "选择模型",
  subtitle: "切换当前会话模型；历史/自定义模型可用 /model use <id>。",
  hint: "Enter 确认 · Esc 返回",
  variant: "model_picker",
  modelPickerMeta: {
    providerName: "alpha",
    currentModel: "very-long-provider-name/gpt-5.4-codex-ultra-preview-with-routing",
    startupModel: "fallback-provider/kimi-k2-2026-04-experimental-context-window",
  },
  items: [
    {
      id: "very-long-provider-name/gpt-5.4-codex-ultra-preview-with-routing",
      label: "very-long-provider-name/gpt-5.4-codex-ultra-preview-with-routing",
      current: true,
      description: "Provider 可用，包含较长上下文说明和路由元数据",
    },
    {
      id: "fallback-provider/kimi-k2-2026-04-experimental-context-window",
      label: "fallback-provider/kimi-k2-2026-04-experimental-context-window",
      description: "Startup fallback model with a long provider detail",
    },
  ],
};

const longMenuInput: TerminalSelectMenuInput = {
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

const hideIndexInlineMenuInput: TerminalSelectMenuInput = {
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

const compactVerticalMenuInput: TerminalSelectMenuInput = {
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

const expandedMenuInput: TerminalSelectMenuInput = {
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

const viewportMenuInput: TerminalSelectMenuInput = {
  title: "选择命令",
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
      description: "查看上下文",
    },
    {
      id: "cmd-9",
      label: "/model",
      description: "切换模型",
    },
    {
      id: "cmd-10",
      label: "/status",
      description: "打开状态",
    },
    {
      id: "cmd-11",
      label: "/commands",
      description: "Browse commands",
    },
  ],
};

const directLargeMenuInput: TerminalSelectMenuInput = {
  title: "Select command",
  subtitle: "Direct renderer visible count",
  hint: "Use arrows",
  items: Array.from({ length: 8 }, (_, index) => ({
    id: `cmd-${String(index + 1)}`,
    label: `/cmd-${String(index + 1)}`,
    description: `Command ${String(index + 1)}`,
  })),
};

const directLargeModelPickerInput: TerminalSelectMenuInput = {
  title: "选择模型",
  subtitle: "切换当前会话模型；历史/自定义模型可用 /model use <id>。",
  hint: "Enter 确认 · Esc 返回",
  variant: "model_picker",
  modelPickerMeta: {
    providerName: "alpha",
    currentModel: "model-1",
  },
  items: Array.from({ length: 12 }, (_, index) => ({
    id: `model-${String(index + 1)}`,
    label: `model-${String(index + 1)}`,
    current: index === 0,
    description: `Model ${String(index + 1)}`,
  })),
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
const startupBrandSymbolInteractive = startupBrandSymbolVariants[1] ?? "";
const startupBrandSymbolBodies = startupBrandSymbolVariants.map((rendered) =>
  extractStartupBodyLines(rendered)
);
const startupBrandSymbolBodyLengthConsistent = startupBrandSymbolBodies.every((lines) => {
  if (lines.length === 0) {
    return false;
  }
  const lengths = lines.map((line) => measureDisplayWidth(line));
  return new Set(lengths).size === 1;
});
const startupBrandSymbolHasClaudeLikeHeight = startupBrandSymbolBodies.every((lines) =>
  lines.length >= 8
);
const startupRegisteredSymbolSingleWidth = measureDisplayWidth("®") === 1;
const menuInteractive = interactiveRenderer.renderSelectMenu(menuInput, 0);
const menuPlain = plainRenderer.renderSelectMenu(menuInput, 0);
const menuNonTty = nonTtyRenderer.renderSelectMenu(menuInput, 0);
const modelPickerInteractive = interactiveRenderer.renderSelectMenu(modelPickerInput, 0);
const modelPickerPlain = plainRenderer.renderSelectMenu(modelPickerInput, 0);
const askUserMenuInteractive = interactiveRenderer.renderSelectMenu(askUserMenuInput, 0);
const askUserMenuPlain = plainRenderer.renderSelectMenu(askUserMenuInput, 0);
const planApprovalMenuInteractive = interactiveRenderer.renderSelectMenu(planApprovalMenuInput, 0);
const planApprovalMenuPlain = plainRenderer.renderSelectMenu(planApprovalMenuInput, 0);
const planApprovalKeepPlanningPlain = plainRenderer.renderSelectMenu(planApprovalMenuInput, 1);
const emptyPlanApprovalPlain = plainRenderer.renderSelectMenu(emptyPlanApprovalMenuInput, 0);
const emptyPlanApprovalPlainText = stripAnsi(emptyPlanApprovalPlain);
const planApprovalDraftFeedbackPlain = plainRenderer.renderSelectMenu({
  ...planApprovalMenuInput,
  items: planApprovalMenuInput.items.map((item) =>
    item.id === "keep_planning"
      ? {
        ...item,
        input: {
          ...(item.input ?? {}),
          initialValue: "tighten validation",
        },
      }
      : item
  ),
}, 1);
const planApprovalEditedPlain = plainRenderer.renderSelectMenu({
  ...planApprovalMenuInput,
  planApprovalMeta: {
    ...(planApprovalMenuInput.planApprovalMeta ?? {
      planContent: "",
    }),
    planEdited: true,
  },
}, 0);
const planApprovalMenuPlainText = stripAnsi(planApprovalMenuPlain);
const planApprovalMenuPlainLines = planApprovalMenuPlainText.split("\n");
const planApprovalDividerRows = planApprovalMenuPlainLines.filter((line) =>
  /^┄+$/.test(line.trim())
);
const viewportMenuPlain = plainRenderer.renderSelectMenu(viewportMenuInput, 1);
const directLargeMenuPlain = plainRenderer.renderSelectMenu(directLargeMenuInput, 0);
const directLargeModelPickerPlain = plainRenderer.renderSelectMenu(directLargeModelPickerInput, 0);
const longModelPickerPlain = renderSelectAtColumns(plainRenderer, longModelPickerInput, 0, 72);
const narrowModelPickerPlain = renderSelectAtColumns(plainRenderer, longModelPickerInput, 0, 52);
const longMenuPlain = renderSelectAtColumns(plainRenderer, longMenuInput, 0, 72);
const hideIndexInlineMenuPlain = plainRenderer.renderSelectMenu(hideIndexInlineMenuInput, 0);
const compactVerticalMenuPlain = plainRenderer.renderSelectMenu(compactVerticalMenuInput, 0);
const expandedMenuPlain = plainRenderer.renderSelectMenu(expandedMenuInput, 0);

const payload = {
  interactive_mode: interactiveRenderer.mode,
  plain_mode: plainRenderer.mode,
  non_tty_mode: nonTtyRenderer.mode,
  startup_has_title: startupInteractive.includes("Grobot v0.1.0"),
  startup_has_brand_label: startupInteractive.includes("Grobot"),
  startup_has_logo_headline: startupInteractive.includes("Grobot CLI v0.1.0"),
  startup_has_logo_runtime_line: startupInteractive.includes("alpha/model · 200k ctx budget · API Usage"),
  startup_has_session_line: startupInteractive.includes("session_id:session-main"),
  startup_has_no_command_hint:
    !startupInteractive.includes("Enter message")
    && !startupInteractive.includes("/ for commands")
    && !startupInteractive.includes("? for shortcuts"),
  startup_has_tips_title: startupInteractive.includes("开始使用"),
  startup_has_recent_activity_title: startupInteractive.includes("最近活动"),
  startup_has_recent_activity_empty_or_items:
    startupInteractive.includes("暂无最近活动")
    || startupInteractive.includes("2h ago  Session planning update"),
  startup_has_developed_by_67:
    stripAnsi(startupBrandSymbolInteractive).includes("Grobot 0.10.0 developed by 67"),
  startup_has_no_dev_label:
    !/\bdev\b/i.test(stripAnsi(startupBrandSymbolInteractive)),
  startup_interactive_title_has_brand_color:
    startupBrandSymbolInteractive.includes("\x1b[38;2;202;124;94mGrobot\x1b[0m"),
  startup_interactive_title_has_muted_version_color:
    startupBrandSymbolInteractive.includes("\x1b[90m 0.10.0 developed by 67\x1b[0m"),
  startup_feed_title_uses_brand_color:
    startupBrandSymbolInteractive.includes("\x1b[38;2;202;124;94m开始使用"),
  startup_feed_title_avoids_accent_color:
    !startupBrandSymbolInteractive.includes("\x1b[92m开始使用"),
  startup_feed_footer_uses_muted_color:
    startupBrandSymbolInteractive.includes("\x1b[90m/sessions 查看更多"),
  startup_feed_footer_avoids_info_color:
    !startupBrandSymbolInteractive.includes("\x1b[96m/sessions 查看更多"),
  startup_has_no_join_artifact: startupNoJoinArtifact,
  startup_has_no_tee_glyph: startupNoTeeGlyph,
  startup_body_width_consistent: startupBodyWidthConsistent,
  startup_feed_divider_count_expected: startupDividerCountExpected,
  startup_brand_symbol_body_length_consistent: startupBrandSymbolBodyLengthConsistent,
  startup_brand_symbol_has_claude_like_height: startupBrandSymbolHasClaudeLikeHeight,
  startup_registered_symbol_single_width: startupRegisteredSymbolSingleWidth,
  menu_interactive_has_ansi: hasAnsi(menuInteractive),
  menu_plain_has_ansi: hasAnsi(menuPlain),
  menu_non_tty_has_ansi: hasAnsi(menuNonTty),
  menu_plain_has_pointer: menuPlain.includes("❯"),
  menu_plain_has_no_thin_pointer: !menuPlain.includes("›"),
  menu_interactive_has_current_check: menuInteractive.includes("✓"),
  menu_plain_has_secondary_description: menuPlain.includes("Current active model"),
  menu_hint_is_compact: menuPlain.includes("·"),
  menu_hint_has_escape_back: menuPlain.includes("Esc 返回"),
  menu_hint_has_enter_action: menuPlain.includes("Enter 确认"),
  menu_hint_has_navigation_hint: menuPlain.includes("↑/↓ 选择"),
  menu_hint_omits_secondary_key_chords:
    !menuPlain.includes("j/k")
    && !menuPlain.includes("Ctrl+n/p")
    && !menuPlain.includes("1-9 jump")
    && !menuPlain.includes("Enter/Space"),
  menu_viewport_has_full_ordinal:
    stripAnsi(viewportMenuPlain).includes("8.")
    && stripAnsi(viewportMenuPlain).includes("9.")
    && stripAnsi(viewportMenuPlain).includes("10."),
  menu_viewport_hides_reset_ordinal:
    !stripAnsi(viewportMenuPlain).includes("1. /context"),
  menu_viewport_has_no_row_scroll_arrows:
    renderedMenuRows(viewportMenuPlain).every((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("↑") && !trimmed.startsWith("↓");
    }),
  menu_viewport_has_no_more_text:
    !stripAnsi(viewportMenuPlain).toLowerCase().includes("more"),
  menu_direct_render_uses_default_visible_count:
    stripAnsi(directLargeMenuPlain).includes("5.")
    && !stripAnsi(directLargeMenuPlain).includes("6."),
  menu_direct_render_has_no_row_scroll_marker:
    renderedMenuRows(directLargeMenuPlain).every((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("↑") && !trimmed.startsWith("↓");
    }),
  model_picker_has_claude_pointer: stripAnsi(modelPickerPlain).includes("❯"),
  model_picker_has_no_thin_pointer: !stripAnsi(modelPickerPlain).includes("›"),
  model_picker_has_pane_divider: /^─+$/.test(stripAnsi(modelPickerPlain).split("\n")[0] ?? ""),
  model_picker_interactive_uses_warm_brand_color:
    modelPickerInteractive.includes("\x1b[38;2;202;124;94m")
    && !modelPickerInteractive.includes("\x1b[38;2;166;170;255m"),
  model_picker_has_decimal_index: stripAnsi(modelPickerPlain).includes("1."),
  model_picker_has_no_bracket_index: !stripAnsi(modelPickerPlain).includes("[1]"),
  model_picker_current_uses_check: stripAnsi(modelPickerPlain).includes("model-a ✓"),
  model_picker_current_not_parenthesized: !stripAnsi(modelPickerPlain).includes("(current)"),
  model_picker_has_default_suffix: stripAnsi(modelPickerPlain).includes("model-b (default)"),
  model_picker_has_footer_hint: stripAnsi(modelPickerPlain).includes("Enter 确认 · Esc 返回"),
  model_picker_has_no_provider_card: !stripAnsi(modelPickerPlain).includes("Provider"),
  model_picker_has_no_startup_badge: !stripAnsi(modelPickerPlain).includes("STARTUP"),
  model_picker_has_no_current_badge: !stripAnsi(modelPickerPlain).includes("CURRENT"),
  model_picker_has_no_reset_badge: !stripAnsi(modelPickerPlain).includes("RESET"),
  model_picker_has_no_frame: !stripAnsi(modelPickerPlain).includes("╭"),
  model_picker_interactive_has_no_current_badge: !modelPickerInteractive.includes("CURRENT"),
  ask_user_menu_uses_panel_divider: /^─+$/.test(stripAnsi(askUserMenuPlain).split("\n")[0] ?? ""),
  ask_user_menu_uses_warm_brand_color:
    askUserMenuInteractive.includes("\x1b[38;2;202;124;94m"),
  ask_user_menu_has_progress_title:
    stripAnsi(askUserMenuPlain).includes("需要确认 · Scope · 1/2"),
  ask_user_menu_has_input_return_hint:
    stripAnsi(askUserMenuPlain).includes("Esc 返回输入框"),
  ask_user_menu_preserves_option_descriptions:
    stripAnsi(askUserMenuPlain).includes("Run checks before continuing"),
  ask_user_menu_uses_claude_pointer:
    stripAnsi(askUserMenuPlain).includes("❯"),
  plan_approval_menu_has_ready_title:
    planApprovalMenuPlainText.includes("准备开始实现？"),
  plan_approval_menu_has_planning_path_header:
    planApprovalMenuPlainText.includes("计划文件: .grobot/plans/demo/001-contract-plan.md")
    && planApprovalMenuPlainText.indexOf("计划文件: .grobot/plans/demo/001-contract-plan.md")
      < planApprovalMenuPlainText.indexOf("准备开始实现？"),
  plan_approval_menu_title_is_not_plan_color_flooded:
    !planApprovalMenuInteractive.includes("\x1b[38;2;72;150;140m\x1b[1m准备开始实现？"),
  plan_approval_menu_has_subtitle:
    planApprovalMenuPlainText.includes("执行前请确认计划。"),
  plan_approval_menu_embeds_plan_markdown:
    planApprovalMenuPlainText.includes("# Contract Plan")
    && planApprovalMenuPlainText.includes("## Validation"),
  plan_approval_menu_separates_plan_actions_and_footer:
    planApprovalDividerRows.length >= 2,
  plan_approval_menu_has_reference_prompt:
    planApprovalMenuPlainText.includes("是否开始执行？"),
  plan_approval_menu_uses_sticky_footer_order:
    planApprovalMenuPlainText.indexOf("是否开始执行？")
      > planApprovalMenuPlainText.indexOf("## Validation")
    && planApprovalMenuPlainText.indexOf("Ctrl-G 编辑计划")
      > planApprovalMenuPlainText.indexOf("继续完善计划"),
  plan_approval_menu_has_yes_no_options:
    planApprovalMenuPlainText.includes("❯ 确认，开始实现计划")
    && planApprovalMenuPlainText.includes("继续完善计划"),
  plan_approval_menu_has_ctrl_g_edit_hint:
    planApprovalMenuPlainText.includes("Ctrl-G 编辑计划 · vim")
    && planApprovalMenuPlainText.includes(".grobot/plans/demo/001-contract-plan.md"),
  plan_approval_menu_shows_saved_after_external_edit:
    stripAnsi(planApprovalEditedPlain).includes("✓ 计划已保存"),
  plan_approval_menu_shows_keep_planning_feedback_hint:
    stripAnsi(planApprovalKeepPlanningPlain).includes("Shift+Tab 可带反馈批准执行"),
  plan_approval_menu_shows_inline_feedback_input:
    stripAnsi(planApprovalKeepPlanningPlain).includes("继续完善计划: 告诉 Grobot 需要调整什么"),
  plan_approval_menu_shows_inline_feedback_cursor:
    stripAnsi(planApprovalKeepPlanningPlain).includes("告诉 Grobot 需要调整什么▌"),
  plan_approval_menu_preserves_feedback_after_reopen:
    stripAnsi(planApprovalDraftFeedbackPlain).includes("继续完善计划: tighten validation▌"),
  plan_approval_menu_uses_plan_mode_color:
    planApprovalMenuInteractive.includes("\x1b[38;2;72;150;140m"),
  plan_approval_menu_has_no_default_thin_pointer:
    !planApprovalMenuPlainText.includes("›"),
  plan_approval_empty_uses_exit_title:
    emptyPlanApprovalPlainText.includes("退出 plan mode?"),
  plan_approval_empty_uses_reference_copy:
    emptyPlanApprovalPlainText.includes("Grobot 将退出 plan mode"),
  plan_approval_empty_has_yes_no_only:
    emptyPlanApprovalPlainText.includes("❯ 是，退出")
    && emptyPlanApprovalPlainText.includes("  否，继续规划")
    && !emptyPlanApprovalPlainText.includes("Implement the plan")
    && !emptyPlanApprovalPlainText.includes("确认，开始实现计划"),
  plan_approval_empty_omits_plan_markdown:
    !emptyPlanApprovalPlainText.includes("Grobot 的计划：")
    && !emptyPlanApprovalPlainText.includes("未找到计划。")
    && !emptyPlanApprovalPlainText.includes("是否开始执行？")
    && !emptyPlanApprovalPlainText.includes("ctrl-g to edit"),
  model_picker_direct_render_uses_model_visible_count:
    stripAnsi(directLargeModelPickerPlain).includes("10.")
    && !stripAnsi(directLargeModelPickerPlain).includes("11."),
  model_picker_direct_render_shows_hidden_count:
    stripAnsi(directLargeModelPickerPlain).includes("and 2 more…"),
  model_picker_direct_render_has_no_row_scroll_marker:
    renderedMenuRows(directLargeModelPickerPlain).every((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("↑") && !trimmed.startsWith("↓");
    }),
  model_picker_long_rows_within_width:
    renderedLinesWithinColumns(longModelPickerPlain, 72),
  model_picker_long_descriptions_do_not_wrap:
    stripAnsi(longModelPickerPlain)
      .split("\n")
      .filter((line) => line.trim().length > 0).length <= 6,
  model_picker_long_current_suffix_preserved:
    stripAnsi(longModelPickerPlain).includes("✓"),
  model_picker_long_default_suffix_preserved:
    stripAnsi(longModelPickerPlain).includes("(default)"),
  model_picker_narrow_rows_within_width:
    renderedLinesWithinColumns(narrowModelPickerPlain, 52),
  model_picker_narrow_hides_description:
    !stripAnsi(narrowModelPickerPlain).includes("Provider 可用"),
  menu_long_rows_within_width:
    renderedLinesWithinColumns(longMenuPlain, 72),
  menu_long_current_suffix_preserved:
    stripAnsi(longMenuPlain).includes("✓"),
  menu_hide_indexes_omits_numeric_indexes:
    !/\b1\.\s+Apply\b/.test(stripAnsi(hideIndexInlineMenuPlain))
    && !/\b2\.\s+Cancel\b/.test(stripAnsi(hideIndexInlineMenuPlain)),
  menu_hide_indexes_keeps_pointer:
    stripAnsi(hideIndexInlineMenuPlain).includes("❯ Apply Run the selected action"),
  menu_inline_descriptions_render_same_row:
    stripAnsi(hideIndexInlineMenuPlain).includes("Apply Run the selected action"),
  menu_compact_vertical_renders_description_below_label:
    stripAnsi(compactVerticalMenuPlain).includes("❯ 1. Apply changes\n     Review the plan"),
  menu_expanded_adds_blank_line_between_options:
    stripAnsi(expandedMenuPlain).includes("Run all verification before applying.\n\n  Fast path"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
