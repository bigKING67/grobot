import {
  logger
} from "./chunk-44FXLQ5V.js";
import "./chunk-CA4WQHZS.js";

// src/utils/lock.ts
import fs from "fs";
import os from "os";
import path from "path";
var BASE_DIR = path.join(os.homedir(), ".contextweaver");
var LOCK_CHECK_INTERVAL_MS = 100;
var LOCK_WRITE_GRACE_MS = 2e3;
function getLockAgeMs(lockPath) {
  try {
    const stats = fs.statSync(lockPath);
    return Date.now() - stats.mtimeMs;
  } catch {
    return null;
  }
}
function getLockFilePath(projectId) {
  return path.join(BASE_DIR, projectId, "index.lock");
}
function isLockValid(lockPath) {
  try {
    if (!fs.existsSync(lockPath)) {
      return false;
    }
    const content = fs.readFileSync(lockPath, "utf-8");
    const lockInfo = JSON.parse(content);
    try {
      process.kill(lockInfo.pid, 0);
      return true;
    } catch (err) {
      const error = err;
      if (error.code === "EPERM") {
        return true;
      }
      logger.warn({ pid: lockInfo.pid }, "\u6301\u6709\u9501\u7684\u8FDB\u7A0B\u5DF2\u6B7B\u4EA1");
      return false;
    }
  } catch (err) {
    const ageMs = getLockAgeMs(lockPath);
    if (ageMs !== null && ageMs <= LOCK_WRITE_GRACE_MS) {
      return true;
    }
    const error = err;
    logger.debug({ error: error.message }, "\u8BFB\u53D6\u9501\u6587\u4EF6\u5931\u8D25");
    return false;
  }
}
async function acquireLock(projectId, operation, timeoutMs = 3e4) {
  const lockPath = getLockFilePath(projectId);
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const lockInfo = {
        pid: process.pid,
        timestamp: Date.now(),
        operation
      };
      fs.writeFileSync(lockPath, JSON.stringify(lockInfo), { flag: "wx" });
      logger.debug({ projectId: projectId.slice(0, 10), operation }, "\u83B7\u53D6\u9501\u6210\u529F");
      return true;
    } catch (err) {
      const error = err;
      if (error.code === "EEXIST") {
        if (!isLockValid(lockPath)) {
          try {
            fs.unlinkSync(lockPath);
            logger.warn({ projectId: projectId.slice(0, 10) }, "\u79FB\u9664\u5931\u6548\u9501");
            continue;
          } catch (unlinkErr) {
            const unlinkError = unlinkErr;
            if (unlinkError.code !== "ENOENT") {
              logger.debug({ error: unlinkError.message }, "\u79FB\u9664\u5931\u6548\u9501\u5931\u8D25\uFF0C\u91CD\u8BD5\u4E2D...");
            }
          }
        } else {
          logger.debug({ projectId: projectId.slice(0, 10) }, "\u7B49\u5F85\u9501\u91CA\u653E...");
        }
      } else {
        logger.debug({ error: error.message }, "\u83B7\u53D6\u9501\u5931\u8D25\uFF0C\u91CD\u8BD5\u4E2D...");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_CHECK_INTERVAL_MS));
  }
  logger.warn({ projectId: projectId.slice(0, 10), timeoutMs }, "\u83B7\u53D6\u9501\u8D85\u65F6");
  return false;
}
function releaseLock(projectId) {
  const lockPath = getLockFilePath(projectId);
  try {
    if (!fs.existsSync(lockPath)) {
      return;
    }
    const content = fs.readFileSync(lockPath, "utf-8");
    const lockInfo = JSON.parse(content);
    if (lockInfo.pid === process.pid) {
      fs.unlinkSync(lockPath);
      logger.debug({ projectId: projectId.slice(0, 10) }, "\u91CA\u653E\u9501\u6210\u529F");
    } else {
      logger.warn({ ownPid: process.pid, lockPid: lockInfo.pid }, "\u5C1D\u8BD5\u91CA\u653E\u975E\u81EA\u5DF1\u6301\u6709\u7684\u9501");
    }
  } catch (err) {
    const error = err;
    logger.debug({ error: error.message }, "\u91CA\u653E\u9501\u65F6\u51FA\u9519");
  }
}
async function withLock(projectId, operation, fn, timeoutMs = 3e4) {
  const acquired = await acquireLock(projectId, operation, timeoutMs);
  if (!acquired) {
    throw new Error(`\u65E0\u6CD5\u83B7\u53D6\u9879\u76EE\u9501 (${projectId.slice(0, 10)})\uFF0C\u5176\u4ED6\u8FDB\u7A0B\u6B63\u5728\u64CD\u4F5C\u7D22\u5F15`);
  }
  try {
    return await fn();
  } finally {
    releaseLock(projectId);
  }
}
export {
  withLock
};
//# sourceMappingURL=lock-CXBZNMFH.js.map