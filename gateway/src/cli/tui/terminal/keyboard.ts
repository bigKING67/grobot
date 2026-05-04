export interface CoalescedSubmitChunkResolution {
  normalizedChunk: string;
  shouldSubmit: boolean;
}

export type InteractiveEnterDataAction = "none" | "defer_to_keypress" | "submit";

export function resolveCoalescedSubmitChunk(
  chunkRaw: string,
): CoalescedSubmitChunkResolution {
  const chunk = String(chunkRaw ?? "");
  const trailingLength = chunk.endsWith("\r\n")
    ? 2
    : chunk.endsWith("\r") || chunk.endsWith("\n")
      ? 1
      : 0;
  if (trailingLength === 0) {
    return {
      normalizedChunk: chunk,
      shouldSubmit: false,
    };
  }
  const payload = chunk.slice(0, chunk.length - trailingLength);
  if (
    payload.includes("\r")
    || payload.includes("\n")
    || payload.endsWith("\\")
    || payload.includes("\u001b")
  ) {
    return {
      normalizedChunk: chunk,
      shouldSubmit: false,
    };
  }
  return {
    normalizedChunk: payload,
    shouldSubmit: true,
  };
}

export function isPlainEnterDataChunk(chunkRaw: string): boolean {
  const chunk = String(chunkRaw ?? "");
  return chunk === "\r" || chunk === "\n" || chunk === "\r\n";
}

export function resolveInteractiveEnterDataAction(input: {
  chunk: string;
  keypressSupported: boolean;
  keypressHandledRecently?: boolean;
}): InteractiveEnterDataAction {
  if (!isPlainEnterDataChunk(input.chunk)) {
    return "none";
  }
  if (!input.keypressSupported) {
    return "submit";
  }
  return input.keypressHandledRecently ? "none" : "defer_to_keypress";
}
