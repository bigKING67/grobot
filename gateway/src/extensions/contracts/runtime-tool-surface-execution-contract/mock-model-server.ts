import { createServer, type IncomingMessage } from "node:http";
import { isRecord, parseJson } from "./assertions";
import type { MockModelCall, ToolCallSpec } from "./types";

function readUtf8Body(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: string[] = [];
    request.on("data", (chunk) => {
      chunks.push(String(chunk));
    });
    request.on("end", () => resolveBody(chunks.join("")));
    try {
      // The local Node shim keeps IncomingMessage intentionally small; runtime still supports this event.
      (request as unknown as { on(event: "error", listener: (error: Error) => void): void })
        .on("error", reject);
    } catch {
      // ignore shim/runtime differences
    }
  });
}

function extractToolNames(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.tools)) {
    return [];
  }
  return body.tools
    .map((entry) => {
      if (!isRecord(entry) || !isRecord(entry.function)) {
        return "";
      }
      return typeof entry.function.name === "string" ? entry.function.name : "";
    })
    .filter((name) => name.length > 0);
}

function extractToolArgsByName(body: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!isRecord(body) || !Array.isArray(body.tools)) {
    return result;
  }
  for (const entry of body.tools) {
    if (!isRecord(entry) || !isRecord(entry.function)) {
      continue;
    }
    const name = typeof entry.function.name === "string" ? entry.function.name : "";
    if (!name || !isRecord(entry.function.parameters)) {
      continue;
    }
    const properties = isRecord(entry.function.parameters.properties)
      ? entry.function.parameters.properties
      : {};
    result[name] = Object.keys(properties).sort((left, right) => left.localeCompare(right));
  }
  return result;
}

function messagesHaveToolResult(body: unknown): boolean {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return false;
  }
  return body.messages.some((message) => (
    isRecord(message) && message.role === "tool"
  ));
}

export async function startSurfaceMockModelServer(
  toolCall: ToolCallSpec,
  finalContent: string,
): Promise<{
  baseUrl: string;
  getCalls: () => MockModelCall[];
  close: () => Promise<void>;
}> {
  const calls: MockModelCall[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const bodyText = await readUtf8Body(request);
    let body: unknown = null;
    try {
      body = parseJson(bodyText);
    } catch {
      body = null;
    }
    const hasToolResult = messagesHaveToolResult(body);
    calls.push({
      bodyText,
      toolNames: extractToolNames(body),
      toolArgsByName: extractToolArgsByName(body),
      hasToolResult,
    });

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    if (!hasToolResult) {
      response.end(JSON.stringify({
        id: "mock-surface-execution",
        object: "chat.completion",
        choices: [{
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            tool_calls: [{
              id: `call_${toolCall.name}`,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.arguments),
              },
            }],
          },
        }],
      }));
      return;
    }

    response.end(JSON.stringify({
      id: "mock-surface-execution",
      object: "chat.completion",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: finalContent,
        },
      }],
    }));
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    const serverWithErrorHandler = server as unknown as {
      once(event: "error", listener: (error: Error) => void): void;
    };
    serverWithErrorHandler.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("surface mock model server failed to bind"));
        return;
      }
      resolvePort(address.port);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    getCalls() {
      return calls.slice();
    },
    async close() {
      await new Promise((resolveClose) => server.close(() => resolveClose(undefined)));
    },
  };
}
