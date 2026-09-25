// How often a run is allowed to photograph the app.
//
// Screenshotting after every action is the habit `probe` exists to break: a
// picture costs a thousand times what reading the tree does, and two pictures
// of a screen nothing has happened to cannot differ. So the harness says no
// mechanically — with one exception, the closer look a full shot raises.

import { readFileSync, writeFileSync } from "node:fs";
import { paths } from "./paths.ts";

/** What a run has done since its last screenshot. */
export interface Pace {
  lastShot: string | null;
  lastFraming: string | null;
  /** Pictures taken since the app was last acted on; any action resets it. */
  sinceAction: number;
  taken: number;
}

/** Pictures of one unchanged screen: the frame, and one closer look at it. */
export const PICTURES_PER_SCREEN = 2;

/** The pace of a run that has not taken a picture yet. */
export function emptyPace(): Pace {
  return { lastShot: null, lastFraming: null, sinceAction: 0, taken: 0 };
}

/** Why a picture was refused, or null when it may be taken. */
export function refusePicture(pace: Pace, framing: string): string | null {
  if (pace.lastShot === null) return null;
  if (pace.sinceAction === 0) return null;

  const reframed = pace.lastFraming !== framing;
  if (reframed && pace.sinceAction < PICTURES_PER_SCREEN) return null;

  let why = `nothing has happened since ${pace.lastShot} — that picture is still the screen.`;
  if (reframed) {
    why = `${pace.sinceAction} pictures of this screen already, the last ${pace.lastShot}.`;
  }
  return (
    `${why}\n` +
    'Read what you have, or run "debug probe" for what is on screen now. Another\n' +
    "picture needs an action first — a click, a drag, a keypress."
  );
}

/** Record a picture, which uses up part of this screen's allowance. */
export function notePicture(pace: Pace, framing: string, shot: string | null): Pace {
  return {
    lastShot: shot,
    lastFraming: framing,
    sinceAction: pace.sinceAction + 1,
    taken: pace.taken + 1,
  };
}

/** Record something that changed the app, which gives the allowance back. */
export function noteAction(pace: Pace): Pace {
  return { ...pace, sinceAction: 0 };
}

/** The run's pace from disk, or a fresh one. */
export function readPace(): Pace {
  try {
    const pace: Pace = JSON.parse(readFileSync(paths.pace, "utf8"));
    return pace;
  } catch {
    return emptyPace();
  }
}

/** Persist the run's pace for the next command. */
export function writePace(pace: Pace): void {
  writeFileSync(paths.pace, JSON.stringify(pace), "utf8");
}
