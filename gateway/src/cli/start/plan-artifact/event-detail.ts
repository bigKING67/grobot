export function extractDetailToken(
  detail: string,
  key: string,
): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`);
  const matched = pattern.exec(detail);
  const value = matched?.[1]?.trim();
  if (!value) {
    return undefined;
  }
  return value;
}

export function parseDetailBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "yes" || value === "true") {
    return true;
  }
  if (value === "no" || value === "false") {
    return false;
  }
  return undefined;
}

export function encodeDetailValue(raw: string): string {
  return encodeURIComponent(raw.trim());
}

export function decodeDetailValue(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  if (!raw.trim()) {
    return undefined;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
