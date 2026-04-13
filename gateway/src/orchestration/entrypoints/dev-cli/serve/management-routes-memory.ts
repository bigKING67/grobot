import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS,
  MANAGEMENT_MEMORY_FETCH_MAX,
  MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES,
  MEMORY_SCOPE_AUTO,
  normalizeMemoryClassification,
  normalizeMemoryKind,
  normalizeMemoryScope,
} from "../services/memory-lifecycle";
import { requireManagementToken } from "./management-routes-auth";
import { type ManagementRoutesContext } from "./management-routes-types";

interface DispatchManagementMemoryRoutesInput {
  request: IncomingMessage;
  response: ServerResponse;
  context: ManagementRoutesContext;
  method: string;
  rawUrl: string;
  path: string;
}

export async function dispatchManagementMemoryRoutes(
  input: DispatchManagementMemoryRoutesInput,
): Promise<boolean> {
  const { request, response, context, method, rawUrl, path } = input;

  const memoryExportMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/export$/);
  if (method === "GET" && memoryExportMatch) {
    const sessionId = decodeURIComponent(memoryExportMatch[1]).trim();
    if (!sessionId) {
      context.writeJson(response, 400, {
        error: "invalid_session_id",
      });
      return true;
    }
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const query = context.parseQueryParams(rawUrl);
    const scopeRaw = context.queryParamStr(query, "scope", MEMORY_SCOPE_AUTO).toLowerCase();
    const scope = normalizeMemoryScope(scopeRaw);
    if (!scope) {
      context.writeJson(response, 400, {
        error: "invalid_scope",
        detail: scopeRaw,
      });
      return true;
    }

    const cursorResult = context.queryParamCursor(query);
    if (cursorResult.error) {
      context.writeJson(response, 400, {
        error: cursorResult.error,
      });
      return true;
    }
    const cursor = cursorResult.cursor;
    const includeArchived = context.queryParamBool(query, "include_archived", true);
    const includeRestricted = context.queryParamBool(query, "include_restricted", false);
    const includeSecret = context.queryParamBool(query, "include_secret", false);
    const effectiveIncludeRestricted = includeRestricted || includeSecret;
    const queryText = context.queryParamStr(query, "query", "");
    const limit = context.queryParamInt(query, "limit", 2000, 1, 5000);
    const fetchLimit = cursor + limit + 1;
    if (fetchLimit > MANAGEMENT_MEMORY_FETCH_MAX) {
      context.writeJson(response, 400, {
        error: "cursor_window_too_large",
        detail: `cursor+limit exceeds max window ${String(MANAGEMENT_MEMORY_FETCH_MAX)}`,
      });
      return true;
    }

    const rows = context.listMemoryRows(sessionId, {
      includeArchived,
      includeRestricted: effectiveIncludeRestricted,
      includeSecret,
      queryText,
    });
    const slicedRows = rows.slice(0, fetchLimit);
    const pageRows = slicedRows.slice(cursor, cursor + limit);
    const hasMore = slicedRows.length > cursor + limit;
    const nextCursor = hasMore ? String(cursor + limit) : null;

    context.writeJson(response, 200, {
      status: "ok",
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      scope,
      include_archived: includeArchived,
      include_restricted: effectiveIncludeRestricted,
      include_secret: includeSecret,
      query: queryText,
      limit,
      cursor,
      next_cursor: nextCursor,
      has_more: hasMore,
      count: pageRows.length,
      records: pageRows,
    });
    return true;
  }

  const memoryListMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory$/);
  if (method === "GET" && memoryListMatch) {
    const sessionId = decodeURIComponent(memoryListMatch[1]).trim();
    if (!sessionId) {
      context.writeJson(response, 400, {
        error: "invalid_session_id",
      });
      return true;
    }
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const query = context.parseQueryParams(rawUrl);
    const scopeRaw = context.queryParamStr(query, "scope", MEMORY_SCOPE_AUTO).toLowerCase();
    const scope = normalizeMemoryScope(scopeRaw);
    if (!scope) {
      context.writeJson(response, 400, {
        error: "invalid_scope",
        detail: scopeRaw,
      });
      return true;
    }

    const cursorResult = context.queryParamCursor(query);
    if (cursorResult.error) {
      context.writeJson(response, 400, {
        error: cursorResult.error,
      });
      return true;
    }
    const cursor = cursorResult.cursor;
    const includeArchived = context.queryParamBool(query, "include_archived", false);
    const includeRestricted = context.queryParamBool(query, "include_restricted", false);
    const includeSecret = context.queryParamBool(query, "include_secret", false);
    const effectiveIncludeRestricted = includeRestricted || includeSecret;

    const kindRaw = context.queryParamStr(query, "kind", "").toLowerCase();
    const kindFilter = kindRaw ? normalizeMemoryKind(kindRaw) : undefined;
    if (kindRaw && !kindFilter) {
      context.writeJson(response, 400, {
        error: "invalid_kind",
        detail: kindRaw,
      });
      return true;
    }

    const classificationRaw = context.queryParamStr(query, "classification", "").toLowerCase();
    const classificationFilter = classificationRaw ? normalizeMemoryClassification(classificationRaw) : undefined;
    if (classificationRaw && !classificationFilter) {
      context.writeJson(response, 400, {
        error: "invalid_classification",
        detail: classificationRaw,
      });
      return true;
    }

    const queryText = context.queryParamStr(query, "query", "");
    const limit = context.queryParamInt(query, "limit", 50, 1, 1000);
    const fetchLimit = cursor + limit + 1;
    if (fetchLimit > MANAGEMENT_MEMORY_FETCH_MAX) {
      context.writeJson(response, 400, {
        error: "cursor_window_too_large",
        detail: `cursor+limit exceeds max window ${String(MANAGEMENT_MEMORY_FETCH_MAX)}`,
      });
      return true;
    }

    const rows = context.listMemoryRows(sessionId, {
      includeArchived,
      includeRestricted: effectiveIncludeRestricted,
      includeSecret,
      kindFilter,
      classificationFilter,
      queryText,
    });
    const slicedRows = rows.slice(0, fetchLimit);
    const pageRows = slicedRows.slice(cursor, cursor + limit);
    const hasMore = slicedRows.length > cursor + limit;
    const nextCursor = hasMore ? String(cursor + limit) : null;

    context.writeJson(response, 200, {
      status: "ok",
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      scope,
      include_archived: includeArchived,
      include_restricted: effectiveIncludeRestricted,
      include_secret: includeSecret,
      kind_filter: kindFilter ?? null,
      classification_filter: classificationFilter ?? null,
      query: queryText,
      limit,
      cursor,
      next_cursor: nextCursor,
      has_more: hasMore,
      count: pageRows.length,
      records: pageRows,
    });
    return true;
  }

  const memoryImportMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/import$/);
  if (method === "POST" && memoryImportMatch) {
    const sessionId = decodeURIComponent(memoryImportMatch[1]).trim();
    if (!sessionId) {
      context.writeJson(response, 400, {
        error: "invalid_session_id",
      });
      return true;
    }
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const declaredLength = Number.parseInt(context.readHeaderValue(request.headers, "content-length") ?? "0", 10);
    if (Number.isFinite(declaredLength) && declaredLength > MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES) {
      context.writeJson(response, 413, {
        error: "payload_too_large",
        detail: `Request body too large: ${String(declaredLength)} > ${String(MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES)} bytes`,
        max_bytes: MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES,
      });
      return true;
    }

    const rawBody = await context.readBody(request);
    if (context.utf8ByteLength(rawBody) > MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES) {
      context.writeJson(response, 413, {
        error: "payload_too_large",
        detail: `Request body too large: ${String(context.utf8ByteLength(rawBody))} > ${String(MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES)} bytes`,
        max_bytes: MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES,
      });
      return true;
    }

    const parsedBody = context.parseJsonObjectBody(rawBody);
    if (!parsedBody.ok) {
      context.writeJson(response, 400, {
        error: "invalid_json",
        detail: parsedBody.detail,
      });
      return true;
    }
    const body = parsedBody.body;
    const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
    const scope = normalizeMemoryScope(scopeRaw);
    if (!scope) {
      context.writeJson(response, 400, {
        error: "invalid_scope",
        detail: scopeRaw,
      });
      return true;
    }
    const dryRun = context.parseBodyBool(body.dry_run, false);
    const source = typeof body.source === "string" && body.source.trim().length > 0 ? body.source.trim() : undefined;
    const importResult = context.importMemoryRows(sessionId, scope, body.records, source, dryRun);
    if (!importResult.ok) {
      const payload: Record<string, unknown> = {
        error: "memory_import_failed",
      };
      if (typeof importResult.result.error === "string") {
        payload.detail_error = importResult.result.error;
      }
      for (const [key, value] of Object.entries(importResult.result)) {
        if (key === "error") {
          continue;
        }
        payload[key] = value;
      }
      context.writeJson(response, 400, payload);
      return true;
    }

    if (!dryRun) {
      try {
        await context.persistMemoryStore();
      } catch (error) {
        context.writeJson(response, 400, {
          error: "memory_import_failed",
          detail_error: "memory_store_persist_failed",
          detail: String(error),
        });
        return true;
      }
    }

    context.writeJson(response, 200, {
      status: "ok",
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      scope,
      ...importResult.result,
    });
    return true;
  }

  const memoryForgetMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/forget$/);
  if (method === "POST" && memoryForgetMatch) {
    const sessionId = decodeURIComponent(memoryForgetMatch[1]).trim();
    if (!sessionId) {
      context.writeJson(response, 400, {
        error: "invalid_session_id",
      });
      return true;
    }
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const rawBody = await context.readBody(request);
    const parsedBody = context.parseJsonObjectBody(rawBody);
    if (!parsedBody.ok) {
      context.writeJson(response, 400, {
        error: "invalid_json",
        detail: parsedBody.detail,
      });
      return true;
    }

    const body = parsedBody.body;
    const ids: string[] = [];
    if (typeof body.id === "string" && body.id.trim().length > 0) {
      ids.push(body.id.trim());
    }
    if (Array.isArray(body.ids)) {
      for (const item of body.ids) {
        if (typeof item !== "string") {
          continue;
        }
        const cleaned = item.trim();
        if (cleaned && !ids.includes(cleaned)) {
          ids.push(cleaned);
        }
      }
    }
    const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
    const scope = normalizeMemoryScope(scopeRaw);
    if (!scope) {
      context.writeJson(response, 400, {
        error: "invalid_scope",
        detail: scopeRaw,
      });
      return true;
    }

    const dryRun = context.parseBodyBool(body.dry_run, false);
    const reason = typeof body.reason === "string" && body.reason.trim().length > 0 ? body.reason.trim() : undefined;
    const forgetResult = context.forgetMemoryRows(sessionId, scope, ids, reason, dryRun);
    if (!forgetResult.ok) {
      const payload: Record<string, unknown> = {
        error: "memory_forget_failed",
      };
      if (typeof forgetResult.result.error === "string") {
        payload.detail_error = forgetResult.result.error;
      }
      for (const [key, value] of Object.entries(forgetResult.result)) {
        if (key === "error") {
          continue;
        }
        payload[key] = value;
      }
      context.writeJson(response, 400, payload);
      return true;
    }

    if (!dryRun) {
      try {
        await context.persistMemoryStore();
      } catch (error) {
        context.writeJson(response, 400, {
          error: "memory_forget_failed",
          detail_error: "memory_store_persist_failed",
          detail: String(error),
        });
        return true;
      }
    }

    context.writeJson(response, 200, {
      status: "ok",
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      scope,
      ...forgetResult.result,
    });
    return true;
  }

  const memoryLifecycleMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/lifecycle$/);
  if (method === "POST" && memoryLifecycleMatch) {
    const sessionId = decodeURIComponent(memoryLifecycleMatch[1]).trim();
    if (!sessionId) {
      context.writeJson(response, 400, {
        error: "invalid_session_id",
      });
      return true;
    }
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const rawBody = await context.readBody(request);
    const parsedBody = context.parseJsonObjectBody(rawBody);
    if (!parsedBody.ok) {
      context.writeJson(response, 400, {
        error: "invalid_json",
        detail: parsedBody.detail,
      });
      return true;
    }

    const body = parsedBody.body;
    const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
    const scope = normalizeMemoryScope(scopeRaw);
    if (!scope) {
      context.writeJson(response, 400, {
        error: "invalid_scope",
        detail: scopeRaw,
      });
      return true;
    }
    const dryRun = context.parseBodyBool(body.dry_run, false);
    const lifecycleResult = context.runMemoryLifecycle(sessionId, scope, dryRun);
    if (!lifecycleResult.ok) {
      context.writeJson(response, 400, {
        error: "memory_lifecycle_failed",
        lines: lifecycleResult.lines,
      });
      return true;
    }

    if (!dryRun) {
      try {
        await context.persistMemoryStore();
      } catch (error) {
        context.writeJson(response, 400, {
          error: "memory_lifecycle_failed",
          lines: [`memory lifecycle failed: memory_store_persist_failed (${String(error)})`],
        });
        return true;
      }
    }

    context.writeJson(response, 200, {
      status: "ok",
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      scope,
      dry_run: dryRun,
      lines: lifecycleResult.lines,
    });
    return true;
  }

  if (method === "POST" && path === "/api/v1/memory/lifecycle/run") {
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const rawBody = await context.readBody(request);
    const parsedBody = context.parseJsonObjectBody(rawBody);
    if (!parsedBody.ok) {
      context.writeJson(response, 400, {
        error: "invalid_json",
        detail: parsedBody.detail,
      });
      return true;
    }

    const body = parsedBody.body;
    const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
    const scope = normalizeMemoryScope(scopeRaw);
    if (!scope) {
      context.writeJson(response, 400, {
        error: "invalid_scope",
        detail: scopeRaw,
      });
      return true;
    }
    const dryRun = context.parseBodyBool(body.dry_run, false);

    const sessions: string[] = [];
    if (Array.isArray(body.sessions)) {
      for (const sessionId of body.sessions) {
        if (typeof sessionId !== "string") {
          continue;
        }
        const cleaned = sessionId.trim();
        if (cleaned && !sessions.includes(cleaned)) {
          sessions.push(cleaned);
        }
      }
    }

    const sessionPrefixes: string[] = [];
    if (typeof body.session_prefix === "string" && body.session_prefix.trim().length > 0) {
      sessionPrefixes.push(body.session_prefix.trim());
    }
    if (Array.isArray(body.session_prefixes)) {
      for (const prefix of body.session_prefixes) {
        if (typeof prefix !== "string") {
          continue;
        }
        const cleaned = prefix.trim();
        if (cleaned && !sessionPrefixes.includes(cleaned)) {
          sessionPrefixes.push(cleaned);
        }
      }
    }

    let limit = 20;
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.floor(body.limit);
    } else if (typeof body.limit === "string" && body.limit.trim().length > 0) {
      const parsedLimit = Number.parseInt(body.limit.trim(), 10);
      if (Number.isFinite(parsedLimit)) {
        limit = parsedLimit;
      }
    }
    const normalizedLimit = Math.max(1, Math.min(MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS, limit));

    if (sessions.length === 0 && sessionPrefixes.length === 0) {
      context.writeJson(response, 400, {
        error: "no_target_sessions",
        detail: "Provide sessions[] or session_prefix/session_prefixes.",
      });
      return true;
    }

    const lifecycleResult = context.runMemoryLifecycleAcrossSessions({
      scope,
      dryRun,
      sessions,
      sessionPrefixes,
      limit: normalizedLimit,
    });
    if (!dryRun && lifecycleResult.changed > 0) {
      try {
        await context.persistMemoryStore();
      } catch (error) {
        context.writeJson(response, 400, {
          error: "memory_lifecycle_failed",
          detail_error: "memory_store_persist_failed",
          detail: String(error),
        });
        return true;
      }
    }

    context.writeJson(response, 200, {
      status: lifecycleResult.status,
      timestamp: new Date().toISOString(),
      scope,
      dry_run: dryRun,
      requested_count: lifecycleResult.requestedCount,
      success_count: lifecycleResult.successCount,
      failed_count: lifecycleResult.failedCount,
      actions: lifecycleResult.actions,
      scanned: lifecycleResult.scanned,
      changed: lifecycleResult.changed,
      session_prefixes: sessionPrefixes,
      discovery_truncated: lifecycleResult.discoveryTruncated,
      discovery_warnings: [],
      results: lifecycleResult.results,
    });
    return true;
  }

  return false;
}
