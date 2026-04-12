import { spawn } from "node:child_process";

function parseArgs(argv) {
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

function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

async function awaitChildExit(child) {
  const result = await new Promise((resolve) => {
    child.once("exit", (exitCode, signalCode) => {
      resolve({ exitCode, signalCode });
    });
  });
  return result;
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  const terminated = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (terminated) {
    return;
  }
  child.kill("SIGKILL");
}

async function runDaemon(args, env) {
  const child = spawn("./grobot", ["serve", ...args], {
    cwd: env.repoRoot,
    env: env.childEnv,
    stdio: "ignore",
  });

  let shuttingDown = false;
  const onSignal = async (signalName) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await terminateChild(child);
    if (signalName === "SIGINT") {
      process.exitCode = 130;
      return;
    }
    process.exitCode = 0;
  };

  process.on("SIGTERM", () => {
    void onSignal("SIGTERM");
  });
  process.on("SIGINT", () => {
    void onSignal("SIGINT");
  });

  const { exitCode, signalCode } = await awaitChildExit(child);
  if (!shuttingDown) {
    process.exitCode = typeof exitCode === "number" ? exitCode : 1;
    if (signalCode && process.exitCode === 0) {
      process.exitCode = 1;
    }
  }
}

async function runTsDevManagementEndpointsDaemon(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const homeDir = requireOption(options, "home-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  await runDaemon(
    [
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
    ],
    {
      repoRoot,
      childEnv: {
        ...process.env,
        GROBOT_HOME: homeDir,
      },
    }
  );
}

async function runSessionLifecycleManagementDaemon(options) {
  const repoRoot = requireOption(options, "repo-root");
  const projectRoot = requireOption(options, "project-root");
  const homeDir = requireOption(options, "home-dir");
  const configPath = requireOption(options, "config-path");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  await runDaemon(
    [
      "--project",
      "grobot",
      "--work-dir",
      projectRoot,
      "--project-root",
      projectRoot,
      "--home",
      homeDir,
      "--config",
      configPath,
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--shadow-mode",
    ],
    {
      repoRoot,
      childEnv: {
        ...process.env,
      },
    }
  );
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "ts-dev-management-endpoints-daemon":
      await runTsDevManagementEndpointsDaemon(options);
      return;
    case "session-lifecycle-management-daemon":
      await runSessionLifecycleManagementDaemon(options);
      return;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
if (entryScript.includes("serve-daemon-contract.mjs")) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`serve-daemon-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
