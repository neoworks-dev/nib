import type { CanvasObject } from "@nib-ui/ui-contracts";
import {
  type AnnotationObject,
  CARD_WIDTH,
  type EdgeObject,
  type WorkstreamObject,
} from "./workstream";

export const legacyStorageKey = "nib-ui.canvas";

/** The localStorage document this board format replaces. */
export interface LegacyDoc {
  rootSessionId: string;
  branches: { sessionId: string; fromNodeId: string | null }[];
  joins: { id: string; label: string; sourceIds: string[]; sessionId: string | null }[];
  positions: Record<string, { x: number; y: number }>;
  annotations: { id: string; sessionId: string; messageId: string; text: string; note?: string }[];
}

export interface MigratedBoard {
  cwd: string;
  objects: CanvasObject[];
}

const COLUMN = CARD_WIDTH + 64;
const ROW = 220;

/**
 * One board per working directory, built from every localStorage doc whose root
 * task still exists. Per-turn nodes are gone, so a doc's sessions each become a
 * workstream and its branches and joins become edges between them, 1:1 with the
 * direction and label they had.
 */
export function migrateDocs(
  docs: Record<string, LegacyDoc>,
  cwdFor: (sessionId: string) => string | null,
): MigratedBoard[] {
  const byCwd = new Map<string, CanvasObject[]>();

  for (const doc of Object.values(docs)) {
    const cwd = cwdFor(doc.rootSessionId);
    // A doc whose root task is gone has nothing left to place: the branches that
    // hung off it were only ever meaningful relative to that transcript.
    if (!cwd) continue;

    const objects = byCwd.get(cwd) ?? [];
    const placed = objects.filter((object) => object.kind === "workstream").length;
    objects.push(...migrateDoc(doc, placed));
    byCwd.set(cwd, objects);
  }

  return [...byCwd].map(([cwd, objects]) => ({ cwd, objects }));
}

function migrateDoc(doc: LegacyDoc, alreadyPlaced: number): CanvasObject[] {
  const workstreamBySession = new Map<string, WorkstreamObject>();
  const workstreamByNode = new Map<string, WorkstreamObject>();
  const objects: CanvasObject[] = [];
  let index = alreadyPlaced;

  const place = (
    id: string,
    sessionId: string | null,
    goal: string,
    nodeIds: string[],
  ): WorkstreamObject => {
    const carried = carriedPosition(doc.positions, nodeIds);
    const workstream: WorkstreamObject = {
      kind: "workstream",
      id,
      goal,
      ...(sessionId && { sessionId }),
      x: carried?.x ?? (index % 4) * COLUMN,
      y: carried?.y ?? Math.floor(index / 4) * ROW,
    };
    index += 1;
    objects.push(workstream);
    if (sessionId) workstreamBySession.set(sessionId, workstream);
    return workstream;
  };

  const sessionIds = [doc.rootSessionId, ...doc.branches.map((branch) => branch.sessionId)];
  for (const sessionId of dedupe(sessionIds)) {
    place(`workstream:${sessionId}`, sessionId, "", positionKeysFor(doc.positions, sessionId));
  }

  // A join was a board node in its own right, launched or not, so it stays one.
  for (const join of doc.joins) {
    const workstream = place(`workstream:${join.id}`, join.sessionId, join.label, [join.id]);
    workstreamByNode.set(join.id, workstream);
  }

  for (const [sessionId, workstream] of workstreamBySession) {
    for (const key of positionKeysFor(doc.positions, sessionId))
      workstreamByNode.set(key, workstream);
  }

  const resolve = (nodeId: string): WorkstreamObject | null => {
    const direct = workstreamByNode.get(nodeId);
    if (direct) return direct;
    // Exchange ids were `sessionId#messageId`, so the owning session is in the id.
    const separator = nodeId.indexOf("#");
    if (separator <= 0) return null;
    return workstreamBySession.get(nodeId.slice(0, separator)) ?? null;
  };

  for (const branch of doc.branches) {
    const to = workstreamBySession.get(branch.sessionId);
    const from = branch.fromNodeId ? resolve(branch.fromNodeId) : null;
    if (!to || !from || from === to) continue;
    objects.push(edge(from.id, to.id, "branch"));
  }

  for (const join of doc.joins) {
    const to = workstreamByNode.get(join.id);
    if (!to) continue;
    for (const sourceId of join.sourceIds) {
      const from = resolve(sourceId);
      if (!from || from === to) continue;
      objects.push(edge(from.id, to.id, "join"));
    }
  }

  for (const annotation of doc.annotations) {
    const carried: AnnotationObject = {
      kind: "annotation",
      id: `annotation:${annotation.id}`,
      sessionId: annotation.sessionId,
      messageId: annotation.messageId,
      text: annotation.text,
      ...(annotation.note && { note: annotation.note }),
    };
    objects.push(carried);
  }

  return objects;
}

function edge(fromId: string, toId: string, label: string): EdgeObject {
  return {
    kind: "edge",
    id: `edge:${fromId}->${toId}:${label}`,
    fromId,
    toId,
    label,
    direction: "forward",
  };
}

function positionKeysFor(positions: LegacyDoc["positions"], sessionId: string): string[] {
  return Object.keys(positions).filter((key) => key.startsWith(`${sessionId}#`));
}

/**
 * The chain's first exchange is the one the user placed highest, so the topmost
 * dragged node is what the workstream inherits. Without the transcripts the
 * migration cannot ask which turn came first.
 */
function carriedPosition(
  positions: LegacyDoc["positions"],
  nodeIds: string[],
): { x: number; y: number } | null {
  const points = nodeIds.map((nodeId) => positions[nodeId]).filter((point) => point !== undefined);
  if (points.length === 0) return null;
  return points.reduce((best, point) =>
    point.y < best.y || (point.y === best.y && point.x < best.x) ? point : best,
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Hand-editable storage and older builds both land here, so nothing is trusted. */
export function parseLegacyDocs(input: unknown): Record<string, LegacyDoc> {
  if (!input || typeof input !== "object") return {};
  const docs: Record<string, LegacyDoc> = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Partial<LegacyDoc>;
    if (typeof candidate.rootSessionId !== "string") continue;

    docs[key] = {
      rootSessionId: candidate.rootSessionId,
      branches: asArray(candidate.branches).filter(
        (branch): branch is LegacyDoc["branches"][number] =>
          typeof (branch as { sessionId?: unknown }).sessionId === "string",
      ),
      joins: asArray(candidate.joins).filter(
        (join): join is LegacyDoc["joins"][number] =>
          typeof (join as { id?: unknown }).id === "string" &&
          Array.isArray((join as { sourceIds?: unknown }).sourceIds),
      ),
      positions: parsePositions(candidate.positions),
      annotations: asArray(candidate.annotations).filter(
        (annotation): annotation is LegacyDoc["annotations"][number] => {
          const entry = annotation as Partial<LegacyDoc["annotations"][number]>;
          return (
            typeof entry.id === "string" &&
            typeof entry.sessionId === "string" &&
            typeof entry.messageId === "string" &&
            typeof entry.text === "string"
          );
        },
      ),
    };
  }
  return docs;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parsePositions(value: unknown): LegacyDoc["positions"] {
  if (!value || typeof value !== "object") return {};
  const positions: LegacyDoc["positions"] = {};
  for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
    const candidate = point as { x?: unknown; y?: unknown };
    if (typeof candidate.x === "number" && typeof candidate.y === "number") {
      positions[id] = { x: candidate.x, y: candidate.y };
    }
  }
  return positions;
}
