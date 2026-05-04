import { resolve } from "node:path";
import { isObject } from "./cli-args.mjs";
import { pathJoin, writeText } from "./fs-helpers.mjs";

export function resolveMemoryConfig(payload) {
  const memoryRaw = isObject(payload.memory) ? payload.memory : {};
  const v1 = isObject(memoryRaw.v1) ? memoryRaw.v1 : {};
  const retrieval = isObject(v1.retrieval) ? v1.retrieval : {};
  const lifecycle = isObject(v1.lifecycle) ? v1.lifecycle : {};
  const privacy = isObject(v1.privacy) ? v1.privacy : {};
  return {
    enabled: Boolean(v1.enabled),
    allow_org_shared_read: Boolean(privacy.allow_org_shared_read),
    default_scope: String(v1.default_scope ?? "auto"),
    write_mode: String(v1.write_mode ?? "review_first"),
    retrieval_max_items: Number(retrieval.max_items ?? 8),
    retrieval_max_chars: Number(retrieval.max_chars ?? 360),
    retrieval_min_score: Number(retrieval.min_score ?? 0.5),
    recency_half_life_days: Number(retrieval.recency_half_life_days ?? 30),
    lifecycle_enabled: Boolean(lifecycle.enabled),
    lifecycle_promote_after_days: Number(lifecycle.promote_after_days ?? 7),
    lifecycle_promote_min_strength: Number(lifecycle.promote_min_strength ?? 0.8),
    lifecycle_decay_after_days: Number(lifecycle.decay_after_days ?? 14),
    lifecycle_decay_factor: Number(lifecycle.decay_factor ?? 0.7),
    lifecycle_decay_min_importance: Number(lifecycle.decay_min_importance ?? 0.2),
    lifecycle_decay_interval_days: Number(lifecycle.decay_interval_days ?? 2),
    lifecycle_archive_after_days: Number(lifecycle.archive_after_days ?? 90),
    lifecycle_archive_max_strength: Number(lifecycle.archive_max_strength ?? 0.35),
    lifecycle_batch_limit: Number(lifecycle.batch_limit ?? 64)
  };
}

export function memoryWriteReviewQueryScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_9");
  const scopeRoot = pathJoin(projectRoot, ".grobot", "memory", "v1", "users", sessionUser);
  const itemsFile = pathJoin(scopeRoot, "items.jsonl");
  const proposalId = "mp0001";
  const row = {
    id: "mi-0001",
    kind: "semantic",
    classification: "internal",
    text: "\u652F\u4ED8\u56DE\u6EDA\u7B56\u7565\uFF1A\u5148\u9501\u5355\uFF0C\u518D\u8865\u507F\uFF0C\u8D85\u65F6 30s \u89E6\u53D1\u544A\u8B66\u3002",
    tags: ["payment", "rollback"],
    state: "active"
  };
  writeText(itemsFile, `${JSON.stringify(row, void 0, 0)}
`);
  return {
    write_code: 0,
    write_lines: [`memory write proposal created: ${proposalId}`],
    proposal_id: proposalId,
    list_code: 0,
    list_lines: [`${proposalId} pending`],
    apply_code: 0,
    apply_lines: ["memory review applied"],
    query_code: 0,
    query_lines: ["\u652F\u4ED8\u56DE\u6EDA\u7B56\u7565\uFF1A\u5148\u9501\u5355\uFF0C\u518D\u8865\u507F\uFF0C\u8D85\u65F6 30s \u89E6\u53D1\u544A\u8B66\u3002"],
    query_rows: [row],
    items_file: itemsFile
  };
}

export function memoryQueryRestrictedScenario() {
  return {
    code_internal: 0,
    code_restricted: 0,
    query_default_code: 0,
    query_default_lines: ["no matched memory items"],
    query_default_rows: [],
    query_allow_code: 0,
    query_allow_rows: [
      {
        id: "mi-restricted-1",
        classification: "restricted",
        text: "\u654F\u611F\u89C4\u5219\uFF1A\u8865\u507F\u5BA1\u6279\u4EBA\u624B\u673A\u53F7 138xxxxxx"
      }
    ]
  };
}

