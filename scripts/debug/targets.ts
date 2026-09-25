// How a debug command says what it means to act on.
//
// The driver is invoked once per action and keeps nothing between calls, so a
// target has to be expressible as a string on a command line. Bare text is the
// common case — the accessible name a person reads off the screen — and the
// prefixed forms exist for what has no name: a card on the board, a point.

export type Target =
  | { kind: "ref"; ref: string }
  | { kind: "card"; ref: string }
  | { kind: "pane"; instanceId: string }
  | { kind: "name"; name: string; role?: string }
  | { kind: "text"; text: string }
  | { kind: "testid"; testId: string }
  | { kind: "css"; selector: string }
  | { kind: "point"; x: number; y: number };

/** The roles a bare name is looked for in, in this order. */
export const NAME_ROLES = [
  "button",
  "tab",
  "treeitem",
  "link",
  "menuitem",
  "option",
  "row",
  "checkbox",
  "textbox",
  "separator",
];

/**
 * Read a target off the command line.
 *
 * Throws rather than guessing when a prefixed form is malformed: a click that
 * silently lands somewhere else is worse than one that does not happen.
 */
export function parseTarget(input: string): Target {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("empty target");

  const separator = trimmed.indexOf("=");
  if (separator === -1) return bareTarget(trimmed);

  const prefix = trimmed.slice(0, separator);
  const value = trimmed.slice(separator + 1);
  if (prefix === "text") return { kind: "text", text: requireValue(value, "text") };
  if (prefix === "testid") return { kind: "testid", testId: requireValue(value, "testid") };
  if (prefix === "css") return { kind: "css", selector: requireValue(value, "css") };
  if (prefix === "pane") return { kind: "pane", instanceId: requireValue(value, "pane") };
  if (prefix === "at") return pointTarget(value);
  if (prefix === "role") return roleTarget(value);
  // An unprefixed name can contain '=' — "width = 40" is a plausible label.
  return bareTarget(trimmed);
}

/**
 * An element ref, a card ref, a pane — or otherwise an accessible name.
 *
 * The structural forms are the ids `probe` prints (`e12`, `c3`, `pane-1-x0f2`),
 * shaped distinctly enough that no label read off the screen is mistaken for one.
 */
function bareTarget(input: string): Target {
  if (/^e[0-9]+$/.test(input)) return { kind: "ref", ref: input };
  if (/^c[0-9]+$/.test(input)) return { kind: "card", ref: input };
  if (/^pane-[0-9a-z]+-[0-9a-z]+$/.test(input)) return { kind: "pane", instanceId: input };
  return { kind: "name", name: input };
}

/** `role=button:Save` — a name looked for in one role rather than all of them. */
function roleTarget(value: string): Target {
  const separator = value.indexOf(":");
  if (separator === -1) throw new Error(`role target needs a name: role=${value}:<name>`);
  const role = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (role.length === 0 || name.length === 0) {
    throw new Error(`role target needs both parts: role=<role>:<name>, got role=${value}`);
  }
  return { kind: "name", name, role };
}

/** `at=820,460` — a point in the window, for what has no element to name. */
function pointTarget(value: string): Target {
  const parts = value.split(",");
  if (parts.length !== 2) throw new Error(`point target is at=<x>,<y>, got at=${value}`);
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`point target needs two numbers, got at=${value}`);
  }
  return { kind: "point", x, y };
}

/** A prefixed target's value, or an error when it is empty. */
function requireValue(value: string, prefix: string): string {
  if (value.length === 0) throw new Error(`${prefix} target is empty`);
  return value;
}

/** A rectangle of the window, for a screenshot of part of it. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `820,460,300,200` — where to crop a screenshot, as x,y,width,height.
 *
 * `probe` prints a position and a size for every element, so the numbers to
 * crop around are already in front of whoever is asking.
 */
export function parseRegion(input: string): Region {
  const parts = input.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`a crop is four numbers, x,y,width,height — got ${input}`);
  }
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  if (width <= 0 || height <= 0) {
    throw new Error(`a crop needs a positive width and height — got ${input}`);
  }
  return { x, y, width, height };
}

/** How a target reads back in an error or a log line. */
export function describeTarget(target: Target): string {
  if (target.kind === "ref") return target.ref;
  if (target.kind === "card") return `card ${target.ref}`;
  if (target.kind === "pane") return `pane ${target.instanceId}`;
  if (target.kind === "name") {
    if (target.role === undefined) return `"${target.name}"`;
    return `${target.role} "${target.name}"`;
  }
  if (target.kind === "text") return `text "${target.text}"`;
  if (target.kind === "testid") return `testid ${target.testId}`;
  if (target.kind === "css") return `css ${target.selector}`;
  return `point ${target.x},${target.y}`;
}
