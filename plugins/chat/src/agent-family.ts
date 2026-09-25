import type { SessionSummary } from "@nib-ui/ui-contracts";

/**
 * Every session one agent's family holds: the session a user started, then what
 * its agents spawned, and what those spawned in turn. Depth-first from the root
 * and by age within a parent, so a tab strip drawn from this reads as the tree
 * it is — a parent always precedes the agents it started.
 *
 * A parent that is not in the list stops the walk rather than dropping the
 * session: the list is a snapshot, and an archived or deleted parent must not
 * hide the work under it.
 */
export function agentFamily(summaries: SessionSummary[], sessionId: string): SessionSummary[] {
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  const start = byId.get(sessionId);
  if (!start) return [];

  let root = start;
  const climbed = new Set([root.id]);
  for (;;) {
    const parentId = root.parentSessionId;
    if (!parentId || climbed.has(parentId)) break;
    const parent = byId.get(parentId);
    if (!parent) break;
    root = parent;
    climbed.add(parent.id);
  }

  const children = new Map<string, SessionSummary[]>();
  for (const summary of summaries) {
    const parentId = summary.parentSessionId;
    if (!parentId || parentId === summary.id) continue;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(summary);
    else children.set(parentId, [summary]);
  }
  for (const siblings of children.values())
    siblings.sort(
      (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );

  const family: SessionSummary[] = [];
  const seen = new Set<string>();
  const walk = (summary: SessionSummary): void => {
    if (seen.has(summary.id)) return;
    seen.add(summary.id);
    family.push(summary);
    for (const child of children.get(summary.id) ?? []) walk(child);
  };
  walk(root);
  return family;
}
