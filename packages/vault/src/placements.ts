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
  /**
   * The pile this item is in, if any. A stack is decoration like every other
   * position: it is never a directory and never a file, so being in one changes
   * nothing on disk and losing it costs an arrangement rather than content.
   */
  stack?: string;
}

/** Board directory (`""` for the vault root) to path to where it sits. */
export type PlacementMap = Record<string, Record<string, Placement>>;

/**
 * Where each pile sits, by stack id. Beside `placements` rather than inside it,
 * because a stack has a position of its own that outlives any one member: the
 * pile stays put while things are dragged out of it.
 */
export type StackMap = Record<string, Rect>;

export interface PlacementEntry {
  path: string;
  id: string | null;
  /** The size this entry starts at, overriding the board's default. */
  size?: Size;
}

export interface ReconcileResult {
  placements: Record<string, Placement>;
  /** Paths that gained a position. */
  added: string[];
  /** Paths whose position was dropped because the path is gone. */
  removed: string[];
  /** Paths that took over a position from a vanished path carrying the same id. */
  carried: string[];
  /**
   * The piles that still hold something, each with the rectangle it sits on. A
   * stack whose every member is gone is gone with them: it was only ever the
   * arrangement of those items, so keeping an empty one would leave a pile of
   * nothing that cannot be clicked or undone.
   */
  stacks: StackMap;
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
  /**
   * Where the piles this board had were sitting. Only their rectangles: which
   * items are in a pile is on the placements, so a missing entry costs the pile
   * nothing but the exact spot it was folded at.
   */
  stacks?: StackMap;
}
const DEFAULT_GAP = 24;
const DEFAULT_FLOW_WIDTH = 1200;
const PLACEMENT_ATTEMPTS = 512;

/**
 * Brings one board's positions in line with what is actually there: an item with no
 * position gets one, a position for a path that is gone is dropped, and a path whose
 * item carries an id that a vanished path also carried takes that position over.
 *
 * Stored positions are claimed before any new one is chosen, in two passes rather
 * than one. A single pass hands a slot to an unplaced item by looking only at what
 * it has seen so far, so an item further down the list that already owns that exact
 * spot ends up underneath it — a card that cannot be clicked and text drawn twice.
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
  const unplaced: PlacementEntry[] = [];

  for (const entry of entries) {
    const inherited = inherit(entry, stored, taken, byId);
    if (!inherited || displaced(inherited.placement, occupied)) {
      unplaced.push(entry);
      continue;
    }

    placements[entry.path] = inherited.placement;
    occupied.push(inherited.placement);
    if (inherited.carried) carried.push(entry.path);
  }

  for (const entry of unplaced) {
    const size = entry.size ?? options.size;
    const spot = slot(occupied, size);
    const placed: Placement = { ...spot, ...size, z: highestZ(placements) + 1 };
    placements[entry.path] = placed;
    occupied.push(placed);
    added.push(entry.path);
  }

  return {
    placements,
    added,
    removed: missingPaths(entries, stored),
    carried,
    stacks: stacksFrom(placements, options.stacks),
  };
}

/**
 * Where each pile sits. A pile **is** its members: the `stack` on a placement is
 * the membership, and the rectangle is only where the cascade was last put. So a
 * stored rectangle is kept, and one the document does not have is read back off
 * the top card rather than the pile being taken apart.
 *
 * The two used to have to agree, and a stack map that came back empty — from an
 * older document, a hand edit, or a board read before its map arrived — dissolved
 * every pile on the board and left the cards sitting in a cascade that no longer
 * answered a click. The rectangle is the one part of a stack that can be
 * recomputed, so it is.
 *
 * A pile whose every member is gone is gone with them: nothing is left to read a
 * rectangle off, and an empty pile cannot be clicked or undone.
 */
function stacksFrom(
  placements: Readonly<Record<string, Placement>>,
  stored: StackMap | undefined,
): StackMap {
  const top = new Map<string, Placement>();
  for (const placement of Object.values(placements)) {
    const stack = placement.stack;
    if (stack === undefined) continue;
    const highest = top.get(stack);
    if (highest === undefined || placement.z > highest.z) top.set(stack, placement);
  }

  const stacks: StackMap = {};
  for (const [id, placement] of top) {
    const kept = stored?.[id];
    if (kept) {
      stacks[id] = kept;
      continue;
    }
    stacks[id] = { x: placement.x, y: placement.y, w: placement.w, h: placement.h };
  }
  return stacks;
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
    let y = 0;

    for (let row = 0; row < PLACEMENT_ATTEMPTS; row += 1) {
      let x = 0;

      for (let step = 0; step < PLACEMENT_ATTEMPTS; step += 1) {
        // Past the right edge with something already on this row: try the next.
        if (x > 0 && x + size.w > maxWidth) break;

        const candidate: Rect = { x, y, ...size };
        const blocker = occupied.find((other) => overlaps(candidate, other));
        if (!blocker) return { x, y };

        // Step clear of what is in the way, not by this card's own width. A card
        // narrower than the one blocking it lands back inside that card, is
        // rejected, and the scan walks off the right edge — which is how a 340
        // wide picture pushed the next card 424 units below it with the space
        // beside it left empty.
        x = blocker.x + blocker.w + gap;
      }

      const next = nextRowTop(occupied, y, gap);
      if (next === null) break;
      y = next;
    }

    // Nothing free in the flow: go below everything rather than on top of it.
    return { x: 0, y: lowestBottom(occupied) + gap };
  };
}

