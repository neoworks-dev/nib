// Everything that looks at or acts on the running app, each forwarded to the
// node driver as one action.

import type { Command } from "commander";
import { drive } from "../drive.ts";
import { noteAction, notePicture, readPace, refusePicture, writePace } from "../pace.ts";
import { requireSession } from "../session.ts";
import { latestShot, nextShotPath } from "../shots.ts";
import { parseRegion, type Region } from "../targets.ts";
import { printable } from "./output.ts";

interface PictureOptions {
  screenshot?: string;
  crop?: string;
  of?: string;
}

/** Register probe, panes, pane, the pointer and keyboard actions, wait, eval and screenshot. */
export function registerActionCommands(program: Command): void {
  pictured(program.command("probe [filter]"))
    .description("the board, the docks and a ref for everything in them; a filter keeps matches")
    .action((filter: string | undefined, options: PictureOptions) =>
      act("probe", { action: "probe", filter }, options),
    );

  program
    .command("panes")
    .description("every pane type, and which are open")
    .action(() => act("panes", { action: "panes" }, {}));

  pictured(program.command("pane <id>"))
    .description("open a pane by type through the registry, or close it")
    .option("--close", "close every instance of it instead")
    .action((paneId: string, options: PictureOptions & { close?: boolean }) =>
      act("pane", { action: "pane", paneId, close: options.close === true }, options),
    );

  for (const [name, count, button] of [
    ["click", 1, "left"],
    ["dblclick", 2, "left"],
    ["rightclick", 1, "right"],
  ] as const) {
    pictured(program.command(`${name} <target>`))
      .description(`${name} a target: a name, a ref, a card, a pane, at=x,y`)
      .action((target: string, options: PictureOptions) =>
        act(name, { action: "click", target, count, button }, options),
      );
  }

  pictured(program.command("drag <from> <to>"))
    .description("press, move in steps, release — cards, dock dividers, anything")
    .action((from: string, to: string, options: PictureOptions) =>
      act("drag", { action: "drag", from, to }, options),
    );

  pictured(program.command("type <text>"))
    .description("type into whatever has focus")
    .action((text: string, options: PictureOptions) =>
      act("type", { action: "type", text }, options),
    );

  pictured(program.command("press <chords...>"))
    .description("press keys in order: Escape, Control+k, Shift+Tab")
    .action((keys: string[], options: PictureOptions) =>
      act("press", { action: "key", keys }, options),
    );

  pictured(program.command("scroll <dy>"))
    .description("wheel; over the board this zooms or pans")
    .option("--at <target>", "where the pointer is while scrolling")
    .action((deltaY: string, options: PictureOptions & { at?: string }) =>
      act("scroll", { action: "scroll", dy: Number(deltaY), target: options.at }, options),
    );

  program
    .command("wait <target>")
    .description("until the target is visible, or with --gone until it is not")
    .option("--gone", "wait for it to disappear")
    .action((target: string, options: { gone?: boolean }) =>
      act("wait", { action: "wait", target, gone: options.gone === true }, {}),
    );

  program
    .command("eval <expression>")
    .description("one expression in the renderer; window.__nib_debug has context, panes, canvas")
    .action((expression: string) => act("eval", { action: "eval", expression }, {}));

  program
    .command("screenshot [label]")
    .description("a picture, for what only a picture shows; refused when nothing has changed")
    .option("--of <target>", "photograph one element, pane or card")
    .option("--crop <x,y,w,h>", "photograph one region of the window")
    .action((label: string | undefined, options: PictureOptions) => {
      const crop = cropOf(options);
      refuseRepeatPicture(options, crop);
      const output = drive(requireSession(), {
        action: "shot",
        path: nextShotPath(label),
        target: options.of,
        crop,
      });
      console.log(printable("screenshot", output));
      recordPace("screenshot", true, framing(options, crop));
    });
}

/** Add `--screenshot` and `--crop` to an action, for a picture of what it left behind. */
function pictured(command: Command): Command {
  return command
    .option("--screenshot <label>", "photograph the result in the same connection")
    .option("--crop <x,y,w,h>", "only this region of the window, with --screenshot");
}

/** Which commands change the app, and so make a new picture worth taking. */
const ACTING_COMMANDS = [
  "click",
  "dblclick",
  "rightclick",
  "drag",
  "type",
  "press",
  "scroll",
  "pane",
];

/**
 * Run one action. `--screenshot` photographs the result in the same connection
 * the action ran in: a menu closes when the driver disconnects, so this is the
 * only way to see one.
 */
function act(name: string, command: Record<string, unknown>, options: PictureOptions): void {
  const session = requireSession();
  const crop = cropOf(options);
  let screenshot: string | undefined = undefined;
  if (options.screenshot !== undefined) {
    refuseRepeatPicture(options, crop);
    screenshot = nextShotPath(options.screenshot);
  }
  const output = drive(session, { ...command, screenshot, crop });
  console.log(printable(name, output));
  recordPace(name, screenshot !== undefined, framing(options, crop));
}

/** `--crop x,y,w,h`, when only one part of the window is the question. */
function cropOf(options: PictureOptions): Region | undefined {
  if (options.crop === undefined) return undefined;
  return parseRegion(options.crop);
}

/** Refuse a picture of a screen that has already been photographed. */
function refuseRepeatPicture(options: PictureOptions, crop: Region | undefined): void {
  const refusal = refusePicture(readPace(), framing(options, crop));
  if (refusal !== null) throw new Error(refusal);
}

/** How a screenshot was framed, so one closer look is told from a repeat. */
function framing(options: PictureOptions, crop: Region | undefined): string {
  if (options.of !== undefined) return `of:${options.of}`;
  if (crop !== undefined) return `crop:${crop.x},${crop.y},${crop.width},${crop.height}`;
  return "full";
}

/** Note an action or a picture in the run's pace. */
function recordPace(name: string, tookPicture: boolean, frame: string): void {
  let pace = readPace();
  if (ACTING_COMMANDS.includes(name)) pace = noteAction(pace);
  if (tookPicture) pace = notePicture(pace, frame, latestShot());
  writePace(pace);
}
