import {
  decodeMenuInput,
  decodeAskUserPanelInput,
  hasMenuDigitsContinuation,
  isPlanApprovalInlineFeedbackApproveShortcut,
  isHistorySearchShortcut,
  resolveCoalescedSubmitChunk,
  resolveDraftAwareFooterLines,
  resolveFirstMenuPrefixMatchIndex,
  resolveSessionInputFooterLines,
  resolveInputShortcutAction,
  resolveInteractiveInputBodyWidth,
  renderInteractiveInputChromeLines,
  renderSubmittedInputTranscriptLines,
  reduceTerminalSelectMenuInlineInput,
  resolveInteractiveEnterDataAction,
  resolveInteractiveInputCursorColumn,
  resolveMenuSearchMatchedIndices,
  resolveMenuIndexFromDigits,
  resolveSlashSuggestionApplyResult,
  resolveSlashInputHighlightSuggestions,
  resolveSlashSuggestionKeyAction,
  resolveShortcutOverlayKeyAction,
  resolveTerminalSelectMenuViewport,
  shouldEnableTerminalSelectMenuNumericSelection,
  shouldHighlightSlashInputToken,
  resolveSubmitKeyAction,
} from "../../orchestration/entrypoints/dev-cli/start/run-start-io";
import { formatSlashSuggestionPanel } from "../../orchestration/entrypoints/dev-cli/ui/interactive/slash-overlay";
import { measureDisplayWidth } from "../../orchestration/entrypoints/dev-cli/ui/interactive/display-width";
import {
  formatPromptSuggestionPanel,
  resolveVisibleSuggestionWindow,
  truncateDisplayWidthMiddle,
} from "../../orchestration/entrypoints/dev-cli/ui/interactive/suggestion-window";
import {
  normalizeSelectNavigationState,
  reduceSelectNavigation,
} from "../../orchestration/entrypoints/dev-cli/ui/interactive/select-navigation";
import {
  resolvePromptSlotState,
} from "../../orchestration/entrypoints/dev-cli/ui/interactive/prompt-slot-state";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

