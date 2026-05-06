import {
  decodeTerminalSelectMenuInput,
  hasMenuDigitsContinuation,
  isTerminalSelectMenuPrintableInput,
  normalizeTerminalSelectMenuTextInput,
  normalizeTerminalSelectMenuIndex,
  normalizeSelectNavigationState,
  normalizeTerminalSelectMenuVisibleOptionCount,
  reduceSelectNavigation,
  reduceTerminalSelectMenuInlineInput,
  resolveFirstMenuPrefixMatchIndex,
  resolveMenuIndexFromDigits,
  resolveMenuSearchMatchedIndices,
  resolveTerminalSelectMenuItemInputValue,
  resolveTerminalSelectMenuViewport,
  shouldEnableTerminalSelectMenuNumericSelection,
  trimTerminalSelectMenuSearchQuery,
  type SelectNavigationAction,
} from "./reducer";
import { splitGraphemes } from "../../terminal/display-width";
import { createCliUiRenderer } from "../../kernel/renderer";
import {
  type TerminalSelectMenuInput,
  type TerminalSelectMenuInlineInputReduction,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuResult,
} from "./contract";
import {
  createTerminalSelectMenuRenderSurface,
  createTerminalSelectMenuTransitionController,
  resolveTerminalSelectMenuTransitionConfig,
} from "./transition";

const MENU_SEARCH_CLEAR_CONTROL = "\u0015";
const MENU_SEARCH_TOGGLE_CONTROL = "\u0006";
const MENU_DIGIT_SELECTION_COMMIT_DELAY_MS = 250;

interface MenuInputStream {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
  on?: (event: "data", listener: (chunk: string) => void) => void;
  off?: (event: "data", listener: (chunk: string) => void) => void;
  resume?: () => void;
  setEncoding?: (encoding: string) => void;
}

export function isPlanApprovalInlineFeedbackApproveShortcut(rawInput: string): boolean {
  return String(rawInput ?? "") === "\u001b[Z";
}

export function shouldRouteTerminalSelectMenuInlineInputBeforeMode(input: {
  rawInput: string;
  menuSearchMode?: boolean;
  hasActiveInputItem?: boolean;
}): boolean {
  return input.menuSearchMode !== true
    && input.hasActiveInputItem === true
    && String(input.rawInput ?? "") === "\t";
}

function isPlanApprovalExternalEditEnabled(input: TerminalSelectMenuInput): boolean {
  return input.variant === "plan_approval" && input.planApprovalMeta?.emptyPlan !== true;
}

function resolveStdoutColumns(): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.columns === "number"
    && Number.isFinite(stdout.columns)
    && stdout.columns > 0
  ) {
    return Math.floor(stdout.columns);
  }
  return undefined;
}

export {
  decodeTerminalSelectMenuInput,
  decodeTerminalSelectMenuInput as decodeMenuInput,
  hasMenuDigitsContinuation,
  isTerminalSelectMenuPrintableInput,
  normalizeTerminalSelectMenuTextInput,
  normalizeTerminalSelectMenuIndex,
  normalizeTerminalSelectMenuVisibleOptionCount,
  reduceTerminalSelectMenuInlineInput,
  resolveFirstMenuPrefixMatchIndex,
  resolveMenuIndexFromDigits,
  resolveMenuSearchMatchedIndices,
  resolveTerminalSelectMenuItemInputValue,
  resolveTerminalSelectMenuViewport,
  shouldEnableTerminalSelectMenuNumericSelection,
  trimTerminalSelectMenuSearchQuery,
} from "./reducer";

