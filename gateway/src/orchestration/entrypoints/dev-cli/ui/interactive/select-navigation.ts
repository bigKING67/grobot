export type SelectNavigationInitialPlacement = "end" | "center";

export interface SelectNavigationState {
  optionCount: number;
  focusedIndex: number;
  visibleFromIndex: number;
  visibleToIndex: number;
  visibleOptionCount: number;
}

export type SelectNavigationAction =
  | { type: "previous" }
  | { type: "next" }
  | { type: "page_up" }
  | { type: "page_down" }
  | { type: "focus_index"; index: number }
  | { type: "set_options"; optionCount: number; focusedIndex?: number };

function normalizeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapIndex(optionCount: number, focusedIndex: number): number {
  if (optionCount <= 0) {
    return 0;
  }
  const normalized = focusedIndex % optionCount;
  return normalized < 0 ? normalized + optionCount : normalized;
}

export function normalizeSelectNavigationState(input: {
  optionCount: number;
  focusedIndex: number;
  visibleOptionCount: number;
  previousVisibleFromIndex?: number;
  initialPlacement?: SelectNavigationInitialPlacement;
}): SelectNavigationState {
  const optionCount = normalizeCount(input.optionCount);
  if (optionCount <= 0) {
    return {
      optionCount: 0,
      focusedIndex: 0,
      visibleFromIndex: 0,
      visibleToIndex: 0,
      visibleOptionCount: 0,
    };
  }
  const visibleOptionCount = Math.max(
    1,
    Math.min(optionCount, normalizeCount(input.visibleOptionCount)),
  );
  const focusedIndex = wrapIndex(optionCount, input.focusedIndex);
  const maxStart = Math.max(0, optionCount - visibleOptionCount);
  const fallbackStart = input.initialPlacement === "center"
    ? focusedIndex - Math.floor(visibleOptionCount / 2)
    : focusedIndex - visibleOptionCount + 1;
  let visibleFromIndex =
    typeof input.previousVisibleFromIndex === "number" && Number.isFinite(input.previousVisibleFromIndex)
      ? Math.floor(input.previousVisibleFromIndex)
      : fallbackStart;
  visibleFromIndex = clamp(visibleFromIndex, 0, maxStart);
  if (focusedIndex < visibleFromIndex) {
    visibleFromIndex = focusedIndex;
  } else if (focusedIndex >= visibleFromIndex + visibleOptionCount) {
    visibleFromIndex = focusedIndex - visibleOptionCount + 1;
  }
  visibleFromIndex = clamp(visibleFromIndex, 0, maxStart);
  return {
    optionCount,
    focusedIndex,
    visibleFromIndex,
    visibleToIndex: Math.min(optionCount, visibleFromIndex + visibleOptionCount),
    visibleOptionCount,
  };
}

export function reduceSelectNavigation(
  state: SelectNavigationState,
  action: SelectNavigationAction,
): SelectNavigationState {
  if (state.optionCount <= 0) {
    return normalizeSelectNavigationState({
      optionCount: 0,
      focusedIndex: 0,
      visibleOptionCount: 0,
    });
  }
  const nextFocusedIndex = (() => {
    if (action.type === "previous") {
      return wrapIndex(state.optionCount, state.focusedIndex - 1);
    }
    if (action.type === "next") {
      return wrapIndex(state.optionCount, state.focusedIndex + 1);
    }
    if (action.type === "page_up") {
      return clamp(state.focusedIndex - Math.max(1, state.visibleOptionCount), 0, state.optionCount - 1);
    }
    if (action.type === "page_down") {
      return clamp(state.focusedIndex + Math.max(1, state.visibleOptionCount), 0, state.optionCount - 1);
    }
    if (action.type === "focus_index") {
      return wrapIndex(state.optionCount, action.index);
    }
    return wrapIndex(
      normalizeCount(action.optionCount),
      action.focusedIndex ?? state.focusedIndex,
    );
  })();
  const nextOptionCount = action.type === "set_options"
    ? normalizeCount(action.optionCount)
    : state.optionCount;
  return normalizeSelectNavigationState({
    optionCount: nextOptionCount,
    focusedIndex: nextFocusedIndex,
    visibleOptionCount: state.visibleOptionCount,
    previousVisibleFromIndex: state.visibleFromIndex,
  });
}
