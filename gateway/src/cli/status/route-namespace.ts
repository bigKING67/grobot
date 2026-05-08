import { type Platform, type SessionKeyParts, type SessionScope } from "../../models/types";

export class RouteDecisionNamespaceInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string, detail: string) {
    super(detail);
    this.name = "RouteDecisionNamespaceInputError";
    this.code = code;
    this.field = field;
  }
}

export function isRouteDecisionNamespaceInputError(
  error: unknown,
): error is RouteDecisionNamespaceInputError {
  return error instanceof RouteDecisionNamespaceInputError;
}

function resolveMaybeProvidedValue(input: {
  value: string | undefined;
  fallback?: string;
  provided?: boolean;
}): string | undefined {
  if (input.value !== undefined) {
    return input.value.trim();
  }
  if (input.provided) {
    return "";
  }
  return input.fallback;
}

export function resolveRouteDecisionPlatform(input: {
  value: string | undefined;
  fallback?: string;
  provided?: boolean;
}): Platform {
  const raw = resolveMaybeProvidedValue(input);
  if (raw === undefined) {
    return "feishu";
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "feishu" || normalized === "telegram") {
    return normalized;
  }
  throw new RouteDecisionNamespaceInputError(
    "invalid_session_platform",
    "platform",
    "platform must be one of: feishu, telegram",
  );
}

export function resolveRouteDecisionScope(input: {
  value: string | undefined;
  fallback?: string;
  provided?: boolean;
}): SessionScope {
  const raw = resolveMaybeProvidedValue(input);
  if (raw === undefined) {
    return "dm";
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "dm" || normalized === "group") {
    return normalized;
  }
  throw new RouteDecisionNamespaceInputError(
    "invalid_session_scope",
    "session-scope",
    "session-scope must be one of: dm, group",
  );
}

export function resolveRouteDecisionSessionSegment(input: {
  value: string | undefined;
  fallback: string;
  provided?: boolean;
  field: "tenant" | "session-subject";
}): string {
  const value = (resolveMaybeProvidedValue(input) ?? input.fallback).trim();
  if (value.length === 0) {
    throw new RouteDecisionNamespaceInputError(
      input.field === "tenant" ? "invalid_session_tenant" : "invalid_session_subject",
      input.field,
      `${input.field} must be non-empty`,
    );
  }
  if (value.includes(":")) {
    throw new RouteDecisionNamespaceInputError(
      input.field === "tenant" ? "invalid_session_tenant" : "invalid_session_subject",
      input.field,
      `${input.field} must not contain ':'`,
    );
  }
  return value;
}

export function resolveRouteDecisionSessionNamespace(input: {
  platform: {
    value: string | undefined;
    fallback?: string;
    provided?: boolean;
  };
  tenant: {
    value: string | undefined;
    fallback: string;
    provided?: boolean;
  };
  scope: {
    value: string | undefined;
    fallback?: string;
    provided?: boolean;
  };
  subject: {
    value: string | undefined;
    fallback: string;
    provided?: boolean;
  };
}): SessionKeyParts {
  return {
    platform: resolveRouteDecisionPlatform(input.platform),
    tenant: resolveRouteDecisionSessionSegment({
      ...input.tenant,
      field: "tenant",
    }),
    scope: resolveRouteDecisionScope(input.scope),
    subject: resolveRouteDecisionSessionSegment({
      ...input.subject,
      field: "session-subject",
    }),
  };
}

export function formatRouteDecisionSessionKey(parts: SessionKeyParts): string {
  return `${parts.platform}:${parts.tenant}:${parts.scope}:${parts.subject}`;
}

export function buildRouteDecisionSessionKey(input: Parameters<typeof resolveRouteDecisionSessionNamespace>[0]): string {
  return formatRouteDecisionSessionKey(resolveRouteDecisionSessionNamespace(input));
}
