import { IncomingMessage, ServerResponse } from "node:http";

export type QueryParams = Record<string, string[]>;

export function parseQueryParams(rawUrl: string): QueryParams {
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex < 0 || queryIndex >= rawUrl.length - 1) {
    return {};
  }
  const rawQuery = rawUrl.slice(queryIndex + 1);
  const query: QueryParams = {};
  for (const pair of rawQuery.split("&")) {
    if (!pair) {
      continue;
    }
    const eqIndex = pair.indexOf("=");
    const rawKey = eqIndex >= 0 ? pair.slice(0, eqIndex) : pair;
    const rawValue = eqIndex >= 0 ? pair.slice(eqIndex + 1) : "";
    const decodeSafe = (value: string): string => {
      try {
        return decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        return value;
      }
    };
    const key = decodeSafe(rawKey).trim();
    const value = decodeSafe(rawValue).trim();
    if (!key) {
      continue;
    }
    const items = query[key] ?? [];
    items.push(value);
    query[key] = items;
  }
  return query;
}

export function parseJsonObjectBody(rawBody: string): {
  ok: true;
  body: Record<string, unknown>;
} | {
  ok: false;
  detail: string;
} {
  if (!rawBody.trim()) {
    return {
      ok: true,
      body: {},
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error) {
    return {
      ok: false,
      detail: `Invalid JSON body: ${String(error)}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      detail: "JSON body must be an object",
    };
  }
  return {
    ok: true,
    body: parsed as Record<string, unknown>,
  };
}

export function utf8ByteLength(value: string): number {
  return new Blob([value]).size;
}

export function writeJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  const bodyBytes = utf8ByteLength(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Content-Length", String(bodyBytes));
  response.end(body);
}

export function readHeaderValue(headers: IncomingMessage["headers"], key: string): string | undefined {
  const value = headers[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") {
      return first;
    }
  }
  return undefined;
}

export function parseBearerToken(headers: IncomingMessage["headers"]): string | undefined {
  const auth = readHeaderValue(headers, "authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const xToken = readHeaderValue(headers, "x-grobot-token");
  if (typeof xToken === "string" && xToken.trim().length > 0) {
    return xToken.trim();
  }
  return undefined;
}

export function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      resolve(raw);
    });
  });
}
