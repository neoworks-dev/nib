import type { StagedAnnotation } from "@nib-ui/plugin-chat";
import type { ChangedFile } from "@nib-ui/plugin-renderer-diff/changed-files";
import type { HarnessDescriptor, SessionView } from "@nib-ui/protocol";
import type { CanvasObject } from "@nib-ui/ui-contracts";
import { toExchanges } from "./exchanges";
import type { Exchange, TracedStep } from "./model";
import { summariseSteps } from "./steps";

export const CARD_WIDTH = 288;
export const CARD_MIN_WIDTH = 200;
export const CARD_MIN_HEIGHT = 120;

export type EdgeDirection = "forward" | "backward" | "both" | "none";

/**
 * At most one harness session, and none at all until it is launched. Title,
 * status, model and steps are derived from the live `SessionView`, never copied
 * here — the board stores placement and authored content only.
 */
export interface WorkstreamObject extends CanvasObject {
  kind: "workstream";
  sessionId?: string;
  goal: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /**
   * When the user last marked the workstream read. Absent means it still wants
   * attention, which is what keeps it in the project list; the mark is set from
   * that list, so the server writes it whether or not this board is open.
   */
  reviewedAt?: number;
  /**
   * What the workstream is to be started with. A goal is written down before it
   * runs, so the harness, model, permission mode and effort are chosen the same
   * way and wait here; once the session exists it owns them and these are only
   * the record of what it was started with.
   */
  harnessId?: string;
  model?: string;
  permissionMode?: string;
  effort?: string;
}

/** The four composer pills, resolved for a workstream that has not been launched. */
export interface LaunchSettings {
  harnessId: string | null;
  model: string | null;
  permissionMode: string | null;
  effort: string | null;
}

/**
 * The picks themselves, before they are resolved. A card carries them, and so
 * does the board's own composer, which has no card to keep them on until it sends.
 */
export interface LaunchPicks {
  harnessId?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  effort?: string | null;
}

/**
 * What the composer shows for an unlaunched workstream: the user's own pick where
 * there is one, and otherwise what the harness says it starts with — the same
 * pre-flight the composer of a running session does off the harness descriptor.
 */
export function launchSettings(
  picks: LaunchPicks,
  harnesses: HarnessDescriptor[],
  fallbackHarnessId: string | null = null,
): LaunchSettings {
  const harnessId = picks.harnessId ?? fallbackHarnessId ?? harnesses[0]?.id ?? null;
  const harness = harnesses.find((entry) => entry.id === harnessId) ?? null;

  return {
    harnessId,
    model: picks.model ?? harness?.defaultModel ?? harness?.models[0]?.id ?? null,
    permissionMode: picks.permissionMode ?? harness?.defaultPermissionMode ?? null,
    effort: picks.effort ?? null,
  };
}

/** Create options for `sessions.create`; a harness ignores the keys it has no use for. */
export function launchOptions(settings: LaunchSettings): Record<string, unknown> {
  return {
    ...(settings.model && { model: settings.model }),
    ...(settings.permissionMode && { permissionMode: settings.permissionMode }),
    ...(settings.effort && { effort: settings.effort }),
  };
}

export interface EdgeObject extends CanvasObject {
  kind: "edge";
  fromId: string;
  toId: string;
  label: string;
  direction: EdgeDirection;
  /**
   * The files the source stands for have gone to the task already. Set when a
   * prompt carries them, so a picture linked to a running task is sent once
   * rather than again with every turn.
   */
  carried?: boolean;
}

/**
 * A passage pinned out of a transcript. It has no renderer of its own: the
 * workstream whose session it belongs to draws it as a badge, and the chat
 * drawer stages it against the same session.
 */
export interface AnnotationObject extends CanvasObject {
  kind: "annotation";
  sessionId: string;
  messageId: string;
  text: string;
  note?: string;
}

export type WorkstreamStatus = SessionView["status"] | "unlaunched" | "detached";

