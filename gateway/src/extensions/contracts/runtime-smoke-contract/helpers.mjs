import { spawn } from "node:child_process";
import { resolve } from "node:path";

export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

export function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

export function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export function tomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildEnvPrefix(envPrefix) {
  if (!envPrefix) {
    return "";
  }
  const entries = Object.entries(envPrefix);
  if (entries.length === 0) {
    return "";
  }
  return `${entries.map(([key, value]) => `${key}=${shellEscape(value)}`).join(" ")} `;
}

export function runCommandAsync(repoRoot, argv, envPrefix = null, stdinText = null, timeoutMs = 240_000) {
  return new Promise((resolveResult, rejectResult) => {
    const commandLine = argv.map(shellEscape).join(" ");
    const exportPrefix = buildEnvPrefix(envPrefix);
    const shellScript = `cd ${shellEscape(repoRoot)} && ${exportPrefix}${commandLine}`;
    const child = spawn("bash", ["-lc", shellScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolveResult(payload);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exit_code: 1,
        stdout,
        stderr: stderr.length > 0 ? `${stderr}\ncommand timeout after ${String(timeoutMs)}ms` : `command timeout after ${String(timeoutMs)}ms`,
      });
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", rejectResult);
    child.on("close", (code) => {
      finish({
        exit_code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    if (typeof stdinText === "string" && child.stdin) {
      child.stdin.write(stdinText);
    }
    if (child.stdin) {
      child.stdin.end();
    }
  });
}

export function runRuntimeRpcSequence(repoRoot, envPrefix, requests, timeoutMs = 180_000) {
  return new Promise((resolveResult, rejectResult) => {
    const runtimeBinaryPath = resolve(repoRoot, "runtime/target/debug/grobot-runtime");
    const child = spawn(runtimeBinaryPath, {
      cwd: repoRoot,
      env: envPrefix ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let requestIndex = 0;
    let timeoutHandle = null;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      resolveResult(payload);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      rejectResult(error);
    };

    const pushNextRequest = () => {
      if (requestIndex >= requests.length) {
        if (child.stdin) {
          child.stdin.end();
        }
        return;
      }
      const request = requests[requestIndex] ?? {};
      requestIndex += 1;
      const line = typeof request.line === "string" ? request.line : "";
      const delayMsRaw = request.delay_ms;
      const delayMs = Number.isFinite(delayMsRaw) && delayMsRaw > 0 ? delayMsRaw : 0;
      if (child.stdin && line.length > 0) {
        child.stdin.write(`${line}\n`);
      }
      if (delayMs > 0) {
        setTimeout(pushNextRequest, delayMs);
        return;
      }
      pushNextRequest();
    };

    timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exit_code: 1,
        stdout,
        stderr: stderr.length > 0
          ? `${stderr}\ncommand timeout after ${String(timeoutMs)}ms`
          : `command timeout after ${String(timeoutMs)}ms`,
      });
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", fail);
    child.on("close", (code) => {
      finish({
        exit_code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    pushNextRequest();
  });
}

export function parseJsonOutput(name, stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${name}: stdout is not valid JSON: ${String(error)}\n${stdout}`);
  }
}

export function parseFirstJsonLine(name, stdout) {
  const firstLine = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    throw new Error(`${name}: empty stdout`);
  }
  try {
    return JSON.parse(firstLine);
  } catch (error) {
    throw new Error(`${name}: first non-empty line is not valid JSON: ${String(error)}\n${stdout}`);
  }
}

export function parseJsonLines(name, stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`${name}: empty stdout`);
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${name}: line ${String(index + 1)} is not valid JSON: ${String(error)}\n${line}`);
    }
  });
}

export function collectMcpToolPayloadsFromModelCalls(calls) {
  const payloads = [];
  for (const call of calls) {
    if (typeof call?.bodyText !== "string") {
      continue;
    }
    let body = null;
    try {
      body = JSON.parse(call.bodyText);
    } catch {
      continue;
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (const message of messages) {
      if (message?.role !== "tool" || message?.name !== "mcp_call" || typeof message?.content !== "string") {
        continue;
      }
      try {
        payloads.push(JSON.parse(message.content));
      } catch {
        // ignore malformed tool payload in smoke contract
      }
    }
  }
  return payloads;
}