/**
 * Objects packed against what is already there rather than flowed into rows: each one drops
 * straight down from the top at whichever x leaves it highest, so a short card lets the next one
 * rise beside it instead of holding a row open to its tallest member.
 *
 * This is what a wall of mixed sizes has to do to read as an arrangement. Rows advance by their
 * tallest card, which is fine for a grid of one size and leaves a band of empty table under every
 * short card in a vault that holds pictures, pages and one-line notes at once.
 *
 * The candidate positions are the left and right edges of what is placed, plus the left margin:
 * a card that cannot line up with an edge of something has nothing to line up with, and the two
 * edges are where every gap in the wall begins.
 */
export function packSlot(options: FlowOptions = {}): SlotChooser {
  const maxWidth = options.maxWidth ?? DEFAULT_FLOW_WIDTH;
  const gap = options.gap ?? DEFAULT_GAP;

  return (occupied, size) => {
    const candidates = new Set<number>([0]);
    for (const rect of occupied) {
      candidates.add(rect.x);
      candidates.add(rect.x + rect.w + gap);
    }

    let best: { x: number; y: number } | null = null;
    for (const x of candidates) {
      if (x > 0 && x + size.w > maxWidth) continue;
      const y = restingTop({ x, y: 0, ...size }, occupied, gap);
      if (best !== null && (y > best.y || (y === best.y && x >= best.x))) continue;
      best = { x, y };
    }
    if (best !== null) return best;

    // Nothing fits across: below everything rather than on top of it.
    return { x: 0, y: lowestBottom(occupied) + gap };
  };
}

/** How far a card at this x falls before it lands on something already placed. */
function restingTop(candidate: Rect, occupied: readonly Rect[], gap: number): number {
  let top = 0;
  for (const rect of occupied) {
    if (candidate.x >= rect.x + rect.w || candidate.x + candidate.w <= rect.x) continue;
    top = Math.max(top, rect.y + rect.h + gap);
  }
  return top;
}

/**
 * Where the row under `y` starts: the nearest bottom edge below it. Descending by
 * the tallest card in the row instead would step past shorter ones and leave the
 * space under them unreachable, which is most of what makes a wall of mixed sizes
 * read as a grid rather than as a column.
 */
function nextRowTop(occupied: readonly Rect[], y: number, gap: number): number | null {
  let next: number | null = null;
  for (const rect of occupied) {
    const bottom = rect.y + rect.h + gap;
    if (bottom <= y) continue;
    if (next === null || bottom < next) next = bottom;
  }
  return next;
}

function lowestBottom(occupied: readonly Rect[]): number {
  let bottom = 0;
  for (const rect of occupied) {
    const edge = rect.y + rect.h;
    if (edge > bottom) bottom = edge;
  }
  return bottom;
}

/**
 * Whether a stored position has to be given up. A position identical to one
 * already claimed is not an arrangement anyone made — two cards cannot be
 * dragged onto the exact same rectangle, and the lower one could never be
 * reached again — so it is re-slotted rather than kept.
 *
 * A pile is the exception, and the only one: a cascade stops stepping past
 * `CASCADE_LIMIT` layers, so the cards at the bottom of a deep pile sit on
 * exactly the same rectangle **on purpose**. Re-slotting one of those would
 * throw a card out of the stack the user built and scatter it across the board.
 */
function displaced(placement: Placement, occupied: readonly Rect[]): boolean {
  if (placement.stack !== undefined) return false;
  return occupied.some((other) => coincident(other, placement));
}

/** The same rectangle, not merely an overlapping one. */
function coincident(left: Rect, right: Rect): boolean {
  return left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
}

export function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

/**
 * Reads a stored map back. The document is hand-editable and outlives the build that
 * wrote it, so an entry that does not parse is dropped rather than kept: a placement
 * with no usable geometry cannot be rendered and cannot be repaired by guessing.
 */
export function parsePlacements(value: unknown): PlacementMap {
  if (!isRecord(value)) return {};

  const map: PlacementMap = {};
  for (const [board, entries] of Object.entries(value)) {
    if (!isRecord(entries)) continue;

    const placements: Record<string, Placement> = {};
    for (const [path, entry] of Object.entries(entries)) {
      const placement = parsePlacement(entry);
      if (placement) placements[path] = placement;
    }
    // A board with nothing usable is absent rather than empty: the two read the
    // same, and writing the document back stays free of dead keys.
    if (Object.keys(placements).length > 0) map[board] = placements;
  }

  return map;
}

function parsePlacement(value: unknown): Placement | null {
  if (!isRecord(value)) return null;

  const { x, y, w, h, z, id } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(w) || !isFiniteNumber(h)) return null;
  if (w <= 0 || h <= 0) return null;

  const placement: Placement = { x, y, w, h, z: isFiniteNumber(z) ? z : 0 };
  if (typeof id === "string" && id.length > 0) placement.id = id;
  const stack = value["stack"];
  if (typeof stack === "string" && stack.length > 0) placement.stack = stack;
  return placement;
}

/**
 * Reads a stored stack map back. Same rule as a placement: an entry with no
 * usable rectangle is dropped rather than guessed at, and the items that named
 * it fall out of the pile rather than into a broken one.
 */
export function parseStacks(value: unknown): StackMap {
  if (!isRecord(value)) return {};

  const stacks: StackMap = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const { x, y, w, h } = entry;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    if (!isFiniteNumber(w) || !isFiniteNumber(h) || w <= 0 || h <= 0) continue;
    stacks[id] = { x, y, w, h };
  }
  return stacks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
