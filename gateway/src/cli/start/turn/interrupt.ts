export const TURN_INTERRUPTED_ERROR_CLASS = "turn_interrupted";
export const TURN_INTERRUPTED_EXIT_CODE = 130;

export function sleepAsync(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }
  if (signal?.aborted) {
    return Promise.reject(
      new Error(`turn interrupted class=${TURN_INTERRUPTED_ERROR_CLASS} detail=aborted_before_backoff_sleep`),
    );
  }
  return new Promise((resolve, reject) => {
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, delayMs);
    onAbort = (): void => {
      clearTimeout(timer);
      reject(
        new Error(`turn interrupted class=${TURN_INTERRUPTED_ERROR_CLASS} detail=aborted_during_backoff_sleep`),
      );
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export function throwIfTurnInterrupted(signal: AbortSignal | undefined, detail: string): void {
  if (signal?.aborted) {
    throw new Error(`turn interrupted class=${TURN_INTERRUPTED_ERROR_CLASS} detail=${detail}`);
  }
}
