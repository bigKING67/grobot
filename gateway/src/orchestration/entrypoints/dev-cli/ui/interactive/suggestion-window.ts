export interface VisibleSuggestionWindowInput<T> {
  items: readonly T[];
  selectedIndex: number;
  visibleCount: number;
}

export interface VisibleSuggestionWindow<T> {
  startIndex: number;
  endIndex: number;
  selectedIndex: number;
  selectedVisibleIndex: number;
  visibleItems: readonly T[];
}

export function normalizeSuggestionIndex(itemsLength: number, index: number): number {
  if (itemsLength <= 0) {
    return 0;
  }
  const normalized = index % itemsLength;
  if (normalized < 0) {
    return normalized + itemsLength;
  }
  return normalized;
}

export function resolveVisibleSuggestionWindow<T>(
  input: VisibleSuggestionWindowInput<T>,
): VisibleSuggestionWindow<T> {
  const itemsLength = input.items.length;
  if (itemsLength <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      selectedIndex: 0,
      selectedVisibleIndex: 0,
      visibleItems: [],
    };
  }
  const selectedIndex = normalizeSuggestionIndex(itemsLength, input.selectedIndex);
  const visibleCount = Math.max(1, Math.min(Math.floor(input.visibleCount), itemsLength));
  const maxStart = Math.max(0, itemsLength - visibleCount);
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleCount / 2),
      maxStart,
    ),
  );
  const endIndex = startIndex + visibleCount;
  return {
    startIndex,
    endIndex,
    selectedIndex,
    selectedVisibleIndex: selectedIndex - startIndex,
    visibleItems: input.items.slice(startIndex, endIndex),
  };
}