/**
 * Everything a card draws. None of it is stored on the board: a title, a status
 * and the steps a turn took all come from the live transcript, so the card and
 * the drawer can never disagree about what a session did.
 */
export interface WorkstreamView {
  id: string;
  sessionId: string | null;
  title: string;
  goal: string;
  status: WorkstreamStatus;
  working: boolean;
  /** A permission request is waiting; the card has to say so without opening it. */
  asking: boolean;
  model: string | null;
  /** The agent's last prose answer — what the workstream currently amounts to. */
  output: string;
  steps: TracedStep[];
  stepSummary: string;
  changes: ChangedFile[];
  turnCount: number;
  annotations: StagedAnnotation[];
  /** Turn to scroll the drawer to when the card is opened. */
  anchorMessageId: string | null;
}

export function isWorkstream(object: CanvasObject): object is WorkstreamObject {
  return object.kind === "workstream";
}

export function isEdge(object: CanvasObject): object is EdgeObject {
  return object.kind === "edge";
}

/** Defensive: the board is hand-editable, and an older build wrote fewer fields. */
export function parseWorkstream(raw: unknown): WorkstreamObject | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<WorkstreamObject>;
  if (candidate.kind !== "workstream" || typeof candidate.id !== "string") return null;
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") return null;

  return {
    kind: "workstream",
    id: candidate.id,
    x: candidate.x,
    y: candidate.y,
    goal: typeof candidate.goal === "string" ? candidate.goal : "",
    ...(typeof candidate.sessionId === "string" && { sessionId: candidate.sessionId }),
    ...(typeof candidate.reviewedAt === "number" &&
      Number.isFinite(candidate.reviewedAt) && { reviewedAt: candidate.reviewedAt }),
    ...(typeof candidate.harnessId === "string" && { harnessId: candidate.harnessId }),
    ...(typeof candidate.model === "string" && { model: candidate.model }),
    ...(typeof candidate.permissionMode === "string" && {
      permissionMode: candidate.permissionMode,
    }),
    ...(typeof candidate.effort === "string" && { effort: candidate.effort }),
    ...(typeof candidate.w === "number" && { w: Math.max(CARD_MIN_WIDTH, candidate.w) }),
    ...(typeof candidate.h === "number" && { h: Math.max(CARD_MIN_HEIGHT, candidate.h) }),
  };
}

export function parseEdge(raw: unknown): EdgeObject | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<EdgeObject>;
  if (candidate.kind !== "edge" || typeof candidate.id !== "string") return null;
  if (typeof candidate.fromId !== "string" || typeof candidate.toId !== "string") return null;

  const direction = candidate.direction;
  return {
    kind: "edge",
    id: candidate.id,
    fromId: candidate.fromId,
    toId: candidate.toId,
    label: typeof candidate.label === "string" ? candidate.label : "",
    direction:
      direction === "backward" || direction === "both" || direction === "none"
        ? direction
        : "forward",
    ...(candidate.carried === true && { carried: true }),
  };
}

/**
 * Folds a workstream's session into what the card shows. A workstream without a
 * session is a goal the user wrote down and has not launched; one whose session
 * is not loaded reads as detached rather than as empty.
 *
 * `launchModel` is what the card would start with — `launchSettings` resolves it
 * from the user's pick or the harness default — so a card names its model before
 * there is a session to report one.
 */
