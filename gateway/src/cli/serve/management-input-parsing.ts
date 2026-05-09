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

export function queryCsvEnum<T extends string>(
  query: QueryParams,
  key: string,
  defaultValue: readonly T[],
  allowedValues: readonly T[],
  detail: string,
): ParseInputResult<T[]> {
  const raw = queryValue(query, key);
  if (raw === undefined) {
    return {
      ok: true,
      value: [...defaultValue],
    };
  }
  const tokens = raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  const allowed = new Set<string>(allowedValues);
  const values: T[] = [];
  for (const token of tokens) {
    if (!allowed.has(token)) {
      return invalidInput(key, detail);
    }
    const value = token as T;
    if (!values.includes(value)) {
      values.push(value);
    }
  }
  if (values.length === 0) {
    return invalidInput(key, detail);
  }
  return {
    ok: true,
    value: values,
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

export function bodyOptionalNonEmptyString(
  body: Record<string, unknown>,
  key: string,
): ParseInputResult<string | undefined> {
  const raw = body[key];
  if (raw === undefined) {
    return {
      ok: true,
      value: undefined,
    };
  }
  if (typeof raw !== "string") {
    return invalidInput(key, `${key} must be a non-empty string`);
  }
  const value = raw.trim();
  if (!value) {
    return invalidInput(key, `${key} must be a non-empty string`);
  }
  return {
    ok: true,
    value,
  };
}

export function bodyStringArray(
  body: Record<string, unknown>,
  key: string,
): ParseInputResult<string[]> {
  const raw = body[key];
  if (raw === undefined) {
    return {
      ok: true,
      value: [],
    };
  }
  if (!Array.isArray(raw)) {
    return invalidInput(key, `${key} must be an array of non-empty strings`);
  }
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return invalidInput(key, `${key} entries must be non-empty strings`);
    }
    const cleaned = item.trim();
    if (!cleaned) {
      return invalidInput(key, `${key} entries must be non-empty strings`);
    }
    if (!values.includes(cleaned)) {
      values.push(cleaned);
    }
  }
  return {
    ok: true,
    value: values,
  };
}
