const backendPayload = JSON.parse(
  process.env.GROBOT_FAKE_BROWSER_BACKEND_PAYLOAD ?? "{\"status\":\"ok\"}",
);
const mcpIsError = /^(1|true|yes)$/i.test(process.env.GROBOT_FAKE_BROWSER_MCP_IS_ERROR ?? "");

function writeMessage(payload) {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  process.stdout.write(`${header}${body}`);
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n", offset, "utf8");
    if (headerEnd < 0) {
      break;
    }
    const headerText = buffer.toString("utf8", offset, headerEnd);
    const lengthLine = headerText
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-length:"));
    const length = Number.parseInt((lengthLine ?? "").split(":").slice(1).join(":").trim(), 10);
    if (!Number.isFinite(length) || length < 0) {
      throw new Error("missing content-length");
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (bodyEnd > buffer.length) {
      break;
    }
    frames.push({
      json: JSON.parse(buffer.toString("utf8", bodyStart, bodyEnd)),
      nextOffset: bodyEnd,
    });
    offset = bodyEnd;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function handleRequest(request) {
  const id = request?.id;
  if (request?.method === "initialize") {
    writeResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-browser-structured-mcp", version: "0.1.0" },
    });
    return;
  }
  if (request?.method === "notifications/initialized") {
    return;
  }
  if (request?.method === "tools/list") {
    writeResult(id, {
      tools: [
        {
          name: "browser_scan",
          description: "Fake browser scan",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "browser_execute_js",
          description: "Fake browser execute",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
    return;
  }
  if (request?.method === "tools/call") {
    const name = request?.params?.name;
    if (name !== "browser_scan" && name !== "browser_execute_js") {
      writeResult(id, {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
      });
      return;
    }
    writeResult(id, {
      isError: mcpIsError,
      content: [{ type: "json", json: backendPayload }],
      structuredContent: backendPayload,
    });
    return;
  }
  if (id !== undefined) {
    writeError(id, -32601, `method not found: ${request?.method}`);
  }
}

let pending = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, Buffer.from(chunk)]);
  try {
    while (pending.length > 0) {
      const { frames, rest } = parseFrames(pending);
      if (frames.length === 0) {
        pending = rest;
        break;
      }
      pending = rest;
      for (const frame of frames) {
        handleRequest(frame.json);
      }
    }
  } catch (error) {
    process.stderr.write(`fake-browser-structured-mcp parse error: ${String(error)}\n`);
    process.exit(1);
  }
});

process.stdin.resume();