export function workstreamView(
  object: WorkstreamObject,
  session: SessionView | null,
  annotations: StagedAnnotation[] = [],
  launchModel: string | null = null,
): WorkstreamView {
  const goal = object.goal.trim();
  if (!object.sessionId) {
    return {
      id: object.id,
      sessionId: null,
      title: goal.length > 0 ? firstLine(goal) : "New workstream",
      goal,
      status: "unlaunched",
      working: false,
      asking: false,
      model: object.model ?? launchModel,
      output: "",
      steps: [],
      stepSummary: "",
      changes: [],
      turnCount: 0,
      annotations: [],
      anchorMessageId: null,
    };
  }

  if (!session) {
    return {
      id: object.id,
      sessionId: object.sessionId,
      title: goal.length > 0 ? firstLine(goal) : "Workstream",
      goal,
      status: "detached",
      working: false,
      asking: false,
      // The record of what it was started with; a harness default would be a guess
      // about a session this build cannot read.
      model: object.model ?? null,
      output: "",
      steps: [],
      stepSummary: "",
      changes: [],
      turnCount: 0,
      annotations: [],
      anchorMessageId: null,
    };
  }

  const exchanges = toExchanges(session);
  const last = exchanges.at(-1) ?? null;
  const steps = exchanges.flatMap((exchange) => exchange.steps);
  const owned = annotations.filter((annotation) => annotation.sessionId === session.sessionId);

  return {
    id: object.id,
    sessionId: session.sessionId,
    title: session.title ?? (goal.length > 0 ? firstLine(goal) : "Workstream"),
    goal: goal.length > 0 ? goal : (exchanges[0]?.prompt ?? ""),
    status: session.status,
    working: session.status === "working",
    asking: session.pendingPermissions.length > 0,
    model: session.model ?? object.model ?? null,
    output: last?.reply ?? "",
    steps,
    stepSummary: summariseSteps(steps),
    changes: mergeChanges(exchanges),
    turnCount: exchanges.length,
    annotations: owned,
    anchorMessageId: last?.messageId ?? null,
  };
}

/** Every path the workstream touched, with its totals across all of its turns. */
function mergeChanges(exchanges: Exchange[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const exchange of exchanges) {
    for (const file of exchange.changes) {
      const existing = byPath.get(file.path);
      if (!existing) {
        byPath.set(file.path, { ...file });
        continue;
      }
      existing.added += file.added;
      existing.removed += file.removed;
    }
  }
  return [...byPath.values()];
}

function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim().length > 0) ?? text;
  return line.trim();
}

/** Board ids of the workstreams an edge connects, so a delete can cascade. */
export function edgeEndpoints(objects: CanvasObject[]): Map<string, EdgeObject[]> {
  const byWorkstream = new Map<string, EdgeObject[]>();
  for (const object of objects) {
    if (!isEdge(object)) continue;
    for (const endpoint of [object.fromId, object.toId]) {
      byWorkstream.set(endpoint, [...(byWorkstream.get(endpoint) ?? []), object]);
    }
  }
  return byWorkstream;
}

/**
 * The card under a board point, or null for empty space — which is what decides
 * whether something dropped there is context for a task or an object of its own.
 * The card drawn last wins, as it is the one on top.
 */
export function workstreamAt(
  objects: CanvasObject[],
  point: { x: number; y: number },
): WorkstreamObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index]!;
    if (!isWorkstream(object)) continue;
    const width = Math.max(CARD_MIN_WIDTH, object.w ?? CARD_WIDTH);
    const height = Math.max(CARD_MIN_HEIGHT, object.h ?? CARD_MIN_HEIGHT);
    const inside =
      point.x >= object.x &&
      point.x <= object.x + width &&
      point.y >= object.y &&
      point.y <= object.y + height;
    if (inside) return object;
  }
  return null;
}

/**
 * Where a new card goes when nothing said. Boards are placed by hand now, so
 * this only has to avoid dropping one exactly on top of another.
 */
export function freeSlot(
  objects: CanvasObject[],
  near: { x: number; y: number },
): { x: number; y: number } {
  const taken = objects.filter(isWorkstream);
  let { x, y } = near;
  let guard = 0;

  while (
    guard < 200 &&
    taken.some((object) => Math.abs(object.x - x) < 24 && Math.abs(object.y - y) < 24)
  ) {
    x += 32;
    y += 32;
    guard += 1;
  }
  return { x, y };
}
