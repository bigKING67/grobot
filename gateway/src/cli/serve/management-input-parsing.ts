import { type ServerResponse } from "node:http";
import { type ManagementRoutesContext } from "./management-routes-types";

export type QueryParams = Record<string, string[]>;

export type ParseInputResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  error: string;
  field: string;
  detail: string;
};

function invalidInput(field: string, detail: string): ParseInputResult<never> {
  return {
    ok: false,
    error: `invalid_${field.replace(/[^a-zA-Z0-9]+/g, "_")}`,
    field,
    detail,
  };
}

export function writeManagementInputError(
  response: ServerResponse,
  context: ManagementRoutesContext,
  error: Extract<ParseInputResult<never>, { ok: false }>,
): true {
  context.writeJson(response, 400, {
    error: error.error,
    field: error.field,
    detail: error.detail,
  });
  return true;
}

function queryValue(query: QueryParams, key: string): string | undefined {
  const values = query[key];
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  return values[0];
}

function parseBoolToken(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
}

export function queryBool(
  query: QueryParams,
  key: string,
  defaultValue: boolean,
): ParseInputResult<boolean> {
  const raw = queryValue(query, key);
  if (raw === undefined) {
    return {
      ok: true,
      value: defaultValue,
    };
  }
  const parsed = parseBoolToken(raw);
  if (typeof parsed !== "boolean") {
    return invalidInput(key, `${key} must be boolean`);
  }
  return {
    ok: true,
    value: parsed,
  };
}

export function queryInt(
  query: QueryParams,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): ParseInputResult<number> {
  const raw = queryValue(query, key);
  if (raw === undefined) {
    return {
      ok: true,
      value: defaultValue,
    };
  }
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return invalidInput(key, `${key} must be an integer between ${String(minimum)} and ${String(maximum)}`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    return invalidInput(key, `${key} must be an integer between ${String(minimum)} and ${String(maximum)}`);
  }
  return {
    ok: true,
    value: parsed,
  };
}

export function bodyBool(
  body: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): ParseInputResult<boolean> {
  const raw = body[key];
  if (raw === undefined) {
    return {
      ok: true,
      value: defaultValue,
    };
  }
  if (typeof raw === "boolean") {
    return {
      ok: true,
      value: raw,
    };
  }
  if (typeof raw === "number") {
    if (raw === 1) {
      return {
        ok: true,
        value: true,
      };
    }
    if (raw === 0) {
      return {
        ok: true,
        value: false,
      };
    }
    return invalidInput(key, `${key} must be boolean`);
  }
  if (typeof raw === "string") {
    const parsed = parseBoolToken(raw);
    if (typeof parsed === "boolean") {
      return {
        ok: true,
        value: parsed,
      };
    }
  }
  return invalidInput(key, `${key} must be boolean`);
}

export function bodyPositiveInt(
  body: Record<string, unknown>,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): ParseInputResult<number> {
  const raw = body[key];
  if (raw === undefined) {
    return {
      ok: true,
      value: defaultValue,
    };
  }
  let parsed: number | undefined;
  if (typeof raw === "number" && Number.isInteger(raw)) {
    parsed = raw;
  } else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    parsed = Number.parseInt(raw.trim(), 10);
  }
  if (parsed === undefined || !Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    return invalidInput(key, `${key} must be an integer between ${String(minimum)} and ${String(maximum)}`);
  }
  return {
    ok: true,
    value: parsed,
  };
}
