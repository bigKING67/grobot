import { type IncomingMessage, type ServerResponse } from "node:http";
import { type ManagementRoutesContext } from "./management-routes-types";

export function requireManagementToken(
  request: IncomingMessage,
  response: ServerResponse,
  context: ManagementRoutesContext,
): boolean {
  if (!context.managementToken) {
    context.writeJson(response, 403, {
      error: "forbidden",
      detail: "management token is not configured",
    });
    return false;
  }
  const incomingToken = context.parseBearerToken(request.headers);
  if (incomingToken !== context.managementToken) {
    context.writeJson(response, 403, {
      error: "forbidden",
      detail: "invalid management token",
    });
    return false;
  }
  return true;
}
