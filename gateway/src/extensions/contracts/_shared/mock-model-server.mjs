import { createServer } from "node:http";

function readUtf8Body(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function startMockModelServer(options = {}) {
  const mode = typeof options.mode === "string" ? options.mode : "text";
  const fixedContent = typeof options.content === "string" ? options.content : "MOCK_RUNTIME_OK";
  const calls = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const bodyText = await readUtf8Body(request);
    let model = "";
    let prompt = "";
    try {
      const parsed = JSON.parse(bodyText);
      model = typeof parsed?.model === "string" ? parsed.model : "";
      const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
      const firstUserMessage = messages.find((item) => item?.role === "user");
      prompt = typeof firstUserMessage?.content === "string" ? firstUserMessage.content : "";
    } catch {
      // ignore malformed body in mock server and continue with canned response
    }
    const authorizationHeaderRaw = request.headers.authorization;
    const authorization = Array.isArray(authorizationHeaderRaw)
      ? authorizationHeaderRaw.join(",")
      : (typeof authorizationHeaderRaw === "string" ? authorizationHeaderRaw : "");
    calls.push({
      method: request.method,
      path: request.url ?? "",
      authorization,
      model,
      prompt,
      bodyText,
    });

    response.writeHead(200, { "content-type": "application/json" });
    if (mode === "tool_call") {
      response.end(
        JSON.stringify({
          id: "mock-chatcmpl",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "lookup",
                      arguments: "{}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
      return;
    }

    response.end(
      JSON.stringify({
        id: "mock-chatcmpl",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: `${fixedContent} ${prompt ? `(prompt:${prompt.length})` : ""}`.trim(),
            },
          },
        ],
      }),
    );
  });

  const port = await new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("mock model server failed to bind port"));
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
