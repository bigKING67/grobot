import { IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { CLI_PRODUCT_USER_AGENT } from "../product-identity";
import { normalizeProbeBaseUrl, parseModelCatalogFromProbePayload, resolveProbeModelHint } from "./catalog";
import { type ProviderModelListResult, type ProviderProbeResult } from "./contract";

export async function probeProviderModels(
  baseUrl: string,
  apiKey: string,
  modelHint: string | undefined,
): Promise<ProviderProbeResult> {
  const listed = await listProviderModels(baseUrl, apiKey);
  if (listed.state !== "ok") {
    return {
      state: listed.state,
      detail: listed.detail,
      httpStatus: listed.httpStatus,
      modelCount: listed.modelIds.length,
    };
  }
  const selected = resolveProbeModelHint(modelHint, listed.modelIds);
  const resolvedPart = selected.resolvedModel
    ? ` resolved=${selected.resolvedModel}`
    : "";
  return {
    state: "ok",
    detail: selected.selectedModel
      ? `models=${String(listed.modelIds.length)} selected=${selected.selectedFound ? "matched" : "missing"}${resolvedPart}`
      : `models=${String(listed.modelIds.length)}`,
    httpStatus: listed.httpStatus,
    modelCount: listed.modelIds.length,
    selectedModel: selected.selectedModel,
    selectedFound: selected.selectedFound,
    resolvedModel: selected.resolvedModel,
    autoSelected: selected.autoSelected,
  };
}

export async function listProviderModels(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderModelListResult> {
  let url: URL;
  try {
    url = normalizeProbeBaseUrl(baseUrl);
  } catch (error) {
    return {
      state: "error",
      detail: `invalid base_url: ${String(error)}`,
      modelIds: [],
    };
  }
  const requestFactory = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : undefined,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": CLI_PRODUCT_USER_AGENT,
    },
    timeout: 5_000,
  };

  return await new Promise((resolve: (value: ProviderModelListResult) => void) => {
    const req = requestFactory(requestOptions, (res: IncomingMessage) => {
      let body = "";
      res.on("data", (chunk: unknown) => {
        if (typeof chunk === "string") {
          body += chunk;
          return;
        }
        body += Buffer.from(chunk as Uint8Array).toString("utf8");
      });
      res.on("end", () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          const snippet = body.trim().slice(0, 240);
          resolve({
            state: "warn",
            detail: `http_${String(statusCode)} ${snippet || "<empty-body>"}`,
            httpStatus: statusCode,
            modelIds: [],
          });
          return;
        }
        try {
          const payload = JSON.parse(body) as unknown;
          const parsedCatalog = parseModelCatalogFromProbePayload(payload);
          const modelIds = parsedCatalog.modelIds;
          resolve({
            state: "ok",
            detail: `models=${String(modelIds.length)}`,
            httpStatus: statusCode,
            modelIds,
            modelContextWindowTokensById: parsedCatalog.modelContextWindowTokensById,
          });
        } catch (error) {
          resolve({
            state: "warn",
            detail: `invalid_json_response: ${String(error)}`,
            httpStatus: statusCode,
            modelIds: [],
          });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error: Error) => {
      resolve({
        state: "error",
        detail: String(error),
        modelIds: [],
      });
    });
    req.end();
  });
}
