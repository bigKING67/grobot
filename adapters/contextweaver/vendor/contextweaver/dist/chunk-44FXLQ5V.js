import {
  isDev,
  isMcpMode
} from "./chunk-CA4WQHZS.js";

// src/utils/logger.ts
import fs from "fs";
import os from "os";
import path from "path";
import { Writable } from "stream";
import pino from "pino";
var logLevel = isDev ? "debug" : "info";
var logDir = path.join(os.homedir(), ".contextweaver", "logs");
var LOG_RETENTION_DAYS = 7;
function ensureLogDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
function getLogFileName() {
  const now = /* @__PURE__ */ new Date();
  const dateStr = now.toISOString().split("T")[0];
  return `app.${dateStr}.log`;
}
function formatTime() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
function getLevelLabel(level) {
  const labels = {
    10: "TRACE",
    20: "DEBUG",
    30: "INFO",
    40: "WARN",
    50: "ERROR",
    60: "FATAL"
  };
  return labels[level] || "INFO";
}
function cleanupOldLogs(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const maxAge = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1e3;
    const logPattern = /^app\.(\d{4}-\d{2}-\d{2})\.log$/;
    for (const file of files) {
      const match = file.match(logPattern);
      if (!match) continue;
      const dateStr = match[1];
      const fileDate = new Date(dateStr).getTime();
      if (Number.isNaN(fileDate)) continue;
      if (now - fileDate > maxAge) {
        const filePath = path.join(dir, file);
        try {
          fs.unlinkSync(filePath);
          console.error(`[Logger] \u6E05\u7406\u8FC7\u671F\u65E5\u5FD7: ${file}`);
        } catch {
        }
      }
    }
  } catch {
  }
}
function createFormattedStream(filePath) {
  const writeStream = fs.createWriteStream(filePath, { flags: "a" });
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const log = JSON.parse(chunk.toString());
        const time = formatTime();
        const level = getLevelLabel(log.level);
        const msg = log.msg || "";
        const { level: _l, time: _t, pid: _p, hostname: _h, name: _n, msg: _m, ...extra } = log;
        let line = `${time} [${level}] ${msg}`;
        if (Object.keys(extra).length > 0) {
          line += ` ${JSON.stringify(extra)}`;
        }
        writeStream.write(`${line}
`, callback);
      } catch {
        writeStream.write(chunk.toString(), callback);
      }
    }
  });
}
function createConsoleStream() {
  const colors = {
    10: "\x1B[90m",
    // TRACE - 灰色
    20: "\x1B[36m",
    // DEBUG - 青色
    30: "\x1B[32m",
    // INFO - 绿色
    40: "\x1B[33m",
    // WARN - 黄色
    50: "\x1B[31m",
    // ERROR - 红色
    60: "\x1B[35m"
    // FATAL - 品红
  };
  const reset = "\x1B[0m";
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const log = JSON.parse(chunk.toString());
        const time = formatTime();
        const level = getLevelLabel(log.level);
        const color = colors[log.level] || "";
        const msg = log.msg || "";
        const { level: _l, time: _t, pid: _p, hostname: _h, name: _n, msg: _m, ...extra } = log;
        let line = `${color}${time} [${level}]${reset} ${msg}`;
        if (Object.keys(extra).length > 0) {
          const extraStr = JSON.stringify(extra);
          line += ` ${color}${extraStr}${reset}`;
        }
        process.stdout.write(`${line}
`, callback);
      } catch {
        process.stdout.write(chunk.toString(), callback);
      }
    }
  });
}
function createDevLogger() {
  ensureLogDir(logDir);
  cleanupOldLogs(logDir);
  const logPath = path.join(logDir, getLogFileName());
  const logStream = createFormattedStream(logPath);
  const consoleStream = createConsoleStream();
  return pino(
    {
      level: logLevel,
      name: "contextweaver"
    },
    // MCP 模式下禁用控制台输出，避免污染 STDIO 协议流
    isMcpMode ? logStream : pino.multistream([
      { stream: logStream, level: logLevel },
      { stream: consoleStream, level: logLevel }
    ])
  );
}
function createProdLogger() {
  ensureLogDir(logDir);
  cleanupOldLogs(logDir);
  const logPath = path.join(logDir, getLogFileName());
  const logStream = createFormattedStream(logPath);
  const consoleStream = createConsoleStream();
  return pino(
    {
      level: logLevel,
      name: "contextweaver"
    },
    // MCP 模式下禁用控制台输出，避免污染 STDIO 协议流
    isMcpMode ? logStream : pino.multistream([
      { stream: logStream, level: logLevel },
      { stream: consoleStream, level: logLevel }
    ])
  );
}
var logger = isDev ? createDevLogger() : createProdLogger();
function isDebugEnabled() {
  return logger.isLevelEnabled("debug");
}

export {
  logger,
  isDebugEnabled
};
//# sourceMappingURL=chunk-44FXLQ5V.js.map