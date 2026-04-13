import { readFileSync } from "node:fs";

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  const remain = value.length - limit;
  return `${value.slice(0, limit)}\n...<truncated ${remain} chars>`;
}

function maskSensitiveText(raw: string): string {
  const maskedLines = raw.split(/\r?\n/).map((line) => {
    const kvMasked = line.replace(
      /^(\s*[A-Za-z0-9_.-]*?(?:api[_-]?key|token|secret|password|authorization|access[_-]?token|refresh[_-]?token)[A-Za-z0-9_.-]*\s*=\s*).+$/i,
      '$1"<redacted>"',
    );
    return kvMasked
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer <redacted>")
      .replace(/\b(?:sk|gsk|rk|pk)-[A-Za-z0-9]{10,}\b/g, "<redacted>");
  });
  return maskedLines.join("\n");
}

export function maskSecret(raw: string | undefined): string {
  if (!raw) {
    return "<unset>";
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return "<unset>";
  }
  if (trimmed.length <= 6) {
    return "<redacted>";
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

export function readMaskedFile(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  try {
    const raw = readFileSync(path, "utf8");
    return truncateText(maskSensitiveText(raw), 20_000);
  } catch {
    return undefined;
  }
}
