import { createServer } from "node:http";
import { StdioRustRuntimeClient } from "../../tools/runtime/stdio-client";
import { type RuntimeRequest } from "../../models/types";

interface MockServerHandle {
  baseUrl: string;
  getCalls(): number;
  close(): Promise<void>;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

function readUtf8Body(request: {
  on(event: "data", listener: (chunk: string | Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
}): Promise<string> {
  return new Promise((resolveBody) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    request.on("end", () => {
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function startDelayedMockModelServer(responseDelayMs: number): Promise<MockServerHandle> {
  let calls = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    calls += 1;
    await readUtf8Body(request);
    await sleep(responseDelayMs);
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
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
              content: "RUNTIME_INTERRUPT_CONTRACT_OK",
            },
          },
        ],
      }),
    );
  });
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPort(new Error("mock server failed to bind address"));
        return;
      }
      resolvePort(address.port);
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    getCalls(): number {
      return calls;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    },
  };
}

function buildRequest(baseUrl: string): RuntimeRequest {
  const requestId = `req_${Date.now()}`;
  return {
    protocolVersion: "runtime.v1",
    requestId,
    sessionKey: "feishu:grobot:dm:runtime-interrupt-contract",
    userMessage: "runtime interrupt contract",
    contextLines: ["contract:runtime-interrupt"],
    modelConfig: {
      baseUrl,
      apiKey: "runtime-interrupt-contract-key",
      model: "runtime-interrupt-contract-model",
      providerKind: "openai_compatible",
      timeoutMs: 15_000,
    },
    metadata: {
      platform: "feishu",
      actorId: "contract",
      projectId: "grobot",
      gatewayImpl: "ts",
      runtimeImpl: "rust",
      shadowMode: false,
    },
  };
}

async function main(): Promise<void> {
  const mockModel = await startDelayedMockModelServer(8_000);
  try {
    const runtimeClient = new StdioRustRuntimeClient({
      runtimeBinaryPath: `${process.cwd()}/runtime/target/debug/grobot-runtime`,
      timeoutMs: 20_000,
    });
    const request = buildRequest(mockModel.baseUrl);
    const abortController = new AbortController();
    const abortDelayMs = 400;
    const timer = setTimeout(() => {
      abortController.abort("contract_abort");
    }, abortDelayMs);
    let interrupted = false;
    let errorMessage = "";
    const startedAt = Date.now();
    try {
      await runtimeClient.executeTurn(request, { signal: abortController.signal });
    } catch (error) {
      errorMessage = String(error);
      interrupted = errorMessage.includes("class=turn_interrupted");
    } finally {
      clearTimeout(timer);
    }
    const payload = {
      interrupted,
      error: errorMessage,
      duration_ms: Date.now() - startedAt,
      call_count: mockModel.getCalls(),
      abort_delay_ms: abortDelayMs,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    await mockModel.close();
  }
}

void main();
