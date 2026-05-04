import { createConnection } from "node:net";
import { CLI_PRODUCT_ENGINE } from "../product-identity";

const REDIS_IO_TIMEOUT_MS = 2_000;

interface ParsedRedisUrl {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
}

function redisParseUrl(redisUrl: string): ParsedRedisUrl {
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch (error) {
    throw new Error(`invalid redis url: ${String(error)}`);
  }
  if (parsed.protocol !== "redis:") {
    if (parsed.protocol === "rediss:") {
      throw new Error(`rediss is not supported by ${CLI_PRODUCT_ENGINE} yet`);
    }
    throw new Error(`unsupported redis scheme: ${parsed.protocol.replace(/:$/, "")}`);
  }
  const host = parsed.hostname.trim();
  if (!host) {
    throw new Error("invalid redis url: host is required");
  }
  let port = 6379;
  if (parsed.port) {
    const parsedPort = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      throw new Error(`invalid redis port: ${parsed.port}`);
    }
    port = parsedPort;
  }
  let db = 0;
  const dbPath = parsed.pathname.trim();
  if (dbPath && dbPath !== "/") {
    const token = dbPath.replace(/^\//, "");
    if (!/^\d+$/.test(token)) {
      throw new Error(`invalid redis db index in url path: ${parsed.pathname}`);
    }
    db = Number.parseInt(token, 10);
  }
  if (db < 0) {
    throw new Error(`invalid redis db index in url path: ${parsed.pathname}`);
  }
  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  return {
    host,
    port,
    username,
    password,
    db,
  };
}

function redisEncodeCommand(parts: string[]): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from(`*${String(parts.length)}\r\n`, "utf8"));
  for (const part of parts) {
    const text = String(part);
    const data = Buffer.from(text, "utf8");
    chunks.push(Buffer.from(`$${String(data.length)}\r\n`, "utf8"));
    chunks.push(data);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  return Buffer.concat(chunks);
}

interface RespParseSuccess {
  value: unknown;
  nextOffset: number;
}

function findRespCrlf(buffer: Buffer, start: number): number {
  for (let index = start; index + 1 < buffer.length; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) {
      return index;
    }
  }
  return -1;
}

function tryParseResp(buffer: Buffer, offset = 0): RespParseSuccess | undefined {
  if (offset >= buffer.length) {
    return undefined;
  }
  const marker = String.fromCharCode(buffer[offset] ?? 0);
  const lineEnd = findRespCrlf(buffer, offset + 1);
  if (lineEnd < 0) {
    return undefined;
  }
  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const afterLine = lineEnd + 2;

  if (marker === "+") {
    return {
      value: line,
      nextOffset: afterLine,
    };
  }
  if (marker === "-") {
    throw new Error(`redis error reply: ${line}`);
  }
  if (marker === ":") {
    return {
      value: Number.parseInt(line, 10),
      nextOffset: afterLine,
    };
  }
  if (marker === "$") {
    const bulkLen = Number.parseInt(line, 10);
    if (!Number.isFinite(bulkLen)) {
      throw new Error(`invalid redis bulk length: ${line}`);
    }
    if (bulkLen < 0) {
      return {
        value: null,
        nextOffset: afterLine,
      };
    }
    const payloadStart = afterLine;
    const payloadEnd = payloadStart + bulkLen;
    if (payloadEnd + 2 > buffer.length) {
      return undefined;
    }
    if (buffer[payloadEnd] !== 13 || buffer[payloadEnd + 1] !== 10) {
      throw new Error("invalid redis bulk terminator");
    }
    return {
      value: buffer.toString("utf8", payloadStart, payloadEnd),
      nextOffset: payloadEnd + 2,
    };
  }
  if (marker === "*") {
    const count = Number.parseInt(line, 10);
    if (!Number.isFinite(count)) {
      throw new Error(`invalid redis array length: ${line}`);
    }
    if (count < 0) {
      return {
        value: null,
        nextOffset: afterLine,
      };
    }
    const values: unknown[] = [];
    let cursor = afterLine;
    for (let idx = 0; idx < count; idx += 1) {
      const parsed = tryParseResp(buffer, cursor);
      if (!parsed) {
        return undefined;
      }
      values.push(parsed.value);
      cursor = parsed.nextOffset;
    }
    return {
      value: values,
      nextOffset: cursor,
    };
  }
  throw new Error(`unsupported redis reply marker: ${marker}`);
}

async function redisExecute(redisUrl: string, parts: string[]): Promise<unknown> {
  const parsed = redisParseUrl(redisUrl);
  const commands: string[][] = [];
  if (parsed.password) {
    if (parsed.username) {
      commands.push(["AUTH", parsed.username, parsed.password]);
    } else {
      commands.push(["AUTH", parsed.password]);
    }
  }
  if (parsed.db > 0) {
    commands.push(["SELECT", String(parsed.db)]);
  }
  commands.push(parts);

  return await new Promise<unknown>((resolve, reject) => {
    const socket = createConnection({ host: parsed.host, port: parsed.port });
    let settled = false;
    let buffer = Buffer.alloc(0);
    const expectedReplies = commands.length;
    let receivedReplies = 0;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(new Error(`redis timeout after ${String(REDIS_IO_TIMEOUT_MS)}ms`));
    }, REDIS_IO_TIMEOUT_MS);

    const finishResolve = (value: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.end();
      resolve(value);
    };

    const finishReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    socket.on("connect", () => {
      try {
        for (const command of commands) {
          socket.write(redisEncodeCommand(command));
        }
      } catch (error) {
        finishReject(error);
      }
    });

    socket.on("data", (chunk) => {
      try {
        const nextChunk = Buffer.from(chunk);
        buffer = Buffer.concat([buffer, nextChunk]);
        while (true) {
          const parsedReply = tryParseResp(buffer, 0);
          if (!parsedReply) {
            break;
          }
          buffer = buffer.subarray(parsedReply.nextOffset);
          receivedReplies += 1;
          if (receivedReplies >= expectedReplies) {
            finishResolve(parsedReply.value);
            return;
          }
        }
      } catch (error) {
        finishReject(error);
      }
    });

    socket.on("error", (error) => {
      finishReject(error);
    });

    socket.on("close", () => {
      if (!settled && receivedReplies < expectedReplies) {
        finishReject(new Error("redis connection closed before full reply"));
      }
    });
  });
}

export async function redisGetJson(redisUrl: string, key: string): Promise<Record<string, unknown> | undefined> {
  const reply = await redisExecute(redisUrl, ["GET", key]);
  if (reply === null || reply === undefined) {
    return undefined;
  }
  if (typeof reply !== "string") {
    throw new Error("redis GET returned non-string payload");
  }
  const content = reply.trim();
  if (!content) {
    return undefined;
  }
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("redis payload is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export async function redisSetJson(
  redisUrl: string,
  key: string,
  payload: Record<string, unknown>,
  ttlSecs: number,
): Promise<void> {
  const content = JSON.stringify(payload);
  await redisExecute(redisUrl, ["SET", key, content, "EX", String(ttlSecs)]);
}
