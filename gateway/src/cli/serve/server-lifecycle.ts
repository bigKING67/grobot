import { Server } from "node:http";
import { type ExecutionPlaneConfig } from "../../orchestration/execution-plane";
import { CLI_PRODUCT_ENGINE } from "../product-identity";
import { type BindConfig } from "./bind-config";

interface RunServeServerLifecycleInput {
  server: Server;
  bind: BindConfig;
  getExecutionPlane(): ExecutionPlaneConfig;
}

export function runServeServerLifecycle(input: RunServeServerLifecycleInput): Promise<number> {
  return new Promise<number>((resolve) => {
    const shutdown = () => {
      input.server.close(() => {
        resolve(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    input.server.listen(input.bind.port, input.bind.host, () => {
      const address = input.server.address();
      let listenHost = input.bind.host;
      let listenPort = input.bind.port;
      if (address && typeof address === "object" && "port" in address) {
        listenHost = String(address.address || input.bind.host);
        listenPort = Number(address.port || input.bind.port);
      }
      const executionPlane = input.getExecutionPlane();
      process.stdout.write(`serve: ${CLI_PRODUCT_ENGINE}\n`);
      process.stdout.write(`management api: http://${listenHost}:${listenPort}\n`);
      process.stdout.write(
        `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
      );
    });
  });
}
