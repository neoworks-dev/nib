#!/usr/bin/env bun
// The debug harness: a running nib of its own, and a command surface for using
// it the way a person does.
//
// Tests assert on what can be asserted on. This is for everything else —
// whether a card feels right when it is dragged, whether a pane is usable,
// whether the board draws what the vault holds — and it exists so that job can
// be handed to a model instead of a person. `debug explore` starts one.
//
//   bun run debug start                 the built app on a VNC display of its own
//   bun run debug probe                 the board, the docks, refs to act on
//   bun run debug click "New note"      act
//   bun run debug screenshot label      a picture, when only a picture will do
//   bun run debug stop
//
// The app is driven from `driver/`, which runs under node; everything here is
// bun and shells out to it.

import { Command } from "commander";
import { registerActionCommands } from "./commands/act.ts";
import { registerCharterCommands } from "./commands/charters.ts";
import { registerExploreCommand } from "./commands/explore.ts";
import { registerGithubCommands } from "./commands/github.ts";
import { registerLogCommands } from "./commands/logs.ts";
import { registerSessionCommands } from "./commands/session.ts";

const program = new Command()
  .name("debug")
  .description("drive nib the way a person does (bun run debug <command>)")
  .addHelpText(
    "after",
    `
Targets are an accessible name ("New note"), or an id "probe" printed: an element
(e12), a card on the board (c3), a pane (pane-1-x0f2, pane=board). Also at=820,460
for a bare point, and role=button:Save, text=…, testid=…, css=… when a name is
ambiguous.`,
  );

registerSessionCommands(program);
registerActionCommands(program);
registerLogCommands(program);
registerExploreCommand(program);
registerGithubCommands(program);
registerCharterCommands(program);

program.parseAsync().catch((error: unknown) => {
  let message = String(error);
  if (error instanceof Error) message = error.message;
  console.error(message);
  process.exit(1);
});
