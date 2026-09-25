/**
 * Where the sheets inside a folder sit. One description of the geometry, read by
 * the folder's own card, which draws them, and by the preview, whose cards come
 * out of them: an item leaves the folder from exactly the place it was drawn in,
 * and goes back to it when the folder closes.
 *
 * Everything here is in the folder card's own coordinates, so the caller adds the
 * card's origin.
 */

/** How wide the front panel is, as a fraction of the card: the paper sits behind it. */
export const FOLDER_FRONT_WIDTH = 0.9;

/**
 * The paper inside: tucked in at the top and the bottom, starting well left of
 * the panel's edge so its face has room, and leaning a touch clockwise so its
 * edge stands further out at the top than at the bottom — the way a sheet dropped
 * into a wallet settles.
 */
const SHEET_TOP = 0.09;
const SHEET_BOTTOM = 0.92;
const SHEET_LEFT = 0.45;
const SHEET_LEAN = (1.5 * Math.PI) / 180;

/**
 * Each sheet behind the front one leans a little further and sits a little
 * higher, so every item in the folder shows an edge of its own rather than the
 * first one hiding the rest. A fan rather than a neat pile: sheets dropped into
 * a wallet do not line up, and a stack that did would read as one thick sheet.
 */
const FAN_LEAN = (2.2 * Math.PI) / 180;
const FAN_RISE = 0.022;
/**
 * How far the fan spreads, in steps of the above: a folder of four is as open as
 * a folder of forty, and the extra sheets share the same spread rather than
 * climbing out of the card. The number is what four sheets used to cost, so a
 * small folder looks exactly as it did.
 */
const FAN_STEPS = 3;
/**
 * World units between one sheet's edge and the next before the two are the same
 * line. Past this the fan is full: the items are still all in there, and they
 * still all come out, but the sheets at the back of a fat folder are drawn where
 * a fat folder's back sheets are — on top of each other.
 */
const FAN_MIN_RISE = 2;

/**
 * How long each sheet waits before the one in front of it has gone, and how long
 * the whole folder is allowed to take emptying. The wait is what makes it read as
 * a handful being pulled out rather than as a block appearing beside the card; the
 * cap is what stops a folder of two hundred taking four seconds about it.
 */
const STAGGER_MS = 26;
const STAGGER_TOTAL_MS = 180;
/**
 * The way back in is staggered too, and tighter. Everything else the board does
 * on closing a folder — the dim lifting, the cards that made room sliding back —
 * takes about one travel, and contents still arriving after all of that had
 * stopped read as a separate, slower thing happening.
 */
const RETURN_SHARE = 0.45;

/** One sheet, before it leans. The lean turns it about its top left corner. */
export interface SheetSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians clockwise, about the slot's top left corner. */
  lean: number;
  /** Which item this is, front sheet first: what sets its turn to be pulled out. */
  index: number;
  /** How many are in there, so the turns fit the time the folder has to empty. */
  total: number;
}

/**
 * How long the sheet in `place` waits its turn — `place` counted from whichever
 * end is going first, so the way back in is the way out counted from the other.
 */
export function sheetStagger(place: number, total: number): number {
  const step = Math.min(STAGGER_MS, STAGGER_TOTAL_MS / Math.max(1, total - 1));
  return Math.max(0, place) * step;
}

/** The same turn on the way back in, taken at the tighter pace the close keeps. */
export function sheetReturn(place: number, total: number): number {
  return sheetStagger(place, total) * RETURN_SHARE;
}

/**
 * How many sheets of a folder of `count` are drawn apart from one another. The
 * rest share the deepest slot, so nothing is hidden that would have been visible.
 */
export function drawnSheets(count: number, height: number): number {
  if (count <= 1) return Math.max(0, count);
  const spread = height * FAN_RISE * FAN_STEPS;
  return Math.min(count, Math.max(2, Math.floor(spread / FAN_MIN_RISE) + 1));
}

/**
 * A slot per item, front sheet first. Items past the fan's spread all get the
 * back slot: they are in the folder and they come out of it, from the back.
 */
export function folderSheets(count: number, width: number, height: number): SheetSlot[] {
  const drawn = drawnSheets(count, height);
  const steps = Math.max(1, drawn - 1);
  const spread = Math.min(1, FAN_STEPS / steps);
  const left = width * FOLDER_FRONT_WIDTH * SHEET_LEFT;

  const slots: SheetSlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const depth = Math.min(index, drawn - 1);
    const top = height * (SHEET_TOP - depth * FAN_RISE * spread);
    slots.push({
      x: left,
      y: top,
      w: Math.max(1, width - left),
      h: Math.max(1, height * SHEET_BOTTOM - top),
      lean: SHEET_LEAN + depth * FAN_LEAN * spread,
      index,
      total: count,
    });
  }
  return slots;
}
