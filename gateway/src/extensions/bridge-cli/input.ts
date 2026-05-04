import { removeTrailingSlashes } from "../../cli/services/runtime-paths";
import type { BridgeInput } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseJsonInput(raw: string): BridgeInput {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error("bridge input must be an object");
  }
  if (!isString(parsed.userMessage)) {
    throw new Error("userMessage is required");
  }
  if (!isObject(parsed.session)) {
    throw new Error("session is required");
  }
  if (!isObject(parsed.context)) {
    throw new Error("context is required");
  }
  const platform = parsed.session.platform;
  const tenant = parsed.session.tenant;
  const scope = parsed.session.scope;
  const subject = parsed.session.subject;
  if (platform !== "feishu" && platform !== "telegram") {
    throw new Error("session.platform must be feishu or telegram");
  }
  if (scope !== "dm" && scope !== "group") {
    throw new Error("session.scope must be dm or group");
  }
  if (!isString(tenant) || !isString(subject)) {
    throw new Error("session.tenant and session.subject are required");
  }
  if (!isString(parsed.context.actorId) || !isString(parsed.context.projectId)) {
    throw new Error("context.actorId and context.projectId are required");
  }
  const migration = isObject(parsed.migration) ? parsed.migration : undefined;
  const workDir = isString(parsed.workDir) ? parsed.workDir.trim() : undefined;
  return {
    userMessage: parsed.userMessage,
    session: {
      platform,
      tenant,
      scope,
      subject,
    },
    context: {
      actorId: parsed.context.actorId,
      projectId: parsed.context.projectId,
    },
    workDir,
    migration,
  };
}

export function resolvePlanSessionId(session: BridgeInput["session"]): string {
  return `${session.platform}:${session.tenant}:${session.scope}:${session.subject}`;
}

export function resolveWorkDir(input: BridgeInput): string {
  if (input.workDir && input.workDir.trim().length > 0) {
    return removeTrailingSlashes(input.workDir.trim());
  }
  return removeTrailingSlashes(process.cwd());
}

export function isPlanSlashCommand(message: string): boolean {
  return /^\/plan(?:\s|$)/.test(message.trim());
}