export async function runTerminalSelectMenu(input: TerminalSelectMenuInput): Promise<TerminalSelectMenuResult> {
  if (!process.stdin.isTTY || input.items.length === 0) {
    return { kind: "cancelled" };
  }
  const stdin = process.stdin as unknown as MenuInputStream;
  const setRawMode = stdin.setRawMode;
  const onInput = stdin.on;
  const offInput = stdin.off;
  const resumeInput = stdin.resume;
  if (
    typeof setRawMode !== "function" ||
    typeof onInput !== "function" ||
    typeof offInput !== "function" ||
    typeof resumeInput !== "function"
  ) {
    return { kind: "cancelled" };
  }

  const stdout = process.stdout;
  const stdoutIsTTY = Boolean((stdout as unknown as { isTTY?: boolean }).isTTY);
  const uiRenderer = createCliUiRenderer({
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY,
    terminalColumns: resolveStdoutColumns(),
  });
  let visibleItemIndices = input.items.map((_, index) => index);
  let activeIndex = normalizeTerminalSelectMenuIndex(
    visibleItemIndices.length,
    normalizeTerminalSelectMenuIndex(input.items.length, input.initialIndex),
  );
  let viewportStartIndex = 0;
  let menuSearchMode = false;
  let menuSearchQuery = "";
  let menuInlineInputMode = false;
  const menuInlineInputValues = new Map<string, string>();
  let resolved = false;
  let hasRenderedOpenPreview = false;
  let numericSelectionBuffer = "";
  let numericSelectionTimer: ReturnType<typeof setTimeout> | undefined;
  const transitionController = createTerminalSelectMenuTransitionController({
    surface: createTerminalSelectMenuRenderSurface({ stdout }),
    config: resolveTerminalSelectMenuTransitionConfig({
      env: process.env,
      supportsTransitions: uiRenderer.mode === "interactive_tty",
    }),
    markOpenPreviewRendered: () => {
      if (hasRenderedOpenPreview) {
        return false;
      }
      hasRenderedOpenPreview = true;
      return true;
    },
  });

  const resolveCurrentViewport = (): ReturnType<typeof resolveTerminalSelectMenuViewport> => {
    const viewport = resolveTerminalSelectMenuViewport({
      itemsLength: visibleItemIndices.length,
      activeIndex,
      visibleOptionCount: input.visibleOptionCount,
      previousStartIndex: viewportStartIndex,
      variant: input.variant,
    });
    viewportStartIndex = viewport.startIndex;
    activeIndex = viewport.activeIndex;
    return viewport;
  };

  const resolveActiveSourceIndex = (): number | undefined => {
    if (activeIndex < 0 || activeIndex >= visibleItemIndices.length) {
      return undefined;
    }
    return visibleItemIndices[activeIndex];
  };

  const resolveVisibleItems = (
    viewport: ReturnType<typeof resolveTerminalSelectMenuViewport>,
  ): TerminalSelectMenuItem[] => {
    const activeSourceIndex = resolveActiveSourceIndex();
    return visibleItemIndices
      .slice(viewport.startIndex, viewport.endIndex)
      .map((index) => {
        const item = input.items[index];
        if (!item) {
          return undefined;
        }
        if (!item.input) {
          return item;
        }
        return {
          ...item,
          inputValue: menuInlineInputValues.get(item.id)
            ?? resolveTerminalSelectMenuItemInputValue(item),
          inputActive: menuInlineInputMode && index === activeSourceIndex,
        };
      })
      .filter((item): item is TerminalSelectMenuItem => typeof item !== "undefined");
  };

  const resolveActiveInputItem = (): TerminalSelectMenuItem | undefined => {
    const sourceIndex = resolveActiveSourceIndex();
    if (typeof sourceIndex !== "number") {
      return undefined;
    }
    const item = input.items[sourceIndex];
    return item?.input ? item : undefined;
  };

  const buildRenderableMenu = (): TerminalSelectMenuInput => {
    const viewport = resolveCurrentViewport();
    const visibleItems = resolveVisibleItems(viewport);
    const renderedActiveIndex = normalizeTerminalSelectMenuIndex(
      visibleItems.length,
      activeIndex - viewport.startIndex,
    );
    const searchActive = menuSearchMode || menuSearchQuery.trim().length > 0;
    const baseSubtitle = input.subtitle?.trim();
    const hint = input.hint?.trim() ?? "";
    return {
      ...input,
      subtitle: baseSubtitle && baseSubtitle.length > 0 ? baseSubtitle : undefined,
      hint: hint.length > 0 ? hint : undefined,
      items: visibleItems,
      initialIndex: renderedActiveIndex,
      viewport: {
        startIndex: viewport.startIndex,
        visibleCount: viewport.visibleCount,
        totalCount: viewport.totalCount,
      },
      search: searchActive
        ? {
          active: menuSearchMode,
          query: menuSearchQuery,
          matchedCount: visibleItemIndices.length,
          totalCount: input.items.length,
        }
        : undefined,
    };
  };

  const render = (): void => {
    const renderableMenu = buildRenderableMenu();
    const renderedIndex = normalizeTerminalSelectMenuIndex(
      renderableMenu.items.length,
      renderableMenu.initialIndex,
    );
    const menuLines = uiRenderer.renderSelectMenu(renderableMenu, renderedIndex).split("\n");
    transitionController.renderOpen(menuLines, () => resolved);
  };

  const applyMenuSearchQuery = (nextQueryRaw: string): void => {
    const previousSourceIndex = resolveActiveSourceIndex();
    const normalizedNextQuery = trimTerminalSelectMenuSearchQuery(nextQueryRaw);
    menuSearchQuery = normalizedNextQuery;
    visibleItemIndices = resolveMenuSearchMatchedIndices(menuSearchQuery, input.items);
    if (visibleItemIndices.length === 0) {
      activeIndex = 0;
      render();
      return;
    }
    if (typeof previousSourceIndex === "number") {
      const preservedVisibleIndex = visibleItemIndices.indexOf(previousSourceIndex);
      if (preservedVisibleIndex >= 0) {
        activeIndex = preservedVisibleIndex;
        render();
        return;
      }
    }
    activeIndex = normalizeTerminalSelectMenuIndex(visibleItemIndices.length, 0);
    render();
  };

  const dropMenuSearchLastGrapheme = (): void => {
    if (menuSearchQuery.length === 0) {
      return;
    }
    const graphemes = splitGraphemes(menuSearchQuery);
    if (graphemes.length === 0) {
      return;
    }
    applyMenuSearchQuery(graphemes.slice(0, -1).join(""));
  };

  const clearNumericSelectionBuffer = (): void => {
    numericSelectionBuffer = "";
    if (numericSelectionTimer) {
      clearTimeout(numericSelectionTimer);
      numericSelectionTimer = undefined;
    }
  };

  return await new Promise<TerminalSelectMenuResult>((resolve) => {
    const finalizeTeardown = (result: TerminalSelectMenuResult): void => {
      transitionController.clearCloseTransitionTimers();
      transitionController.surface.clear();
      stdout.write("\x1b[?25h");
      resolve(result);
    };

    const teardownInput = (): void => {
      clearNumericSelectionBuffer();
      transitionController.clearOpenTransitionTimers();
      offInput.call(stdin, "data", onData);
      try {
        setRawMode.call(stdin, false);
      } catch {
        // ignore raw mode teardown errors
      }
    };

    const finish = (result: TerminalSelectMenuResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      teardownInput();
      transitionController.runClose(result, finalizeTeardown);
    };

    const selectAndFinish = (nextVisibleIndex: number): void => {
      if (visibleItemIndices.length === 0) {
        return;
      }
      const resolvedVisibleIndex = normalizeTerminalSelectMenuIndex(visibleItemIndices.length, nextVisibleIndex);
      const sourceIndex = visibleItemIndices[resolvedVisibleIndex];
      if (typeof sourceIndex !== "number" || sourceIndex < 0 || sourceIndex >= input.items.length) {
        return;
      }
      const item = input.items[sourceIndex];
      if (!item) {
        return;
      }
      activeIndex = resolvedVisibleIndex;
      const inputValue = menuInlineInputValues.get(item.id)
        ?? resolveTerminalSelectMenuItemInputValue(item);
      const planApprovalFeedback = input.variant === "plan_approval" && item.id === "approve"
        ? readPlanApprovalFeedbackValue()
        : undefined;
      const resultInputValue = planApprovalFeedback ?? inputValue;
      finish({
        kind: "selected",
        item: item.input ? { ...item, inputValue: resultInputValue } : item,
        index: sourceIndex,
        ...(resultInputValue.length > 0 || item.input
          ? { inputValue: resultInputValue }
          : {}),
      });
    };

    const scheduleNumericSelectionCommit = (): void => {
      if (numericSelectionTimer) {
        clearTimeout(numericSelectionTimer);
      }
      numericSelectionTimer = setTimeout(() => {
        numericSelectionTimer = undefined;
        const index = resolveMenuIndexFromDigits(
          numericSelectionBuffer,
          visibleItemIndices.length,
        );
        if (typeof index === "number") {
          selectAndFinish(index);
          return;
        }
        clearNumericSelectionBuffer();
      }, MENU_DIGIT_SELECTION_COMMIT_DELAY_MS);
    };

    const handleSingleDigitSelection = (digit: string): boolean => {
      const nextDigits = `${numericSelectionBuffer}${digit}`;
      const firstMatchIndex = resolveFirstMenuPrefixMatchIndex(
        nextDigits,
        visibleItemIndices.length,
      );
      if (typeof firstMatchIndex !== "number") {
        clearNumericSelectionBuffer();
        return false;
      }
      numericSelectionBuffer = nextDigits;
      activeIndex = firstMatchIndex;
      const exactIndex = resolveMenuIndexFromDigits(
        numericSelectionBuffer,
        visibleItemIndices.length,
      );
      const canContinue = hasMenuDigitsContinuation(
        numericSelectionBuffer,
        visibleItemIndices.length,
      );
      if (typeof exactIndex === "number" && !canContinue) {
        selectAndFinish(exactIndex);
        return true;
      }
      scheduleNumericSelectionCommit();
      render();
      return true;
    };

    const applyNavigationAction = (action: SelectNavigationAction): void => {
      menuInlineInputMode = false;
      if (visibleItemIndices.length === 0) {
        render();
        return;
      }
      const visibleOptionCount = normalizeTerminalSelectMenuVisibleOptionCount({
        itemsLength: visibleItemIndices.length,
        visibleOptionCount: input.visibleOptionCount,
        variant: input.variant,
      });
      const state = normalizeSelectNavigationState({
        optionCount: visibleItemIndices.length,
        focusedIndex: activeIndex,
        visibleOptionCount,
        previousVisibleFromIndex: viewportStartIndex,
      });
      const nextState = reduceSelectNavigation(state, action);
      activeIndex = nextState.focusedIndex;
      viewportStartIndex = nextState.visibleFromIndex;
      render();
    };

    const readInlineInputValue = (item: TerminalSelectMenuItem): string =>
      menuInlineInputValues.get(item.id) ?? resolveTerminalSelectMenuItemInputValue(item);

    const readPlanApprovalFeedbackValue = (): string | undefined => {
      if (input.variant !== "plan_approval") {
        return undefined;
      }
      const feedbackItem = input.items.find((item) => item.input);
      if (!feedbackItem) {
        return undefined;
      }
      return readInlineInputValue(feedbackItem);
    };

    const finishEditPlan = (
      item: TerminalSelectMenuItem,
      sourceIndex: number,
      inputValue?: string,
    ): void => {
      const resolvedInputValue = inputValue ?? readPlanApprovalFeedbackValue();
      if (!item.input && typeof resolvedInputValue !== "string") {
        finish({ kind: "edit_plan", item, index: sourceIndex });
        return;
      }
      finish({
        kind: "edit_plan",
        item: item.input ? { ...item, inputValue: resolvedInputValue ?? "" } : item,
        index: sourceIndex,
        ...(typeof resolvedInputValue === "string" ? { inputValue: resolvedInputValue } : {}),
      });
    };

    const finishPlanApprovalWithInlineFeedback = (): boolean => {
      if (input.variant !== "plan_approval") {
        return false;
      }
      const inputItem = resolveActiveInputItem();
      if (!inputItem) {
        return false;
      }
      const feedback = readInlineInputValue(inputItem);
      if (feedback.trim().length <= 0) {
        render();
        return true;
      }
      const approveSourceIndex = input.items.findIndex((item) => item.id === "approve");
      const sourceIndex = approveSourceIndex >= 0 ? approveSourceIndex : 0;
      const approveItem = input.items[sourceIndex];
      if (!approveItem) {
        return false;
      }
      finish({
        kind: "selected",
        item: approveItem,
        index: sourceIndex,
        inputValue: feedback,
      });
      return true;
    };

    const applyInlineInputReduction = (
      item: TerminalSelectMenuItem,
      reduction: TerminalSelectMenuInlineInputReduction,
    ): boolean => {
      if (reduction.kind === "ignored") {
        return false;
      }
      if (reduction.kind === "edit_plan") {
        const sourceIndex = resolveActiveSourceIndex() ?? 0;
        finishEditPlan(item, sourceIndex, reduction.value);
        return true;
      }
      if (reduction.kind === "submit") {
        menuInlineInputValues.set(item.id, reduction.value);
        selectAndFinish(activeIndex);
        return true;
      }
      if (reduction.kind === "exit_input") {
        menuInlineInputMode = false;
        render();
        return true;
      }
      if (reduction.kind === "toggle_input") {
        menuInlineInputValues.set(item.id, reduction.value);
        menuInlineInputMode = !menuInlineInputMode;
        render();
        return true;
      }
      menuInlineInputValues.set(item.id, reduction.value);
      menuInlineInputMode = true;
      render();
      return true;
    };

    const handleInlineInputData = (rawInput: string, item: TerminalSelectMenuItem): boolean =>
      applyInlineInputReduction(
        item,
        reduceTerminalSelectMenuInlineInput({
          rawInput,
          item,
          currentValue: readInlineInputValue(item),
          inputMode: menuInlineInputMode,
          variant: input.variant,
        }),
      );

    const onData = (chunk: string): void => {
      const rawInput = String(chunk ?? "");
      const numericSelectionEnabled = shouldEnableTerminalSelectMenuNumericSelection(input);
      if (
        isPlanApprovalInlineFeedbackApproveShortcut(rawInput)
        && finishPlanApprovalWithInlineFeedback()
      ) {
        return;
      }
      if (rawInput === "\u0007" && isPlanApprovalExternalEditEnabled(input)) {
        const sourceIndex = resolveActiveSourceIndex() ?? 0;
        const item = input.items[sourceIndex] ?? input.items[0];
        if (item) {
          finishEditPlan(item, sourceIndex);
        }
        return;
      }
      const activeInputItem = resolveActiveInputItem();
      if (
        shouldRouteTerminalSelectMenuInlineInputBeforeMode({
          rawInput,
          menuSearchMode,
          hasActiveInputItem: Boolean(activeInputItem),
        })
        && activeInputItem
        && handleInlineInputData(rawInput, activeInputItem)
      ) {
        return;
      }
      if (
        !menuSearchMode
        && menuInlineInputMode
        && activeInputItem
        && handleInlineInputData(rawInput, activeInputItem)
      ) {
        return;
      }
      if (rawInput === MENU_SEARCH_TOGGLE_CONTROL || (!menuSearchMode && rawInput === "/")) {
        menuSearchMode = !menuSearchMode || rawInput === "/";
        render();
        return;
      }
      if (rawInput === MENU_SEARCH_CLEAR_CONTROL && (menuSearchMode || menuSearchQuery.length > 0)) {
        applyMenuSearchQuery("");
        menuSearchMode = true;
        return;
      }
      if (menuSearchMode) {
        if (rawInput === "\u001b") {
          menuSearchMode = false;
          render();
          return;
        }
        if (rawInput === "\u007f" || rawInput === "\b") {
          dropMenuSearchLastGrapheme();
          return;
        }
        const normalizedSearchInput = normalizeTerminalSelectMenuTextInput(rawInput);
        if (normalizedSearchInput.length > 0) {
          applyMenuSearchQuery(`${menuSearchQuery}${normalizedSearchInput}`);
          return;
        }
      }
      if (numericSelectionEnabled && /^[0-9]$/.test(rawInput)) {
        if (handleSingleDigitSelection(rawInput)) {
          return;
        }
      } else {
        clearNumericSelectionBuffer();
      }
      if (numericSelectionEnabled && /^[0-9]{2,}$/.test(rawInput.trim())) {
        const bufferedIndex = resolveMenuIndexFromDigits(
          rawInput.trim(),
          visibleItemIndices.length,
        );
        if (typeof bufferedIndex === "number") {
          selectAndFinish(bufferedIndex);
        }
        return;
      }
      const action = decodeTerminalSelectMenuInput(chunk, visibleItemIndices.length);
      if (action.kind === "up") {
        applyNavigationAction({ type: "previous" });
        return;
      }
      if (action.kind === "down") {
        applyNavigationAction({ type: "next" });
        return;
      }
      if (action.kind === "page_up") {
        applyNavigationAction({ type: "page_up" });
        return;
      }
      if (action.kind === "page_down") {
        applyNavigationAction({ type: "page_down" });
        return;
      }
      if (action.kind === "select_index") {
        if (!numericSelectionEnabled) {
          return;
        }
        selectAndFinish(action.index);
        return;
      }
      if (action.kind === "enter") {
        if (visibleItemIndices.length === 0) {
          render();
          return;
        }
        const item = resolveActiveInputItem();
        if (item && handleInlineInputData(rawInput, item)) {
          return;
        }
        selectAndFinish(activeIndex);
        return;
      }
      if (action.kind === "edit_plan") {
        if (isPlanApprovalExternalEditEnabled(input)) {
          const sourceIndex = resolveActiveSourceIndex() ?? 0;
          const item = input.items[sourceIndex] ?? input.items[0];
          if (item) {
            finishEditPlan(item, sourceIndex);
          }
        }
        return;
      }
      if (action.kind === "cancel") {
        if (menuSearchMode) {
          menuSearchMode = false;
          render();
          return;
        }
        if (menuSearchQuery.length > 0) {
          applyMenuSearchQuery("");
          return;
        }
        finish({ kind: "cancelled" });
      }
    };

    stdout.write("\x1b[?25l");
    stdin.setEncoding?.("utf8");
    onInput.call(stdin, "data", onData);
    try {
      setRawMode.call(stdin, true);
    } catch {
      finish({ kind: "cancelled" });
      return;
    }
    resumeInput.call(stdin);
    render();
  });
}
