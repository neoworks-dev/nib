/**
 * Where things sit. Layout is decoration (PLAN decision 4): this is the only state
 * that lives outside the vault, and losing it costs an arrangement, never content.
 *
 * Positions are per board, because a board is one directory's canvas (PLAN §5). A
 * topic's contents are laid out on the topic's own board and never on its parent's,
 * so a board's map covers its own directory and nothing deeper.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface Placement extends Rect {
  z: number;
  /**
   * Recorded when the item declares one, so a rename the app performs can carry the
   * position across. Never a key: `id:` is opt-in, so most items have none.
   */
  id?: string;
}

/** Board directory (`""` for the vault root) to path to where it sits. */
export type PlacementMap = Record<string, Record<string, Placement>>;

export interface PlacementEntry {
  path: string;
  id: string | null;
}

export interface ReconcileResult {
  placements: Record<string, Placement>;
  /** Paths that gained a position. */
  added: string[];
  /** Paths whose position was dropped because the path is gone. */
  removed: string[];
  /** Paths that took over a position from a vanished path carrying the same id. */
  carried: string[];
}

/** Where a path with no stored position goes, given what is already occupied. */
export type SlotChooser = (occupied: readonly Rect[], size: Size) => { x: number; y: number };

export interface FlowOptions {
  /** Where a row gives up and wraps. */
  maxWidth?: number;
  gap?: number;
}

export interface ReconcileOptions {
  /** The size a newly placed object starts at, before anyone resizes it. */
  size: Size;
  slot?: SlotChooser;
}

const DEFAULT_GAP = 24;
const DEFAULT_FLOW_WIDTH = 1200;
const PLACEMENT_ATTEMPTS = 512;

/**
 * Brings one board's positions in line with what is actually there: an item with no
 * position gets one, a position for a path that is gone is dropped, and a path whose
 * item carries an id that a vanished path also carried takes that position over.
 *
 * The one piece of policy here is which slot a new object gets — `options.slot`.
 * Until the layout question is settled the default flows new objects into rows,
 * which is at least predictable and never overlaps.
 */
export function reconcileBoard(
  entries: readonly PlacementEntry[],
  stored: Readonly<Record<string, Placement>>,
  options: ReconcileOptions,
): ReconcileResult {
  const slot = options.slot ?? flowSlot();
  const placements: Record<string, Placement> = {};
  const occupied: Rect[] = [];
  const added: string[] = [];
  const carried: string[] = [];
  const taken = new Set<string>();
  const byId = indexById(stored);

  for (const entry of entries) {
    const inherited = inherit(entry, stored, taken, byId);

    if (inherited) {
      placements[entry.path] = inherited.placement;
      occupied.push(inherited.placement);
      if (inherited.carried) carried.push(entry.path);
      continue;
    }

    const spot = slot(occupied, options.size);
    const placed: Placement = { ...spot, ...options.size, z: highestZ(placements) + 1 };
    placements[entry.path] = placed;
    occupied.push(placed);
    added.push(entry.path);
  }

  return { placements, added, removed: missingPaths(entries, stored), carried };
}

/** The board's slice of the vault-wide map, or an empty one. */
export function placementsFor(map: PlacementMap, board: string): Record<string, Placement> {
  return map[board] ?? {};
}

/** The board a vault-relative path belongs to: its directory. */
export function boardOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return "";
  return path.slice(0, slash);
}

interface Inherited {
  placement: Placement;
  carried: boolean;
}

/**
 * A stored position for this path, or one left behind by a path that carried the
 * same id. Each stored position is handed out at most once, so a carried position
 * cannot also be claimed directly by the path it came from.
 */
function inherit(
  entry: PlacementEntry,
  stored: Readonly<Record<string, Placement>>,
  taken: Set<string>,
  byId: ReadonlyMap<string, string>,
): Inherited | null {
  if (!taken.has(entry.path)) {
    const direct = stored[entry.path];
    if (direct) {
      taken.add(entry.path);
      return { placement: direct, carried: false };
    }
  }

  if (entry.id === null) return null;
  const source = byId.get(entry.id);
  if (source === undefined || taken.has(source)) return null;
  const placement = stored[source];
  if (!placement) return null;

  taken.add(source);
  return { placement, carried: true };
}

/** The first path carrying each id, in path order, so the choice is stable. */
function indexById(stored: Readonly<Record<string, Placement>>): Map<string, string> {
  const byId = new Map<string, string>();
  for (const path of sortedPaths(stored)) {
    const id = stored[path]?.id;
    if (id === undefined) continue;
    if (byId.has(id)) continue;
    byId.set(id, path);
  }
  return byId;
}

function missingPaths(
  entries: readonly PlacementEntry[],
  stored: Readonly<Record<string, Placement>>,
): string[] {
  const present = new Set(entries.map((entry) => entry.path));
  return sortedPaths(stored).filter((path) => !present.has(path));
}

function sortedPaths(stored: Readonly<Record<string, Placement>>): string[] {
  return Object.keys(stored).sort((left, right) => left.localeCompare(right));
}

function highestZ(placements: Record<string, Placement>): number {
  let highest = 0;
  for (const placement of Object.values(placements)) {
    if (placement.z > highest) highest = placement.z;
  }
  return highest;
}

/**
 * Objects flowed into rows that wrap at `maxWidth`, skipping anything they would overlap. Mixed
 * sizes are the point: a vault holds cards of very different shapes.
 *
 * The same function answers both layout questions in the PLAN: where a newly discovered item sits
 * on a board (5), and how a topic arranges the collection it is (6). A board passes what is already
 * placed; a preview passes only what it has laid out so far.
 */
export function flowSlot(options: FlowOptions = {}): SlotChooser {
  const maxWidth = options.maxWidth ?? DEFAULT_FLOW_WIDTH;
  const gap = options.gap ?? DEFAULT_GAP;

  return (occupied, size) => {
    let x = 0;
    let y = 0;
    let rowHeight = 0;

    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
      if (x > 0 && x + size.w > maxWidth) {
        x = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      if (size.h > rowHeight) rowHeight = size.h;

      const candidate: Rect = { x, y, ...size };
      if (!occupied.some((other) => overlaps(candidate, other))) return { x, y };
      x += size.w + gap;
    }

    // Nothing free in the flow: go below everything rather than on top of it.
    return { x: 0, y: lowestBottom(occupied) + gap };
  };
}

function lowestBottom(occupied: readonly Rect[]): number {
  let bottom = 0;
  for (const rect of occupied) {
    const edge = rect.y + rect.h;
    if (edge > bottom) bottom = edge;
  }
  return bottom;
}

export function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}
