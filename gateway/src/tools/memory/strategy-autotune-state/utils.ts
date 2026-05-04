import type { MemoryStrategyAutotuneState } from "./contract";

export function stateEquals(
  left: MemoryStrategyAutotuneState,
  right: MemoryStrategyAutotuneState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mixEma(previous: number, next: number, alpha: number): number {
  return Number((((1 - alpha) * previous) + (alpha * next)).toFixed(6));
}

export function stepToward(current: number, target: number, step: number): number {
  if (Math.abs(current - target) <= step) {
    return target;
  }
  if (current < target) {
    return current + step;
  }
  return current - step;
}
