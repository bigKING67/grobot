import { type PromptOverflowClassification } from "../types";

const OVERFLOW_MARKERS = [
  "prompt_too_long",
  "context_length_exceeded",
  "context length exceeded",
  "maximum context length",
  "status=413",
  "status 413",
  "request entity too large",
  "token limit",
];

export function classifyPromptOverflow(
  errorClass: string,
  errorMessage: string,
): PromptOverflowClassification {
  const normalizedClass = errorClass.trim().toLowerCase();
  const normalizedMessage = errorMessage.trim().toLowerCase();
  if (normalizedClass === "prompt_too_long") {
    return { overflow: true, reason: "prompt_too_long" };
  }
  if (normalizedClass === "context_length_exceeded") {
    return { overflow: true, reason: "context_length_exceeded" };
  }
  if (
    normalizedClass === "upstream_http_error" &&
    (normalizedMessage.includes("status=413") || normalizedMessage.includes("status 413"))
  ) {
    return { overflow: true, reason: "status_413" };
  }
  for (const marker of OVERFLOW_MARKERS) {
    if (normalizedMessage.includes(marker)) {
      if (marker.includes("413")) {
        return { overflow: true, reason: "status_413" };
      }
      if (marker.includes("context_length_exceeded")) {
        return { overflow: true, reason: "context_length_exceeded" };
      }
      return { overflow: true, reason: "prompt_too_long" };
    }
  }
  return {
    overflow: false,
    reason: "none",
  };
}
