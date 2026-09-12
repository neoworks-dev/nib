import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BoardDoc,
  type BoardSummary,
  type BoardWrite,
  type BoardWorkstream,
  type CanvasObject,
  emptyBoard,
  type PaneFrame,
  type PaneInstance,
  type PaneLayout,
  type PaneNode,
  type PaneRect,
} from "@nib-ui/ui-contracts";
import { parsePlacements, parseStacks } from "@nib-ui/vault";

/** Directory names are not portable filenames, and a board is one per directory. */
export function boardFileName(cwd: string): string {
  return `${createHash("sha256").update(cwd).digest("hex")}.json`;
}

export class StaleBoardWriteError extends Error {
  constructor(readonly current: number) {
    super(`board revision ${current + 1} expected`);
    this.name = "StaleBoardWriteError";
  }
}

/**
 * Hand-editable storage and older builds both land here. An object whose kind no
 * plugin claims is kept as it was found: dropping it would silently delete a
 * user's media the moment they ran a build without the media plugin.
 */
export function parseBoard(raw: unknown, cwd: string): BoardDoc {
  if (!raw || typeof raw !== "object") return emptyBoard(cwd);
  const candidate = raw as Partial<BoardDoc>;
  const rev =
    typeof candidate.rev === "number" && Number.isFinite(candidate.rev)
      ? Math.max(0, candidate.rev)
      : 0;

  const layout = parseLayout(candidate.layout);

  return {
    version: 1,
    rev,
    cwd: typeof candidate.cwd === "string" && candidate.cwd.length > 0 ? candidate.cwd : cwd,
    objects: parseObjects(candidate.objects),
    placements: parsePlacements(candidate.placements),
    stacks: parseStacks(candidate.stacks),
    ...(layout ? { layout } : {}),
  };
}

/**
 * The pane layout is this window's furniture, not the user's work: anything that
 * does not parse is dropped rather than kept, and a board with no readable layout
 * simply opens with no panes.
 */
export function parseLayout(value: unknown): PaneLayout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PaneLayout>;

  const instances = new Map<string, PaneInstance>();
  for (const entry of Array.isArray(candidate.instances) ? candidate.instances : []) {
    if (!entry || typeof entry !== "object") continue;
    const { instanceId, paneId, params } = entry as Partial<PaneInstance>;
    if (typeof instanceId !== "string" || typeof paneId !== "string") continue;
    if (instances.has(instanceId)) continue;
    const keeps = params && typeof params === "object" && !Array.isArray(params);
    instances.set(
      instanceId,
      keeps
        ? { instanceId, paneId, params: params as Record<string, unknown> }
        : { instanceId, paneId },
    );
  }

  // A leaf can only appear once in the layout: two frames claiming one instance
  // would each render it, and the second claim is the one that loses.
  const placed = new Set<string>();
  const frames: PaneFrame[] = [];
  for (const entry of Array.isArray(candidate.frames) ? candidate.frames : []) {
    if (!entry || typeof entry !== "object") continue;
    const { frameId, rect, root } = entry as Partial<PaneFrame>;
    const parsedRect = parseRect(rect);
    // The tree is only read once the frame is known to be keepable: reading it
    // claims its instances, and a frame that is dropped must claim nothing.
    if (typeof frameId !== "string" || !parsedRect) continue;
    if (frames.some((frame) => frame.frameId === frameId)) continue;
    const parsedRoot = parseNode(root, instances, placed);
    if (!parsedRoot) continue;
    frames.push({ frameId, rect: parsedRect, root: parsedRoot });
  }

  if (frames.length === 0) return undefined;
  return { frames, instances: [...placed].map((instanceId) => instances.get(instanceId)!) };
}

function parseRect(value: unknown): PaneRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { x, y, width, height } = value as Partial<PaneRect>;
  const finite = [x, y, width, height].every(
    (entry) => typeof entry === "number" && Number.isFinite(entry),
  );
  return finite ? { x: x!, y: y!, width: width!, height: height! } : undefined;
}

