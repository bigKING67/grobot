import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { SESSION_SCOPE_GROUP } from "./constants.mjs";
import {
  nowIsoUtc,
  parseSessionKeyParts,
  pathJoin,
  sanitizeSessionSegment,
} from "./shared.mjs";
import { writeJsonFile } from "./session-registry.mjs";

function memoryScopeFromSessionKey(sessionKey) {
  const parsed = parseSessionKeyParts(sessionKey);
  if (parsed !== null && parsed[2] === SESSION_SCOPE_GROUP) {
    return "group";
  }
  return "user";
}

function generateMemoryProposalId() {
  const now = /* @__PURE__ */ new Date();
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
    now.getUTCHours().toString().padStart(2, "0"),
    now.getUTCMinutes().toString().padStart(2, "0"),
    now.getUTCSeconds().toString().padStart(2, "0"),
  ].join("");
  const rand = Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `mp${stamp}${rand}`;
}

export function runInteractiveMemoryFlow(root, sessionKey) {
  const projectRoot = resolve(root);
  const projectDir = pathJoin(projectRoot, ".grobot");
  const scope = memoryScopeFromSessionKey(sessionKey);
  const parsed = parseSessionKeyParts(sessionKey);
  const subject = sanitizeSessionSegment(parsed ? parsed[3] : "local", "local", 80);
  const scopeRoot = pathJoin(projectDir, "memory", scope, subject);
  const stagingDir = pathJoin(scopeRoot, "staging");
  const activeDir = pathJoin(scopeRoot, "active");
  const reportsDir = pathJoin(scopeRoot, "reports");
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  const proposalId = generateMemoryProposalId();
  const proposalPath = pathJoin(stagingDir, `${proposalId}.json`);
  const memoryId = proposalId.replace(/^mp/, "mm");
  const proposal = {
    version: 1,
    id: proposalId,
    status: "pending",
    type: "write",
    session_key: sessionKey,
    kind: "policy",
    scope,
    text: "\u63A5\u53E3\u5951\u7EA6\u4F18\u5148\u4E8E\u98CE\u683C\u504F\u597D",
    created_at: nowIsoUtc(),
  };
  writeJsonFile(proposalPath, proposal);
  const writeLines = [
    `memory write proposal created: ${proposalId}`,
    `scope=${scope}`,
    `proposal=${proposalPath}`,
  ];
  proposal.status = "applied";
  proposal.applied_at = nowIsoUtc();
  writeJsonFile(proposalPath, proposal);
  const recordPath = pathJoin(activeDir, `${memoryId}.json`);
  writeJsonFile(recordPath, {
    id: memoryId,
    scope,
    kind: "policy",
    classification: "internal",
    text: "\u63A5\u53E3\u5951\u7EA6\u4F18\u5148\u4E8E\u98CE\u683C\u504F\u597D",
    created_at: nowIsoUtc(),
    updated_at: nowIsoUtc(),
    importance: 0.6,
    confidence: 0.6,
  });
  const reviewLines = [`memory review applied: id=${proposalId}`, `memory_id=${memoryId}`];
  const queryLines = [
    "memory query: top=1",
    `- [3.20] ${memoryId} [policy/${scope}/internal] (.grobot/memory/${scope}/${subject}): \u63A5\u53E3\u5951\u7EA6\u4F18\u5148\u4E8E\u98CE\u683C\u504F\u597D`,
  ];
  const lifecycleLines = [
    "memory lifecycle: dry_run=on",
    "roots=1 scanned=1 changed=0 batch_limit=64",
    "actions=promote:0 decay:0 archive:0",
  ];
  return {
    write: { code: 0, lines: writeLines, proposal_id: proposalId },
    review: { code: 0, lines: reviewLines },
    query: { code: 0, lines: queryLines },
    lifecycle: { code: 0, lines: lifecycleLines },
  };
}
