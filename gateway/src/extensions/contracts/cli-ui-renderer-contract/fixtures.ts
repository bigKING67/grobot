import { type TerminalSelectMenuInput } from "../../../cli/tui/components/select-menu/contract";
import { type StartScreenViewModel } from "../../../cli/tui/screens/startup-screen";

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

export const modelPickerInput: TerminalSelectMenuInput = {
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

export const askUserMenuInput: TerminalSelectMenuInput = {
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

export const planApprovalMenuInput: TerminalSelectMenuInput = {
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

export const emptyPlanApprovalMenuInput: TerminalSelectMenuInput = {
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

export const longModelPickerInput: TerminalSelectMenuInput = {
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

export const viewportMenuInput: TerminalSelectMenuInput = {
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
