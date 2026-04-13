export interface BindConfig {
  host: string;
  port: number;
}

export function parseBind(raw: string | undefined): BindConfig {
  const defaultBind: BindConfig = { host: "127.0.0.1", port: 8080 };
  if (!raw) {
    return defaultBind;
  }
  const trimmed = raw.trim();
  const idx = trimmed.lastIndexOf(":");
  if (idx <= 0 || idx >= trimmed.length - 1) {
    return defaultBind;
  }
  const host = trimmed.slice(0, idx);
  const port = Number(trimmed.slice(idx + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return defaultBind;
  }
  return {
    host,
    port,
  };
}
