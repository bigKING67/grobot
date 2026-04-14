function writeMessage(payload) {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  process.stdout.write(`${header}${body}`);
}

function writeResult(id, result) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function writeError(id, code, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
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
    let contentLength = -1;
    for (const rawLine of headerText.split("\r\n")) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const parts = line.split(":");
      if (parts.length < 2) {
        continue;
      }
      const name = parts[0].trim().toLowerCase();
      const value = parts.slice(1).join(":").trim();
      if (name === "content-length") {
        const parsed = Number.parseInt(value, 10);
        contentLength = Number.isFinite(parsed) ? parsed : -1;
      }
    }
    if (contentLength < 0) {
      throw new Error("missing content-length");
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (bodyEnd > buffer.length) {
      break;
    }
    const bodyText = buffer.toString("utf8", bodyStart, bodyEnd);
    frames.push({
      json: JSON.parse(bodyText),
      nextOffset: bodyEnd,
    });
    offset = bodyEnd;
  }
  return {
    frames,
    rest: buffer.subarray(offset),
  };
}

function handleRequest(request) {
  const id = request?.id;
  if (typeof request?.method !== "string") {
    if (id !== undefined) {
      writeError(id, -32600, "invalid request");
    }
    return;
  }
  if (request.method === "initialize") {
    writeResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "mock-mcp-server",
        version: "0.1.0",
      },
    });
    return;
  }
  if (request.method === "notifications/initialized") {
    return;
  }
  if (request.method === "tools/list") {
    writeResult(id, {
      tools: [
        {
          name: "echo",
          description: "Echo message for runtime smoke tests",
          inputSchema: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      ],
    });
    return;
  }
  if (request.method === "tools/call") {
    const params = request?.params ?? {};
    const toolName = typeof params?.name === "string" ? params.name : "";
    const args = typeof params?.arguments === "object" && params.arguments !== null
      ? params.arguments
      : {};
    if (toolName !== "echo") {
      writeResult(id, {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${toolName}` }],
      });
      return;
    }
    const message = typeof args?.message === "string" ? args.message : "";
    writeResult(id, {
      isError: false,
      content: [{ type: "text", text: `echo:${message}` }],
      structuredContent: { message },
    });
    return;
  }
  if (id !== undefined) {
    writeError(id, -32601, `method not found: ${request.method}`);
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
    process.stderr.write(`mock-mcp-server parse error: ${String(error)}\n`);
    process.exitCode = 1;
    process.exit();
  }
});

process.stdin.resume();
