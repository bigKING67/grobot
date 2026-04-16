import { readFileSync } from "node:fs";

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  const remain = value.length - limit;
  return `${value.slice(0, limit)}\n...<truncated ${remain} chars>`;
}

export function redactSensitiveText(raw: string): string {
  const maskedLines = raw.split(/\r?\n/).map((line) => {
    const kvMasked = line.replace(
      /^(\s*[A-Za-z0-9_.-]*?(?:api[_-]?key|token|secret|password|authorization|access[_-]?token|refresh[_-]?token)[A-Za-z0-9_.-]*\s*=\s*).+$/i,
      '$1"<redacted>"',
    );
    return kvMasked
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer <redacted>")
      .replace(/\b(?:sk|gsk|rk|pk)-[A-Za-z0-9]{10,}\b/g, "<redacted>")
      .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, "<redacted>")
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<redacted-jwt>")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<redacted-email>")
      .replace(/\b1[3-9]\d{9}\b/g, "<redacted-phone>")
      .replace(/(?<=cookie[:=]\s*)([^;,\s]{6,})/gi, "<redacted-cookie>")
      .replace(/([?&](?:token|api_key|apikey|access_token|refresh_token|password)=)[^&\s]+/gi, "$1<redacted>");
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
    return truncateText(redactSensitiveText(raw), 20_000);
  } catch {
    return undefined;
  }
}
