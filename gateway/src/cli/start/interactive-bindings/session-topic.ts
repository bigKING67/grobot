import type { RunStartWire } from "../wire";

export function resolveSessionTopicBySessionId(input: {
  wire: RunStartWire;
  sessionId: string;
}): string | undefined {
  const session = input.wire.sessionOps
    .listSessions()
    .find((entry) => entry.id === input.sessionId);
  if (!session) {
    return undefined;
  }
  const title = session.title.trim();
  if (title.length > 0) {
    return title;
  }
  const summary = session.summary.trim();
  return summary.length > 0 ? summary : undefined;
}
