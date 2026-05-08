import { type OptionValue } from "../cli-args";
import { type SessionKeyParts } from "../../models/types";
import {
  formatRouteDecisionSessionKey,
  resolveRouteDecisionSessionNamespace,
} from "./route-namespace";

function hasOption(options: Record<string, OptionValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function hasAnyOption(options: Record<string, OptionValue>, keys: readonly string[]): boolean {
  return keys.some((key) => hasOption(options, key));
}

function readRawOptionString(options: Record<string, OptionValue>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function readRawOptionStringAny(
  options: Record<string, OptionValue>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readRawOptionString(options, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export interface StatusRouteNamespace {
  sessionNamespace: SessionKeyParts;
  sessionPreview: string;
  sessionSubject: string;
}

export function resolveStatusRouteNamespace(input: {
  options: Record<string, OptionValue>;
  projectName: string;
  defaultSubject: string;
}): StatusRouteNamespace {
  const sessionSubjectOptionRaw = readRawOptionStringAny(input.options, [
    "session-subject",
    "subject",
  ]);
  const sessionNamespace = resolveRouteDecisionSessionNamespace({
    platform: {
      value: readRawOptionString(input.options, "platform"),
      fallback: undefined,
      provided: hasOption(input.options, "platform"),
    },
    tenant: {
      value: readRawOptionString(input.options, "tenant"),
      fallback: input.projectName,
      provided: hasOption(input.options, "tenant"),
    },
    scope: {
      value: readRawOptionStringAny(input.options, ["session-scope", "scope"]),
      fallback: undefined,
      provided: hasAnyOption(input.options, ["session-scope", "scope"]),
    },
    subject: {
      value: sessionSubjectOptionRaw,
      fallback: input.defaultSubject,
      provided: hasAnyOption(input.options, ["session-subject", "subject"]),
    },
  });
  return {
    sessionNamespace,
    sessionPreview: formatRouteDecisionSessionKey(sessionNamespace),
    sessionSubject: sessionSubjectOptionRaw?.trim() || input.defaultSubject,
  };
}