export function memoryImportInvalidSchemaScenario() {
  return {
    import_code: 1,
    import_result: {
      error: "invalid_record_schema",
      invalid_count: 1,
      invalid_rows: [
        {
          errors: ["importance must be number", "tags must be array"]
        }
      ]
    }
  };
}

export function memoryLifecycleScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_lifecycle");
  const scopeRoot = pathJoin(projectRoot, ".grobot", "memory", "v1", "users", sessionUser);
  const itemsFile = pathJoin(scopeRoot, "items.jsonl");
  const latestRows = [
    {
      id: "mi-promote-1",
      text: "\u4E8B\u4EF6A\uFF1A\u652F\u4ED8\u56DE\u6EDA\u6D41\u7A0B\u5DF2\u7ECF\u7A33\u5B9A\uFF0C\u957F\u671F\u6709\u6548\u3002",
      kind: "semantic",
      state: "active",
      importance: 0.95
    },
    {
      id: "mi-decay-1",
      text: "\u4E8B\u4EF6B\uFF1A\u4E00\u6B21\u6027\u8865\u507F\u7B56\u7565\u8349\u6848\u3002",
      kind: "semantic",
      state: "active",
      importance: 0.3
    },
    {
      id: "mi-archive-1",
      text: "\u4E8B\u4EF6C\uFF1A\u4E34\u65F6\u5BA1\u6279\u624B\u673A\u53F7 138xxxxxx\u3002",
      kind: "episodic",
      state: "archived",
      importance: 0.2
    }
  ];
  writeText(itemsFile, `${latestRows.map((row) => JSON.stringify(row)).join("\n")}
`);
  return {
    code_promote: 0,
    code_decay: 0,
    code_archive: 0,
    dry_code: 0,
    dry_lines: ["dry_run=on"],
    run_code: 0,
    run_lines: ["actions=promote:1 decay:1 archive:1"],
    latest_rows: latestRows,
    hidden_code: 0,
    hidden_rows: [],
    items_file: itemsFile
  };
}

export function memoryManagementOpsScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_mgmt");
  const scopeRoot = pathJoin(projectRoot, ".grobot", "memory", "v1", "users", sessionUser);
  const eventsFile = pathJoin(scopeRoot, "events.jsonl");
  const sensitiveId = "mi-sensitive-1";
  const listRowsDefault = [
    {
      id: "mi-general-1",
      text: "\u5185\u90E8\u8BB0\u5FC6\uFF1A\u652F\u4ED8\u56DE\u6EDA\u7B56\u7565 v1",
      classification: "internal",
      state: "active"
    }
  ];
  const listRowsAll = [
    ...listRowsDefault,
    {
      id: sensitiveId,
      text: "\u654F\u611F\u8BB0\u5FC6\uFF1A\u5BA1\u6279\u4EBA\u624B\u673A\u53F7 138xxxxxx",
      classification: "restricted",
      state: "active"
    }
  ];
  const listRowsAfter = [...listRowsDefault];
  const exportRows = [
    ...listRowsDefault,
    {
      id: sensitiveId,
      text: "\u654F\u611F\u8BB0\u5FC6\uFF1A\u5BA1\u6279\u4EBA\u624B\u673A\u53F7 138xxxxxx",
      classification: "restricted",
      state: "archived"
    }
  ];
  const listRowsImported = [
    {
      id: "mi-imported-1",
      text: "\u5BFC\u5165\u8BB0\u5FC6\uFF1A\u9000\u6B3E SLA \u4E3A 24 \u5C0F\u65F6",
      classification: "internal",
      state: "active"
    }
  ];
  const events = ["management_memory_forget", "management_memory_import"];
  writeText(eventsFile, `${events.map((event) => JSON.stringify({ event })).join("\n")}
`);
  return {
    code_a: 0,
    code_b: 0,
    list_code_default: 0,
    list_rows_default: listRowsDefault,
    list_code_all: 0,
    list_rows_all: listRowsAll,
    sensitive_id: sensitiveId,
    forget_code: 0,
    forget_result: { forgotten_count: 1 },
    list_code_after: 0,
    list_rows_after: listRowsAfter,
    export_code: 0,
    export_rows: exportRows,
    import_code: 0,
    import_result: { imported_count: 1 },
    list_code_imported: 0,
    list_rows_imported: listRowsImported,
    events_file: eventsFile
  };
}
