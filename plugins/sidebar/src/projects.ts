import type { SessionStatus } from "@nib-ui/protocol";
import {
  type BoardSummary,
  type BoardWorkstream,
  type SessionSummary,
  workspaceName,
} from "@nib-ui/ui-contracts";

/** A workstream is active while its session is doing something or waiting on the user. */
const activeStatuses: SessionStatus[] = ["working", "awaiting-permission"];

export interface WorkstreamRow {
  id: string;
  cwd: string;
  title: string;
  sessionId: string | null;
  /** Null for a goal that was written down but never launched. */
  status: SessionStatus | null;
  active: boolean;
  reviewed: boolean;
  updatedAt: number;
}

export interface ProjectRow {
  path: string;
  name: string;
  /** Only what still wants attention: active work, and anything not yet marked read. */
  workstreams: WorkstreamRow[];
  activeCount: number;
  updatedAt: number;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim().length > 0) ?? "";
  return line.trim();
}

function normalizePath(path: string): string {
  return path.replace(/(.)\/+$/, "$1");
}

function toRow(
  workstream: BoardWorkstream,
  cwd: string,
  summaries: SessionSummary[],
): WorkstreamRow {
  const summary = workstream.sessionId
    ? (summaries.find((entry) => entry.id === workstream.sessionId) ?? null)
    : null;
  const goal = firstLine(workstream.goal);

  return {
    id: workstream.id,
    cwd,
    title: summary?.title ?? (goal.length > 0 ? goal : "Workstream"),
    sessionId: workstream.sessionId,
    status: summary?.status ?? null,
    active: summary ? activeStatuses.includes(summary.status) : false,
    reviewed: workstream.reviewedAt !== null,
    updatedAt: summary?.updatedAt ?? 0,
  };
}

/**
 * What the project list shows: one row per directory that has a board or has
 * been worked in, carrying the workstreams that still want attention. A reviewed
 * workstream that is doing nothing drops out; one that starts working again
 * comes back, since being active outranks the mark.
 *
 * A project keeps its row even when nothing on it is outstanding — the list is
 * how a project is reached, so emptying it would strand the board.
 */
export function projectRows(
  boards: BoardSummary[],
  summaries: SessionSummary[],
  recentDirectories: string[] = [],
): ProjectRow[] {
  const rows = new Map<string, ProjectRow>();

  for (const board of boards) {
    const path = normalizePath(board.cwd);
    if (path.length === 0) continue;

    const workstreams = board.workstreams
      .map((workstream) => toRow(workstream, board.cwd, summaries))
      .filter((row) => row.active || !row.reviewed)
      .sort(
        (left, right) =>
          Number(right.active) - Number(left.active) || right.updatedAt - left.updatedAt,
      );

    rows.set(path, {
      path,
      name: workspaceName(path),
      workstreams,
      activeCount: workstreams.filter((row) => row.active).length,
      updatedAt: workstreams.reduce((newest, row) => Math.max(newest, row.updatedAt), 0),
    });
  }

  // A directory picked a moment ago has no board until something is placed on it,
  // and it still has to be reachable from the list that opened it.
  for (const directory of recentDirectories) {
    const path = normalizePath(directory);
    if (path.length === 0 || rows.has(path)) continue;
    rows.set(path, {
      path,
      name: workspaceName(path),
      workstreams: [],
      activeCount: 0,
      updatedAt: 0,
    });
  }

  for (const summary of summaries) {
    const path = normalizePath(summary.cwd);
    const row = rows.get(path);
    if (row) row.updatedAt = Math.max(row.updatedAt, summary.updatedAt);
  }

  return [...rows.values()].sort(
    (left, right) =>
      right.activeCount - left.activeCount ||
      right.updatedAt - left.updatedAt ||
      left.name.localeCompare(right.name),
  );
}
