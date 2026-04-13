import { readFileSync } from "node:fs";
import { runGatewayTurn } from "../orchestration/main";
import { MigrationOptions, SessionKeyParts } from "../models/types";

interface BridgeInput {
  userMessage: string;
  session: SessionKeyParts;
  context: {
    actorId: string;
    projectId: string;
  };
  migration?: Partial<MigrationOptions>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJsonInput(raw: string): BridgeInput {
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
  const migration = isObject(parsed.migration) ? (parsed.migration as Partial<MigrationOptions>) : undefined;
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
    migration,
  };
}

async function main(): Promise<number> {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) {
    process.stderr.write("bridge input is empty\n");
    return 1;
  }
  try {
    const input = parseJsonInput(raw);
    const report = await runGatewayTurn(
      input.userMessage,
      input.session,
      input.context,
      input.migration,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          assistant_message: report.assistantMessage,
          report,
        },
        null,
        0,
      )}\n`,
    );
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ status: "error", detail })}\n`);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