async function main(): Promise<void> {
  const menuItemsLength = 12;
  const enterAction = decodeMenuInput("\r", menuItemsLength);
  const lfEnterAction = decodeMenuInput("\n", menuItemsLength);
  const crlfEnterAction = decodeMenuInput("\r\n", menuItemsLength);
  const spaceAction = decodeMenuInput(" ", menuItemsLength);
  const ctrlPAction = decodeMenuInput("\u0010", menuItemsLength);
  const ctrlNAction = decodeMenuInput("\u000e", menuItemsLength);
  const ctrlGAction = decodeMenuInput("\u0007", menuItemsLength);
  const escapeAction = decodeMenuInput("\u001b", menuItemsLength);
  const arrowUpAction = decodeMenuInput("\u001b[A", menuItemsLength);
  const arrowDownAction = decodeMenuInput("\u001b[B", menuItemsLength);
  const pageUpAction = decodeMenuInput("\u001b[5~", menuItemsLength);
  const pageDownAction = decodeMenuInput("\u001b[6~", menuItemsLength);
  const directIndexAction = decodeMenuInput("12", menuItemsLength);
  const directIndexCrlfAction = decodeMenuInput("2\r\n", menuItemsLength);
  const menuSearchMatches = resolveMenuSearchMatchedIndices("legacy session", [
    {
      id: "main",
      label: "Main Session",
      description: "current context",
      current: true,
    },
    {
      id: "session_legacy",
      label: "Legacy-Session",
      description: "historical context",
    },
    {
      id: "archive",
      label: "Archive",
      description: "created 2026-04-24",
    },
  ]);
  const menuSearchDigitMatches = resolveMenuSearchMatchedIndices("20260424", [
    {
      id: "main",
      label: "Main Session",
      description: "current context",
      current: true,
    },
    {
      id: "session_legacy",
      label: "Legacy-Session",
      description: "historical context",
    },
    {
      id: "archive",
      label: "Archive",
      description: "created 2026-04-24",
    },
  ]);
  const menuSearchEmptyMatches = resolveMenuSearchMatchedIndices("", [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ]);

  const slashMenu = resolveSlashSuggestionApplyResult("/model");
  const slashCommandsMenu = resolveSlashSuggestionApplyResult("/commands");
  const slashPlanMenu = resolveSlashSuggestionApplyResult("/plan");
  const slashSkillCreatorMenu = resolveSlashSuggestionApplyResult("/skill-creator");
  const slashOverlayPartial = formatSlashSuggestionPanel(
    [{ command: "/exit", description: "退出交互模式" }],
    "/e",
    0,
    96,
  );
  const slashOverlayExact = formatSlashSuggestionPanel(
    [{ command: "/exit", description: "退出交互模式" }],
    "/exit",
    0,
    96,
  );
  const slashOverlayScrolled = formatSlashSuggestionPanel(
    [
      { command: "/sessions", description: "打开会话选择器" },
      { command: "/resume", description: "Resume a previous session" },
      { command: "/rewind", description: "Rewind to a checkpoint" },
      { command: "/commands", description: "Browse command menu" },
      { command: "/skill-creator", description: "Create a skill" },
      { command: "/init", description: "Initialize project instructions" },
      { command: "/context", description: "Inspect context state" },
      { command: "/memory", description: "Open memory tools" },
      { command: "/model", description: "Switch model" },
      { command: "/help", description: "Show help" },
    ],
    "/",
    8,
    96,
  );
  const slashOverlayScrolledLines = slashOverlayScrolled
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayScrolledModelLine =
    slashOverlayScrolledLines.find((line) => line.includes("/model")) ?? "";
  const slashOverlayScrolledSessionsLine =
    slashOverlayScrolledLines.find((line) => line.includes("/sessions")) ?? "";
  const slashOverlayScrolledFirstLinePlain = stripAnsi(slashOverlayScrolledLines[0] ?? "");
  const slashOverlayDownMarker = formatSlashSuggestionPanel(
    [
      { command: "/one", description: "one" },
      { command: "/two", description: "two" },
      { command: "/three", description: "three" },
      { command: "/four", description: "four" },
      { command: "/five", description: "five" },
      { command: "/six", description: "six" },
      { command: "/seven", description: "seven" },
      { command: "/eight", description: "eight" },
      { command: "/nine", description: "nine" },
      { command: "/ten", description: "ten" },
    ],
    "/",
    1,
    96,
  );
  const slashOverlayDownMarkerLines = slashOverlayDownMarker
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayDownMarkerLastLinePlain =
    stripAnsi(slashOverlayDownMarkerLines[slashOverlayDownMarkerLines.length - 1] ?? "");
  const slashOverlayNarrow = formatSlashSuggestionPanel(
    [
      { command: "/model", description: "打开模型选择器" },
      { command: "/commands", description: "管理用户自定义 slash commands" },
    ],
    "/",
    0,
    52,
  );
  const slashOverlayNarrowLines = slashOverlayNarrow
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayCentered = formatSlashSuggestionPanel(
    [
      { command: "/one", description: "one" },
      { command: "/two", description: "two" },
      { command: "/three", description: "three" },
      { command: "/four", description: "four" },
      { command: "/five", description: "five" },
      { command: "/six", description: "six" },
      { command: "/seven", description: "seven" },
      { command: "/eight", description: "eight" },
      { command: "/nine", description: "nine" },
      { command: "/ten", description: "ten" },
      { command: "/eleven", description: "eleven" },
      { command: "/twelve", description: "twelve" },
    ],
    "/",
    6,
    96,
  );
  const slashOverlayCenteredLines = slashOverlayCentered
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayCenteredSelectedRow = slashOverlayCenteredLines.findIndex((line) =>
    line.includes("/seven"),
  );
  const genericSuggestionWindow = resolveVisibleSuggestionWindow({
    items: ["/one", "/two", "/three", "/four", "/five", "/six", "/seven"],
    selectedIndex: 5,
    visibleCount: 3,
  });
  const promptSuggestionOverlay = formatPromptSuggestionPanel({
    suggestions: [
      { id: "cmd-one", displayText: "/one", description: "one" },
      { id: "cmd-two", displayText: "/two", description: "two" },
      { id: "cmd-three", displayText: "/three", description: "three" },
      { id: "cmd-four", displayText: "/four", description: "four" },
      { id: "cmd-five", displayText: "/five", description: "five" },
      { id: "cmd-six", displayText: "/six", description: "six" },
      { id: "cmd-seven", displayText: "/seven", description: "seven" },
    ],
    selectedIndex: 5,
    terminalColumns: 80,
    terminalRows: 24,
    overlay: true,
  });
  const promptSuggestionOverlayLines = promptSuggestionOverlay
    .split("\n")
    .filter((line) => line.length > 0);
  const promptSuggestionOverlaySelectedRow = promptSuggestionOverlayLines.findIndex((line) =>
    line.includes("/six"),
  );
  const promptSuggestionInline = formatPromptSuggestionPanel({
    suggestions: [
      { id: "cmd-one", displayText: "/one", description: "one" },
      { id: "cmd-two", displayText: "/two", description: "two" },
      { id: "cmd-three", displayText: "/three", description: "three" },
      { id: "cmd-four", displayText: "/four", description: "four" },
      { id: "cmd-five", displayText: "/five", description: "five" },
      { id: "cmd-six", displayText: "/six", description: "six" },
    ],
    selectedIndex: 4,
    terminalColumns: 80,
    terminalRows: 6,
    overlay: false,
  });
  const promptSuggestionInlineLines = promptSuggestionInline
    .split("\n")
    .filter((line) => line.length > 0);
  const promptSuggestionFile = formatPromptSuggestionPanel({
    suggestions: [{
      id: "file-gateway/src/orchestration/entrypoints/dev-cli/ui/interactive/suggestion-window.ts",
      displayText: "gateway/src/orchestration/entrypoints/dev-cli/ui/interactive/suggestion-window.ts",
      description: "TypeScript source file",
      type: "file",
    }],
    selectedIndex: 0,
    terminalColumns: 72,
    overlay: true,
  });
  const promptSuggestionFilePlain = stripAnsi(promptSuggestionFile);
  const promptSuggestionIcons = formatPromptSuggestionPanel({
    suggestions: [
      {
        id: "mcp-resource-project-docs",
        displayText: "project://docs/architecture",
        description: "MCP resource",
        type: "mcp-resource",
      },
      {
        id: "agent-frontend-worker",
        displayText: "frontend_worker",
        description: "Worker agent",
        type: "agent",
      },
    ],
    selectedIndex: 1,
    terminalColumns: 72,
    overlay: true,
  });
  const promptSuggestionTagged = formatPromptSuggestionPanel({
    suggestions: [{
      id: "command-user-weekly",
      displayText: "/weekly-report",
      tag: "user",
      description: "Create\nweekly\toperator summary",
      type: "command",
    }],
    selectedIndex: 0,
    terminalColumns: 96,
    overlay: true,
  });
  const promptSuggestionTaggedPlain = stripAnsi(promptSuggestionTagged);
  const promptSuggestionPointer = formatPromptSuggestionPanel({
    suggestions: [
      { id: "command-model", displayText: "/model", description: "Switch model", type: "command" },
      { id: "command-plan", displayText: "/plan", description: "进入 plan mode", type: "command" },
    ],
    selectedIndex: 1,
    terminalColumns: 64,
    overlay: true,
    showSelectionPointer: true,
  });
  const promptSuggestionPointerPlain = stripAnsi(promptSuggestionPointer);
  const promptSuggestionMiddleTruncate = truncateDisplayWidthMiddle(
    "gateway/src/orchestration/entrypoints/dev-cli/ui/interactive/suggestion-window.ts",
    32,
  );
  const slashOverlayWithArgs = formatSlashSuggestionPanel(
    [{ command: "/plan", description: "进入 plan mode" }],
    "/plan 帮我写一份抖音直播规划",
    0,
    96,
  );
  const slashInputPartialHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/e",
    suggestions: [{ command: "/exit", description: "退出交互模式" }],
  });
  const slashInputExactHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/exit",
    suggestions: [{ command: "/exit", description: "退出交互模式" }],
  });
  const slashInputWithArgsHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/plan 帮我写一份抖音直播规划",
    suggestions: [{ command: "/plan", description: "进入 plan mode" }],
  });
  const slashInputWithArgsFallbackSuggestions = resolveSlashInputHighlightSuggestions({
    activeLineInput: "/plan 帮我写一份抖音直播规划",
    suggestions: [],
    getSlashSuggestions: (input) =>
      input === "/plan"
        ? [{ command: "/plan", description: "进入 plan mode" }]
        : [],
  });
  const slashInputWithArgsFallbackHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/plan 帮我写一份抖音直播规划",
    suggestions: slashInputWithArgsFallbackSuggestions,
  });
  const slashInputPartialWithArgsFallbackSuggestions = resolveSlashInputHighlightSuggestions({
    activeLineInput: "/pl 帮我写一份抖音直播规划",
    suggestions: [],
    getSlashSuggestions: (input) =>
      input === "/pl"
        ? [{ command: "/plan", description: "进入 plan mode" }]
        : [],
  });
  const slashInputPartialWithArgsFallbackHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/pl 帮我写一份抖音直播规划",
    suggestions: slashInputPartialWithArgsFallbackSuggestions,
  });

  const enterMenuAction = resolveSlashSuggestionKeyAction({
    key: "enter",
    hasActiveSuggestions: true,
    selectedCommand: "/model",
    activeLineInput: "/mo",
  });
  const enterPlanGoalAction = resolveSlashSuggestionKeyAction({
    key: "enter",
    hasActiveSuggestions: true,
    selectedCommand: "/plan",
    activeLineInput: "/plan 我要一份抖音直播间规划",
  });
  const tabCommandsNewAction = resolveSlashSuggestionKeyAction({
    key: "tab",
    hasActiveSuggestions: true,
    selectedCommand: "/commands",
    activeLineInput: "/co",
  });
  const tabPlanGoalAction = resolveSlashSuggestionKeyAction({
    key: "tab",
    hasActiveSuggestions: true,
    selectedCommand: "/plan",
    activeLineInput: "/plan 我要一份抖音直播间规划",
  });
  const escapeActionForSlash = resolveSlashSuggestionKeyAction({
    key: "escape",
    hasActiveSuggestions: true,
    selectedCommand: "/model",
    activeLineInput: "/model",
  });
  const noopAction = resolveSlashSuggestionKeyAction({
    key: "enter",
    hasActiveSuggestions: false,
    selectedCommand: "/model",
  });

  const submitReturn = resolveSubmitKeyAction({
    chunk: "\r",
    key: { name: "return", sequence: "\r" },
  });
  const submitEnter = resolveSubmitKeyAction({
    chunk: "\n",
    key: { name: "enter", sequence: "\n" },
  });
  const submitLegacySequence = resolveSubmitKeyAction({
    chunk: "\u001bOM",
    key: { sequence: "\u001bOM" },
  });
  const submitCsiU = resolveSubmitKeyAction({
    chunk: "\u001b[13u",
    key: { sequence: "\u001b[13u" },
  });
  const newlineShift = resolveSubmitKeyAction({
    chunk: "\r",
    key: { name: "return", sequence: "\r", shift: true },
  });
  const newlineMeta = resolveSubmitKeyAction({
    chunk: "\r",
    key: { name: "return", sequence: "\r", meta: true },
  });
  const newlineCsiUShift = resolveSubmitKeyAction({
    chunk: "\u001b[13;2u",
    key: { sequence: "\u001b[13;2u" },
  });
  const submitNone = resolveSubmitKeyAction({
    chunk: "a",
    key: { name: "a", sequence: "a" },
  });
  const coalescedSubmit = resolveCoalescedSubmitChunk("hello\r");
  const coalescedSubmitCrLf = resolveCoalescedSubmitChunk("hello\r\n");
  const coalescedSubmitLf = resolveCoalescedSubmitChunk("hello\n");
  const askUserPanelOtherSubmit = decodeAskUserPanelInput("hello\r", 3, true);
  const askUserPanelOtherSubmitCrLf = decodeAskUserPanelInput("hello\r\n", 3, true);
  const askUserPanelOtherSubmitCjk = decodeAskUserPanelInput("补充说明\r", 3, true);
  const askUserPanelNumericSubmit = decodeAskUserPanelInput("2\r", 3, false);
  const askUserPanelOtherIndexSubmit = decodeAskUserPanelInput("3\r", 3, false);
  const askUserPanelOtherPrintable = decodeAskUserPanelInput("补", 3, true);
  const askUserPanelOtherBackspace = decodeAskUserPanelInput("\u007f", 3, true);
  const askUserPanelNotesShortcut = decodeAskUserPanelInput("n", 3, false);
  const askUserPanelNotesPrintable = decodeAskUserPanelInput("n", 3, true);
  const askUserPanelChatShortcut = decodeAskUserPanelInput("c", 3, false);
  const askUserPanelSkipShortcut = decodeAskUserPanelInput("s", 3, false, true);
  const askUserPanelSkipWithoutPlanTypesOther = decodeAskUserPanelInput("s", 3, false, false);
  const coalescedWithBackslash = resolveCoalescedSubmitChunk("\\\r");
  const coalescedEscapeSequence = resolveCoalescedSubmitChunk("\u001b\r");
  const inlineInputOption = {
    id: "keep_planning",
    label: "继续完善计划",
    input: {
      placeholder: "告诉 Grobot 需要调整什么",
      showLabelWithValue: true,
      labelValueSeparator: ": ",
    },
  };
  const inlineInputEmptyEnter = reduceTerminalSelectMenuInlineInput({
    rawInput: "\r",
    item: inlineInputOption,
    currentValue: "",
    inputMode: false,
    variant: "plan_approval",
  });
  const inlineInputPrintable = reduceTerminalSelectMenuInlineInput({
    rawInput: "补",
    item: inlineInputOption,
    currentValue: "",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputBackspace = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u007f",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: false,
    variant: "plan_approval",
  });
  const inlineInputClear = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u0015",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputCoalescedSubmit = reduceTerminalSelectMenuInlineInput({
    rawInput: "please revise\r\n",
    item: inlineInputOption,
    currentValue: "",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputEscExitsInput = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u001b",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputEscWithoutInputIgnored = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u001b",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: false,
    variant: "plan_approval",
  });
  const inlineInputCtrlGEditPlan = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u0007",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputShiftTabApproveFeedback =
    isPlanApprovalInlineFeedbackApproveShortcut("\u001b[Z");
  const numericSelectionDefaultEnabled = shouldEnableTerminalSelectMenuNumericSelection({});
  const numericSelectionHiddenIndexDisabled = shouldEnableTerminalSelectMenuNumericSelection({
    hideIndexes: true,
  });
  const submitChunkOnlyLf = resolveSubmitKeyAction({
    chunk: "\n",
    key: {},
  });
  const interactivePlainEnterDefersToKeypress = resolveInteractiveEnterDataAction({
    chunk: "\r",
    keypressSupported: true,
  });
  const interactivePlainEnterRecentKeypressIgnored = resolveInteractiveEnterDataAction({
    chunk: "\r",
    keypressSupported: true,
    keypressHandledRecently: true,
  });
  const interactivePlainEnterFallbackSubmits = resolveInteractiveEnterDataAction({
    chunk: "\r",
    keypressSupported: false,
  });
  const interactiveTextSubmitChunkIgnored = resolveInteractiveEnterDataAction({
    chunk: "hello\r",
    keypressSupported: true,
  });
  const historyShortcutCtrlR = isHistorySearchShortcut({
    chunk: "\u0012",
    key: { ctrl: true, name: "r", sequence: "\u0012" },
  });
  const historyShortcutRawCtrlR = isHistorySearchShortcut({
    chunk: "\u0012",
    key: {},
  });
  const shortcutCtrlC = resolveInputShortcutAction({
    chunk: "\u0003",
    key: { ctrl: true, name: "c", sequence: "\u0003" },
  });
  const shortcutCtrlR = resolveInputShortcutAction({
    chunk: "\u0012",
    key: { ctrl: true, name: "r", sequence: "\u0012" },
  });
  const shortcutOther = resolveInputShortcutAction({
    chunk: "a",
    key: { name: "a", sequence: "a" },
  });
  const shortcutOverlayEmptyQuestion = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { name: "?", sequence: "?" },
    inputGraphemeLength: 0,
  });
  const shortcutOverlayDraftQuestion = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { name: "?", sequence: "?" },
    inputGraphemeLength: 1,
  });
  const shortcutOverlaySlashQuestion = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { name: "?", sequence: "?" },
    inputGraphemeLength: 1,
    hasActiveSlashSuggestions: true,
  });
  const shortcutOverlayCtrlQuestionIgnored = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { ctrl: true, name: "?", sequence: "?" },
    inputGraphemeLength: 0,
  });
  const draftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? 快捷键 · grobot · ctx 42%"],
    inputGraphemeLength: 3,
  });
  const styledDraftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["\u001B[90m\u001B[38;2;202;124;94m? 快捷键\u001B[0m\u001B[90m · grobot · ctx 42%\u001B[0m"],
    inputGraphemeLength: 3,
  });
  const emptyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? 快捷键 · grobot · ctx 42%"],
    inputGraphemeLength: 0,
  });
  const draftHintOnlyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? 快捷键"],
    inputGraphemeLength: 1,
  });
  const inputChromeLines = renderInteractiveInputChromeLines({
    bodyLines: ["❯ hello"],
    inputBodyWidth: 20,
  });
  const submittedTranscriptLines = renderSubmittedInputTranscriptLines({
    value: "你是啥模型",
    promptLabel: "❯ ",
    terminalColumns: 96,
    theme: "ccline",
  });
  const submittedPlanTranscriptLines = renderSubmittedInputTranscriptLines({
    value: "/plan 帮我规划 plan mode 交互",
    promptLabel: "❯ ",
    terminalColumns: 96,
    theme: "ccline",
    getSlashSuggestions: (input) =>
      input === "/plan"
        ? [{ command: "/plan", description: "进入 plan mode" }]
        : [],
  });
  const submittedTranscriptPlain = submittedTranscriptLines
    .map(stripAnsi)
    .join("\n");
  const submittedPlanTranscriptPlain = submittedPlanTranscriptLines
    .map(stripAnsi)
    .join("\n");
  const submittedPlanTranscriptRaw = submittedPlanTranscriptLines.join("\n");
  const inputChromeTopLinePlain = stripAnsi(inputChromeLines[0] ?? "");
  const inputChromeBodyLine = inputChromeLines[1] ?? "";
  const inputChromeBodyLinePlain = stripAnsi(inputChromeBodyLine);
  const inputChromeBottomLinePlain = stripAnsi(inputChromeLines[2] ?? "");
  const inputChromeLeftPadding =
    inputChromeBodyLinePlain.match(/^ */)?.[0]?.length ?? 0;
  const inputChromeTopWidth = measureDisplayWidth(inputChromeTopLinePlain);
  const inputChromeBodyWidth = measureDisplayWidth(inputChromeBodyLinePlain);
  const inputChromeBottomWidth = measureDisplayWidth(inputChromeBottomLinePlain);
  const inputChromeCursorColumn = resolveInteractiveInputCursorColumn({
    promptRelativeCursorColumn: 4,
  });
  const inputChromeFullTerminalWidth = resolveInteractiveInputBodyWidth({
    terminalColumns: 80,
    promptLabelWidth: 2,
  });
  const inputChromeSmallTerminalWidth = resolveInteractiveInputBodyWidth({
    terminalColumns: 8,
    promptLabelWidth: 4,
  });
  const initialMenuViewport = resolveTerminalSelectMenuViewport({
    itemsLength: 12,
    activeIndex: 8,
    visibleOptionCount: 5,
  });
  const nextMenuViewport = resolveTerminalSelectMenuViewport({
    itemsLength: 12,
    activeIndex: 9,
    visibleOptionCount: 5,
    previousStartIndex: initialMenuViewport.startIndex,
  });
  const previousMenuViewport = resolveTerminalSelectMenuViewport({
    itemsLength: 12,
    activeIndex: 4,
    visibleOptionCount: 5,
    previousStartIndex: nextMenuViewport.startIndex,
  });
  const selectNavigationInitial = normalizeSelectNavigationState({
    optionCount: 12,
    focusedIndex: 8,
    visibleOptionCount: 5,
    initialPlacement: "end",
  });
  const selectNavigationPageDown = reduceSelectNavigation(selectNavigationInitial, {
    type: "page_down",
  });
  const selectNavigationPageUp = reduceSelectNavigation(selectNavigationPageDown, {
    type: "page_up",
  });
  const selectNavigationWrapNext = reduceSelectNavigation(
    normalizeSelectNavigationState({
      optionCount: 12,
      focusedIndex: 11,
      visibleOptionCount: 5,
    }),
    { type: "next" },
  );
  const selectNavigationSetOptions = reduceSelectNavigation(selectNavigationInitial, {
    type: "set_options",
    optionCount: 3,
  });
  const promptSlotSelectMenu = resolvePromptSlotState({
    selectMenuOpen: true,
    hasStatusLine: true,
  });
  const promptSlotSuggestions = resolvePromptSlotState({
    hasSuggestions: true,
    hasStatusLine: true,
  });
  const promptSlotHistorySearch = resolvePromptSlotState({
    historySearchOpen: true,
    hasSuggestions: true,
  });
  const promptSlotPendingAsk = resolvePromptSlotState({
    pendingAskCount: 2,
    hasStatusLine: true,
  });
  const promptSlotRunning = resolvePromptSlotState({
    running: true,
    pendingAskCount: 0,
    hasStatusLine: true,
  });
  const promptSlotStatus = resolvePromptSlotState({
    hasStatusLine: true,
    hasDraft: false,
  });
  const promptSlotIdleHint = resolvePromptSlotState({
    hasDraft: false,
  });
  const promptSlotDraft = resolvePromptSlotState({
    hasStatusLine: false,
    hasDraft: true,
  });
  const promptSlotShortFullscreen = resolvePromptSlotState({
    hasStatusLine: true,
    terminalRows: 18,
    fullscreen: true,
  });
  const promptSlotHiddenInput = resolvePromptSlotState({
    inputVisible: false,
    hasStatusLine: true,
    running: true,
  });
  const runtimeFooterStatus = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    promptSlot: {
      hasStatusLine: true,
    },
  });
  const runtimeFooterSuggestions = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    hasSuggestions: true,
    promptSlot: {
      hasStatusLine: true,
    },
  });
  const runtimeFooterShortcutOverlay = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    shortcutOverlayVisible: true,
    promptSlot: {
      hasStatusLine: true,
    },
  });
  const runtimeFooterPendingAsk = resolveSessionInputFooterLines({
    footerLines: ["ask 1 pending"],
    inputGraphemeLength: 0,
    promptSlot: {
      pendingAskCount: 1,
      hasStatusLine: true,
    },
  });
  const runtimeFooterDraftNoStatus = resolveSessionInputFooterLines({
    footerLines: ["? 快捷键"],
    inputGraphemeLength: 2,
    promptSlot: {
      hasStatusLine: false,
    },
  });
  const runtimeFooterShortFullscreen = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    promptSlot: {
      hasStatusLine: true,
      terminalRows: 18,
      fullscreen: true,
    },
  });
  const runtimeFooterShortFullscreenDraft = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 2,
    promptSlot: {
      hasStatusLine: true,
      terminalRows: 18,
      fullscreen: true,
    },
  });

  const payload = {
    menu_enter_is_confirm: enterAction.kind === "enter",
    menu_lf_is_confirm: lfEnterAction.kind === "enter",
    menu_crlf_is_confirm: crlfEnterAction.kind === "enter",
    menu_space_is_confirm: spaceAction.kind === "enter",
    menu_ctrl_p_is_up: ctrlPAction.kind === "up",
    menu_ctrl_n_is_down: ctrlNAction.kind === "down",
    menu_ctrl_g_is_edit_plan: ctrlGAction.kind === "edit_plan",
    menu_escape_is_cancel: escapeAction.kind === "cancel",
    menu_arrow_up_is_up: arrowUpAction.kind === "up",
    menu_arrow_down_is_down: arrowDownAction.kind === "down",
    menu_page_up_is_page_up: pageUpAction.kind === "page_up",
    menu_page_down_is_page_down: pageDownAction.kind === "page_down",
    menu_multi_digits_direct_index:
      directIndexAction.kind === "select_index" && directIndexAction.index === 11,
    menu_digit_coalesced_crlf_direct_index:
      directIndexCrlfAction.kind === "select_index" && directIndexCrlfAction.index === 1,
    menu_digit_prefix_has_continuation:
      hasMenuDigitsContinuation("1", menuItemsLength),
    menu_digit_suffix_no_continuation:
      !hasMenuDigitsContinuation("12", menuItemsLength),
    menu_digit_prefix_first_match_index:
      resolveFirstMenuPrefixMatchIndex("1", menuItemsLength) === 0,
    menu_digits_to_index_10:
      resolveMenuIndexFromDigits("10", menuItemsLength) === 9,
    menu_digits_reject_leading_zero:
      typeof resolveMenuIndexFromDigits("01", menuItemsLength) === "undefined",
    menu_search_compact_prefers_relevant_item:
      menuSearchMatches.length > 0 && menuSearchMatches[0] === 1,
    menu_search_digits_match_timestamp_description:
      menuSearchDigitMatches.length > 0 && menuSearchDigitMatches[0] === 2,
    menu_search_empty_returns_all:
      menuSearchEmptyMatches.length === 2
      && menuSearchEmptyMatches[0] === 0
      && menuSearchEmptyMatches[1] === 1,
    slash_apply_menu_command:
      slashMenu.command === "/model" && slashMenu.submitImmediately,
    slash_apply_commands_menu_submit:
      slashCommandsMenu.command === "/commands" && slashCommandsMenu.submitImmediately,
    slash_apply_plan_submit:
      slashPlanMenu.command === "/plan" && slashPlanMenu.submitImmediately,
    slash_apply_skill_creator_requires_input:
      slashSkillCreatorMenu.command === "/skill-creator" && slashSkillCreatorMenu.submitImmediately,
    slash_key_enter_applies_and_submits:
      enterMenuAction.kind === "apply"
      && enterMenuAction.appliedCommand === "/model"
      && enterMenuAction.submitImmediately,
    slash_key_tab_applies_without_submit:
      tabCommandsNewAction.kind === "apply"
      && tabCommandsNewAction.appliedCommand === "/commands"
      && !tabCommandsNewAction.submitImmediately,
    slash_key_enter_with_args_keeps_user_input:
      enterPlanGoalAction.kind === "noop",
    slash_key_tab_with_args_keeps_user_input:
      tabPlanGoalAction.kind === "noop",
    slash_key_escape_hides_panel:
      escapeActionForSlash.kind === "hide_panel"
      && escapeActionForSlash.hiddenLineInput === "/model",
    slash_key_no_suggestions_noop:
      noopAction.kind === "noop",
    slash_overlay_partial_selected_highlighted:
      slashOverlayPartial.includes("\u001B[38;2;202;124;94m"),
    slash_overlay_exact_selected_highlighted:
      slashOverlayExact.includes("\u001B[38;2;202;124;94m"),
    slash_overlay_scroll_window_keeps_selected_visible:
      slashOverlayScrolled.includes("/model"),
    slash_overlay_scroll_window_highlights_selected:
      slashOverlayScrolledModelLine.includes("\u001B[38;2;202;124;94m/model"),
    slash_overlay_scroll_window_uses_restraint_not_bold:
      !slashOverlayScrolledModelLine.includes("\u001B[1m\u001B[38;2;202;124;94m/model"),
    slash_overlay_selected_has_pointer:
      stripAnsi(slashOverlayScrolledModelLine).startsWith("❯ /model"),
    slash_overlay_scroll_window_does_not_wrap_to_first:
      slashOverlayScrolledSessionsLine.length === 0,
    slash_overlay_scroll_window_has_no_row_up_marker:
      !slashOverlayScrolledFirstLinePlain.startsWith("↑ "),
    slash_overlay_scroll_window_has_no_row_down_marker:
      !slashOverlayDownMarkerLastLinePlain.startsWith("↓ "),
    slash_overlay_scroll_window_keeps_compact_height:
      slashOverlayScrolledLines.length === 5,
    slash_overlay_scroll_window_centers_selected_when_possible:
      slashOverlayCenteredSelectedRow >= 2 && slashOverlayCenteredSelectedRow <= 5,
    suggestion_window_reusable_selected_centered:
      genericSuggestionWindow.startIndex === 4
      && genericSuggestionWindow.endIndex === 7
      && genericSuggestionWindow.selectedVisibleIndex === 1
      && genericSuggestionWindow.visibleItems[1] === "/six",
    prompt_suggestions_overlay_caps_at_five:
      promptSuggestionOverlayLines.length === 5,
    prompt_suggestions_overlay_centers_selected:
      promptSuggestionOverlaySelectedRow >= 1 && promptSuggestionOverlaySelectedRow <= 3,
    prompt_suggestions_inline_uses_rows_minus_prompt_budget:
      promptSuggestionInlineLines.length === 3,
    prompt_suggestions_selected_uses_reference_color:
      promptSuggestionOverlay.includes("\u001B[38;2;202;124;94m/six"),
    prompt_suggestions_file_uses_icon_and_middle_truncation:
      promptSuggestionFilePlain.includes("+ ")
      && promptSuggestionFilePlain.includes("gateway/src")
      && promptSuggestionFilePlain.includes("suggestion-window.ts")
      && promptSuggestionFilePlain.includes("..."),
    prompt_suggestions_file_lines_within_width:
      promptSuggestionFile
        .split("\n")
        .filter((line) => line.length > 0)
        .every((line) => measureDisplayWidth(line) <= 72),
    prompt_suggestions_mcp_and_agent_icons:
      stripAnsi(promptSuggestionIcons).includes("◇ ")
      && stripAnsi(promptSuggestionIcons).includes("* frontend_worker"),
    prompt_suggestions_tags_and_description_flatten:
      promptSuggestionTaggedPlain.includes("[user]")
      && promptSuggestionTaggedPlain.includes("Create weekly operator summary"),
    prompt_suggestions_selection_pointer_optional:
      promptSuggestionPointerPlain
        .split("\n")
        .some((line) => line.startsWith("❯ /plan")),
    prompt_suggestions_middle_truncates_both_edges:
      promptSuggestionMiddleTruncate.startsWith("gateway/")
      && promptSuggestionMiddleTruncate.endsWith("window.ts")
      && promptSuggestionMiddleTruncate.includes("..."),
    slash_overlay_narrow_hides_description:
      !stripAnsi(slashOverlayNarrow).includes("打开模型选择器"),
    slash_overlay_narrow_lines_within_width:
      slashOverlayNarrowLines.every((line) => measureDisplayWidth(line) <= 52),
    slash_overlay_hidden_when_has_args:
      slashOverlayWithArgs.length === 0,
    slash_input_partial_not_highlighted:
      !slashInputPartialHighlight,
    slash_input_exact_highlighted:
      slashInputExactHighlight,
    slash_input_with_args_highlighted:
      slashInputWithArgsHighlight,
    slash_input_with_args_fallback_highlighted:
      slashInputWithArgsFallbackHighlight,
    slash_input_partial_with_args_fallback_not_highlighted:
      !slashInputPartialWithArgsFallbackHighlight,
    submit_return_detected: submitReturn === "submit",
    submit_enter_detected: submitEnter === "submit",
    submit_legacy_sequence_detected: submitLegacySequence === "submit",
    submit_csiu_detected: submitCsiU === "submit",
    submit_shift_newline: newlineShift === "newline",
    submit_meta_newline: newlineMeta === "newline",
    submit_csiu_shift_newline: newlineCsiUShift === "newline",
    submit_non_enter_ignored: submitNone === "none",
    submit_coalesced_detected:
      coalescedSubmit.shouldSubmit
      && coalescedSubmit.normalizedChunk === "hello",
    submit_coalesced_crlf_detected:
      coalescedSubmitCrLf.shouldSubmit
      && coalescedSubmitCrLf.normalizedChunk === "hello",
    submit_coalesced_lf_detected:
      coalescedSubmitLf.shouldSubmit
      && coalescedSubmitLf.normalizedChunk === "hello",
    ask_user_panel_other_submit_text:
      askUserPanelOtherSubmit.kind === "submit_text"
      && askUserPanelOtherSubmit.value === "hello",
    ask_user_panel_other_submit_crlf_text:
      askUserPanelOtherSubmitCrLf.kind === "submit_text"
      && askUserPanelOtherSubmitCrLf.value === "hello",
    ask_user_panel_other_submit_cjk_text:
      askUserPanelOtherSubmitCjk.kind === "submit_text"
      && askUserPanelOtherSubmitCjk.value === "补充说明",
    ask_user_panel_numeric_submit_selects_standard_option:
      askUserPanelNumericSubmit.kind === "select_index"
      && askUserPanelNumericSubmit.index === 1,
    ask_user_panel_other_numeric_submit_focuses_other:
      askUserPanelOtherIndexSubmit.kind === "select_index"
      && askUserPanelOtherIndexSubmit.index === 2,
    ask_user_panel_other_printable_text:
      askUserPanelOtherPrintable.kind === "text"
      && askUserPanelOtherPrintable.value === "补",
    ask_user_panel_other_backspace:
      askUserPanelOtherBackspace.kind === "backspace",
    ask_user_panel_notes_shortcut:
      askUserPanelNotesShortcut.kind === "notes",
    ask_user_panel_notes_mode_printable_text:
      askUserPanelNotesPrintable.kind === "text"
      && askUserPanelNotesPrintable.value === "n",
    ask_user_panel_chat_shortcut:
      askUserPanelChatShortcut.kind === "chat",
    ask_user_panel_skip_shortcut_plan_only:
      askUserPanelSkipShortcut.kind === "skip",
    ask_user_panel_skip_without_plan_keeps_other_typing:
      askUserPanelSkipWithoutPlanTypesOther.kind === "text"
      && askUserPanelSkipWithoutPlanTypesOther.value === "s",
    submit_coalesced_backslash_ignored:
      !coalescedWithBackslash.shouldSubmit
      && coalescedWithBackslash.normalizedChunk === "\\\r",
    submit_coalesced_escape_ignored:
      !coalescedEscapeSequence.shouldSubmit
      && coalescedEscapeSequence.normalizedChunk === "\u001b\r",
    menu_inline_input_empty_enter_activates:
      inlineInputEmptyEnter.kind === "activate"
      && inlineInputEmptyEnter.value === "",
    menu_inline_input_printable_updates:
      inlineInputPrintable.kind === "update"
      && inlineInputPrintable.value === "补",
    menu_inline_input_backspace_updates_even_before_mode:
      inlineInputBackspace.kind === "update"
      && inlineInputBackspace.value === "ab",
    menu_inline_input_ctrl_u_clears:
      inlineInputClear.kind === "update"
      && inlineInputClear.value === "",
    menu_inline_input_coalesced_submit:
      inlineInputCoalescedSubmit.kind === "submit"
      && inlineInputCoalescedSubmit.value === "please revise",
    menu_inline_input_esc_exits_input_first:
      inlineInputEscExitsInput.kind === "exit_input"
      && inlineInputEscExitsInput.value === "abc",
    menu_inline_input_esc_without_input_falls_through:
      inlineInputEscWithoutInputIgnored.kind === "ignored",
    menu_inline_input_ctrl_g_keeps_plan_editor:
      inlineInputCtrlGEditPlan.kind === "edit_plan"
      && inlineInputCtrlGEditPlan.value === "abc",
    menu_inline_input_shift_tab_approves_feedback:
      inlineInputShiftTabApproveFeedback,
    menu_numeric_selection_default_enabled: numericSelectionDefaultEnabled,
    menu_numeric_selection_hidden_indexes_disabled: !numericSelectionHiddenIndexDisabled,
    submit_chunk_only_lf_detected: submitChunkOnlyLf === "submit",
    interactive_plain_enter_defers_to_keypress:
      interactivePlainEnterDefersToKeypress === "defer_to_keypress",
    interactive_plain_enter_recent_keypress_ignored:
      interactivePlainEnterRecentKeypressIgnored === "none",
    interactive_plain_enter_fallback_submits:
      interactivePlainEnterFallbackSubmits === "submit",
    interactive_text_submit_chunk_ignored:
      interactiveTextSubmitChunkIgnored === "none",
    shortcut_history_ctrl_r_detected: historyShortcutCtrlR,
    shortcut_history_raw_ctrl_r_detected: historyShortcutRawCtrlR,
    shortcut_ctrl_c_sigint: shortcutCtrlC === "sigint",
    shortcut_ctrl_r_history_search: shortcutCtrlR === "history_search",
    shortcut_non_matching_none: shortcutOther === "none",
    shortcut_overlay_empty_question_toggles:
      shortcutOverlayEmptyQuestion === "toggle_overlay",
    shortcut_overlay_draft_question_inserts:
      shortcutOverlayDraftQuestion === "insert_text",
    shortcut_overlay_slash_question_inserts:
      shortcutOverlaySlashQuestion === "insert_text",
    shortcut_overlay_ctrl_question_ignored:
      shortcutOverlayCtrlQuestionIgnored === "none",
    footer_draft_hides_shortcut_hint:
      draftFooterLines.length === 1
      && draftFooterLines[0] === "grobot · ctx 42%",
    footer_draft_hides_styled_shortcut_hint:
      styledDraftFooterLines.length === 1
      && styledDraftFooterLines[0] === "grobot · ctx 42%",
    footer_empty_keeps_shortcut_hint:
      emptyFooterLines.length === 1
      && emptyFooterLines[0]?.startsWith("? 快捷键") === true,
    footer_draft_removes_hint_only_line:
      draftHintOnlyFooterLines.length === 0,
    input_chrome_has_open_horizontal_rails:
      /^─+$/.test(inputChromeTopLinePlain)
      && /^─+$/.test(inputChromeBottomLinePlain),
    input_chrome_has_no_corner_caps:
      !/[╭╮╰╯]/.test(inputChromeTopLinePlain)
      && !/[╭╮╰╯]/.test(inputChromeBottomLinePlain),
    input_chrome_has_no_vertical_body_rails:
      !inputChromeBodyLine.includes("│"),
    input_chrome_prompt_uses_claude_chevron:
      inputChromeBodyLine.startsWith("❯"),
    input_chrome_prompt_avoids_thin_chevron:
      !inputChromeBodyLine.startsWith("›"),
    input_chrome_has_no_left_gutter:
      inputChromeLeftPadding === 0,
    input_chrome_border_tracks_body_width:
      inputChromeTopWidth === inputChromeBodyWidth
      && inputChromeBottomWidth === inputChromeTopWidth,
    input_chrome_cursor_column_matches_open_rails:
      inputChromeCursorColumn === 4,
    input_chrome_cursor_uses_left_padding:
      inputChromeCursorColumn === inputChromeLeftPadding + 4,
    input_chrome_uses_full_terminal_width:
      inputChromeFullTerminalWidth === 80,
    input_chrome_respects_prompt_minimum_width:
      inputChromeSmallTerminalWidth === 12,
    submitted_transcript_keeps_user_text:
      submittedTranscriptPlain.includes("❯ 你是啥模型"),
    submitted_transcript_omits_status_footer:
      !submittedTranscriptPlain.includes("? 快捷键")
      && !submittedTranscriptPlain.includes("window")
      && !submittedTranscriptPlain.includes("kimi/"),
    submitted_transcript_is_input_frame_only:
      submittedTranscriptLines.length === 3
      && submittedTranscriptPlain.split("\n").filter((line) => /^─+$/.test(line)).length === 2,
    submitted_transcript_lines_within_width:
      submittedTranscriptLines.every((line) => measureDisplayWidth(line) <= 96),
    submitted_slash_transcript_preserves_command_highlight:
      submittedPlanTranscriptPlain.includes("❯ /plan 帮我规划 plan mode 交互")
      && submittedPlanTranscriptRaw.includes("\u001B[1m\u001B[38;2;202;124;94m/plan\u001B[0m"),
    menu_viewport_keeps_active_visible:
      initialMenuViewport.startIndex > 0
      && initialMenuViewport.endIndex === 9
      && initialMenuViewport.activeIndex === 8,
    menu_viewport_scrolls_one_row_down:
      nextMenuViewport.startIndex === initialMenuViewport.startIndex + 1
      && nextMenuViewport.endIndex === 10,
    menu_viewport_scrolls_one_row_up:
      previousMenuViewport.startIndex === nextMenuViewport.startIndex - 1
      && previousMenuViewport.endIndex === 9,
    select_navigation_page_down_clamps_to_last:
      selectNavigationPageDown.focusedIndex === 11
      && selectNavigationPageDown.visibleToIndex === 12,
    select_navigation_page_up_returns_by_page:
      selectNavigationPageUp.focusedIndex === 6
      && selectNavigationPageUp.visibleFromIndex <= selectNavigationPageUp.focusedIndex,
    select_navigation_wrap_next:
      selectNavigationWrapNext.focusedIndex === 0
      && selectNavigationWrapNext.visibleFromIndex === 0,
    select_navigation_set_options_clamps_focus:
      selectNavigationSetOptions.optionCount === 3
      && selectNavigationSetOptions.focusedIndex === 2,
    prompt_slot_select_menu_owns_focus_without_footer:
      promptSlotSelectMenu.focusOwner === "select_menu"
      && promptSlotSelectMenu.bottomSlot.kind === "select_menu"
      && !promptSlotSelectMenu.bottomSlot.renderFooter
      && !promptSlotSelectMenu.bottomSlot.renderStatus,
    prompt_slot_suggestions_suppress_status:
      promptSlotSuggestions.focusOwner === "slash_suggestions"
      && promptSlotSuggestions.bottomSlot.kind === "suggestions"
      && promptSlotSuggestions.bottomSlot.renderFooter
      && !promptSlotSuggestions.bottomSlot.renderStatus,
    prompt_slot_history_preempts_suggestions:
      promptSlotHistorySearch.focusOwner === "history_search"
      && promptSlotHistorySearch.bottomSlot.kind === "history_search",
    prompt_slot_pending_ask_preempts_status:
      promptSlotPendingAsk.focusOwner === "pending_ask"
      && promptSlotPendingAsk.bottomSlot.kind === "pending_ask"
      && !promptSlotPendingAsk.bottomSlot.renderStatus,
    prompt_slot_running_preempts_status:
      promptSlotRunning.focusOwner === "running_activity"
      && promptSlotRunning.bottomSlot.kind === "running_activity"
      && !promptSlotRunning.bottomSlot.renderStatus,
    prompt_slot_status_when_input_idle:
      promptSlotStatus.focusOwner === "input"
      && promptSlotStatus.bottomSlot.kind === "status"
      && promptSlotStatus.bottomSlot.renderStatus,
    prompt_slot_idle_hint_hidden_for_draft:
      promptSlotIdleHint.bottomSlot.kind === "idle_hint"
      && promptSlotIdleHint.bottomSlot.renderIdleHint
      && promptSlotDraft.bottomSlot.kind === "none",
    prompt_slot_short_fullscreen_drops_status_first:
      promptSlotShortFullscreen.bottomSlot.kind === "idle_hint"
      && !promptSlotShortFullscreen.bottomSlot.renderStatus,
    prompt_slot_hidden_input_renders_no_footer:
      promptSlotHiddenInput.bottomSlot.kind === "none"
      && !promptSlotHiddenInput.bottomSlot.renderFooter,
    prompt_slot_runtime_status_footer_renders:
      runtimeFooterStatus.promptSlotState.bottomSlot.kind === "status"
      && runtimeFooterStatus.footerLines.length === 1
      && runtimeFooterStatus.footerLines[0] === "status line",
    prompt_slot_runtime_suggestions_suppress_status_footer:
      runtimeFooterSuggestions.promptSlotState.bottomSlot.kind === "suggestions"
      && runtimeFooterSuggestions.footerLines.length === 0,
    prompt_slot_runtime_shortcut_overlay_suppresses_status_footer:
      runtimeFooterShortcutOverlay.promptSlotState.bottomSlot.kind === "shortcut_overlay"
      && runtimeFooterShortcutOverlay.footerLines.length === 0,
    prompt_slot_runtime_pending_ask_renders_footer:
      runtimeFooterPendingAsk.promptSlotState.bottomSlot.kind === "pending_ask"
      && runtimeFooterPendingAsk.footerLines.length === 1
      && runtimeFooterPendingAsk.footerLines[0] === "ask 1 pending",
    prompt_slot_runtime_draft_without_status_hides_footer:
      runtimeFooterDraftNoStatus.promptSlotState.bottomSlot.kind === "none"
      && runtimeFooterDraftNoStatus.footerLines.length === 0,
    prompt_slot_runtime_short_fullscreen_replaces_status_with_hint:
      runtimeFooterShortFullscreen.promptSlotState.bottomSlot.kind === "idle_hint"
      && runtimeFooterShortFullscreen.footerLines.length === 1
      && stripAnsi(runtimeFooterShortFullscreen.footerLines[0] ?? "") === "? 快捷键",
    prompt_slot_runtime_short_fullscreen_draft_hides_footer:
      runtimeFooterShortFullscreenDraft.promptSlotState.bottomSlot.kind === "none"
      && runtimeFooterShortFullscreenDraft.footerLines.length === 0,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
