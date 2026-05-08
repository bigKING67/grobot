export interface BindConfig {
  host: string;
  port: number;
}

export class BindConfigInputError extends Error {
  readonly code = "invalid_bind";
  readonly field = "bind";

  constructor(detail: string) {
    super(detail);
    this.name = "BindConfigInputError";
  }
}

export function isBindConfigInputError(error: unknown): error is BindConfigInputError {
  return error instanceof BindConfigInputError;
}

export function parseBind(raw: string | undefined, provided = false): BindConfig {
  const defaultBind: BindConfig = { host: "127.0.0.1", port: 8080 };
  if (raw === undefined) {
    if (provided) {
      throw new BindConfigInputError("bind must be host:port");
    }
    return defaultBind;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BindConfigInputError("bind must be host:port");
  }
  const idx = trimmed.lastIndexOf(":");
  if (idx <= 0 || idx >= trimmed.length - 1) {
    throw new BindConfigInputError("bind must be host:port");
  }
  const host = trimmed.slice(0, idx).trim();
  if (!host) {
    throw new BindConfigInputError("bind host must be non-empty");
  }
  const port = Number(trimmed.slice(idx + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new BindConfigInputError("bind port must be an integer between 0 and 65535");
  }
  return {
    host,
    port,
  };
}