function parseNode(
  value: unknown,
  instances: Map<string, PaneInstance>,
  placed: Set<string>,
): PaneNode | undefined {
  if (!value || typeof value !== "object") return undefined;
  const node = value as {
    kind?: unknown;
    instanceId?: unknown;
    axis?: unknown;
    children?: unknown;
    sizes?: unknown;
  };

  if (node.kind === "leaf") {
    const instanceId = node.instanceId;
    if (typeof instanceId !== "string" || !instances.has(instanceId) || placed.has(instanceId))
      return undefined;
    placed.add(instanceId);
    return { kind: "leaf", instanceId };
  }

  if (node.kind !== "split" || (node.axis !== "row" && node.axis !== "column")) return undefined;
  const children: PaneNode[] = [];
  const kept: number[] = [];
  const raw = Array.isArray(node.sizes) ? node.sizes : [];
  for (const [index, entry] of (Array.isArray(node.children) ? node.children : []).entries()) {
    const child = parseNode(entry, instances, placed);
    if (!child) continue;
    children.push(child);
    kept.push(index);
  }

  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];

  const share = 1 / children.length;
  const sizes = kept.map((index) => {
    const size = raw[index];
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : share;
  });
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return { kind: "split", axis: node.axis, children, sizes: sizes.map((size) => size / total) };
}

function parseObjects(value: unknown): CanvasObject[] {
  if (!Array.isArray(value)) return [];
  const objects: CanvasObject[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<CanvasObject>;
    if (typeof candidate.kind !== "string" || typeof candidate.id !== "string") continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    objects.push(entry as CanvasObject);
  }
  return objects;
}

/**
 * What the project list reads: the board's own record of a workstream, without
 * any of the live session state a card folds in. A board written by a build that
 * had no review mark reads as unreviewed, which is where a workstream starts.
 */
export function boardSummary(board: BoardDoc): BoardSummary {
  const workstreams: BoardWorkstream[] = [];
  for (const object of board.objects) {
    if (object.kind !== "workstream") continue;
    const reviewedAt = object.reviewedAt;
    workstreams.push({
      id: object.id,
      goal: typeof object.goal === "string" ? object.goal : "",
      sessionId: typeof object.sessionId === "string" ? object.sessionId : null,
      reviewedAt: typeof reviewedAt === "number" && Number.isFinite(reviewedAt) ? reviewedAt : null,
    });
  }
  return { cwd: board.cwd, rev: board.rev, workstreams };
}

/**
 * Every board on disk. The file name is a hash of the directory, so the
 * directory each board belongs to is read out of the document rather than the
 * name; a file that will not parse is skipped rather than failing the listing.
 */
export async function listBoardFiles(directory: string): Promise<BoardDoc[]> {
  let names: string[] = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const boards: BoardDoc[] = [];
  for (const name of names) {
    try {
      const parsed = parseBoard(JSON.parse(await readFile(join(directory, name), "utf8")), "");
      if (parsed.cwd.length > 0) boards.push(parsed);
    } catch {
      // A half-written or hand-broken board costs its own row, not the list.
    }
  }
  return boards;
}

export async function readBoardFile(directory: string, cwd: string): Promise<BoardDoc> {
  try {
    return parseBoard(JSON.parse(await readFile(join(directory, boardFileName(cwd)), "utf8")), cwd);
  } catch {
    // A missing or corrupt board is an empty one; the sessions it referred to
    // are still in their own logs.
    return emptyBoard(cwd);
  }
}

/**
 * Rejects anything but the next revision. A window that slept through another
 * window's write would otherwise overwrite it with the board it still holds.
 */
export async function writeBoardFile(directory: string, board: BoardWrite): Promise<BoardDoc> {
  const current = await readBoardFile(directory, board.cwd);
  if (board.rev !== current.rev + 1) throw new StaleBoardWriteError(current.rev);

  const layout = parseLayout(board.layout);
  // A window that predates placements sends none, and keeping what is stored is the
  // only reading that does not silently throw the user's layout away. Removed once
  // every client carries the map back.
  const placements =
    board.placements === undefined ? current.placements : parsePlacements(board.placements);
  const stacks = board.stacks === undefined ? current.stacks : parseStacks(board.stacks);
  const stored: BoardDoc = {
    version: 1,
    rev: board.rev,
    cwd: board.cwd,
    objects: parseObjects(board.objects),
    placements,
    stacks,
    ...(layout ? { layout } : {}),
  };
  await mkdir(directory, { recursive: true });
  // Written beside the target and renamed so a crash mid-write cannot leave a
  // half-serialised board where the whole board used to be.
  const path = join(directory, boardFileName(board.cwd));
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stored, null, "\t")}\n`, "utf8");
  await rename(temporary, path);
  return stored;
}
