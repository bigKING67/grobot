import {
  decodeMenuInput,
  hasMenuDigitsContinuation,
  resolveFirstMenuPrefixMatchIndex,
  resolveMenuIndexFromDigits,
  resolveMenuSearchMatchedIndices,
  resolveTerminalSelectMenuViewport,
} from "../../../cli/tui/components/select-menu/controller";
import {
  normalizeSelectNavigationState,
  reduceSelectNavigation,
} from "../../../cli/tui/components/select-menu/reducer";
import type { ContractPayload } from "./helpers";

export function runMenuKeybindingChecks(): ContractPayload {
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

  return {
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
  };
}
