---
name: nib-debug
description: Use nib the way a person does — launch the built app on a VNC display of its own, click, drag cards, type, look at screenshots, read its state and logs, and file what you find as GitHub issues. Use whenever a UI, board or agent bug is reported, before proposing a fix; when verifying a UI change; when exploring the app for bugs and rough edges; and whenever driving the app through `bun run debug`.
---

# Using nib, and finding out what is wrong with it

This is the harness for what a unit test cannot do: sitting down with the app
and finding out whether it works and whether it is any good to use.

It is also the debugger. When a bug is known and the question is _why_,
reproduce it here and confirm the mechanism before proposing a fix — guessing
from source is wrong more often than right. It launches an instance of its own;
never launch or restart the user's.

Everything is `bun run debug <command>`. `bun run debug --help` lists it, and
`bun run debug <command> --help` explains one.

## A session

```bash
bun run debug start            # VNC display, built app, isolated profile, CDP port
bun run debug probe            # is it up, and what is on screen
bun run debug stop             # the app, everything it spawned, and the display
```

`start` reuses the last build. `--build` rebuilds the web and desktop app first —
do that after changing app code, or you are testing the old build. `--fresh`
throws the profile and the demo project away and makes new ones.

The session runs on an Xvnc display in `:100`–`:109`, not the desktop. `start`
prints which one; the user watches with `vncviewer :100` or
`bun run debug view`. Never run `view` yourself — nobody is watching your
desktop.

The profile is `.nib-debug/profile/`: `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and
`XDG_CACHE_HOME` all point in there, so the user's own nib keeps its state while
this one runs beside it. The app opens the demo project `.nib-debug/profile/demo`,
whose vault (`demo/.nib/`) is a few notes in two folders and a git history.
Write into it freely.

`HOME` stays real, so the harnesses (Claude Code, Codex, Pi) are logged in as the
user. They cost real tokens: keep prompts tiny, start one session rather than
five.

It runs the **built** app — the SvelteKit server under Electron's Node, not
under bun. Some bugs only exist there (a stray `Bun.*` call in server code is
one); some only in `bun run dev`. Say which one you tested.

## Seeing

`probe` is the loop. It prints the app as the layout it is:

```
nib  1439x899  project=…/profile/demo
focus=pane-1-05t8  camera=0,0 zoom=1.00  errors=0

board  983x899
  folder "assets" c1  at=140,200  280x400
  folder "notes" c2  at=444,200  280x400
  sticky "Demo project" c3  at=736,77  256x154
  canvas e1 · button "Fit the board to the pane" e2 · button "Zoom in" e4
  textbox "What needs doing? — @ for files" e5 · button "Send" e10 (disabled)

dock right
  pane-1-05t8  project.explorer  "Project"  456x899  ★focus
       button "Close the Project pane" e12 · button "Refresh the project tree" e13

overlays (menus, dialogs, the shell — outside the board and the docks)
  separator "Resize the right dock" e11 · button "Switch project" e14
```

- **board** is the Pixi surface. Its cards (`c1`…) are not in the DOM; they come
  from the canvas state through the camera, with their centre (`at=`) and size
  in window pixels. Cards off screen are counted, not listed — pan or zoom.
- **dock** sections are the panes against each edge, as the split tree they
  are, each with its instance id and what can be clicked inside it.
- **overlays** is everything else: menus, dialogs, the project switcher.

`probe <filter>` keeps only elements and cards whose name, role or ref matches.

The header counts console errors; they are listed under the tree when there are
any.

### The screenshot is for what only a picture shows

```bash
bun run debug screenshot board                     # the window
bun run debug screenshot composer --crop 430,740,580,140
bun run debug screenshot sticky --of c3            # one card, pane or element
```

Alignment, overlap, a card drawn wrong, a pane gone blank. **Not** for finding
out what is open or what to click — `probe` says that exactly.

When you take one, **read the file** with the Read tool. Taking another when
nothing has happened since is refused; re-read the first, or `probe`.

Anything transient — a context menu, a popover — must be photographed in the
same connection that opened it:

```bash
bun run debug rightclick c1 --screenshot folder-menu
```

The driver connects per command, and a menu **closes when it disconnects**.

## Acting

```bash
bun run debug click "Open settings"        # also dblclick, rightclick
bun run debug drag c3 at=900,400            # move a card
bun run debug drag "Resize the right dock" at=900,400
bun run debug type "some text"              # into whatever has focus
bun run debug press Escape                  # chords: Control+k, Shift+Tab
bun run debug scroll -400 --at c2           # wheel over the board zooms/pans
bun run debug wait "Send" --gone
```

| target                                         | means                                             |
| ---------------------------------------------- | ------------------------------------------------- |
| `Open settings`                                | the accessible name, in the roles a person clicks |
| `e14`                                          | an element from the last `probe`                  |
| `c3`                                           | a card on the board from the last `probe`         |
| `pane-1-05t8` / `pane=board`                   | a pane, or the board itself                       |
| `at=820,460`                                   | a point in the window                             |
| `role=button:Save`                             | a name in one role, when the bare name is shared  |
| `text=Skip` / `testid=composer` / `css=.thing` | when nothing else fits                            |

Refs and cards are valid until the screen changes; a stale one is an error
telling you to probe again. A drag moves in steps, so the board sees the whole
gesture.

### Opening a pane

```bash
bun run debug panes                     # every pane type, and which are open
bun run debug pane git                  # open it, wherever it docks
bun run debug pane git --close
```

This goes through the pane registry. It is a shortcut past the UI, not a
replacement for it: the sidebar and the command palette are worth testing by
clicking them.

## When something goes wrong

```bash
bun run debug logs                 # renderer, then main process + SvelteKit server
bun run debug logs --renderer 100  # console, failed requests with URLs, uncaught throws
bun run debug logs --main 100      # server routes, vault writes, harness processes
bun run debug eval '<one expression in the renderer>'
```

A failed API request shows in the renderer log with its URL; its stack trace is
only in the main log. A fault usually needs both.

`eval` takes an **expression** — wrap statements in an IIFE. It reaches
`window.__nib_debug`:

- `context` — the client kernel (`context.require("transport")`, …)
- `panes` — the pane registry: `openPanes`, `docks`, `focusedInstanceId`, `open(id)`
- `canvas` — `canvasState`: `objects`, `vault`, `board`, `registry.camera`

Agent session transcripts are JSONL under the project's vault or
`.nib-debug/profile/data/nib-ui/sessions/`.

If the app stops responding, `probe` says whether it is still running;
`stop` then `start` is always safe — the profile survives it.

## What to report

Everything that made the app worse to use, not just what crashed:

- It broke, threw, hung, or lost a file.
- It did something other than what its label promised.
- You had to guess: no affordance, no feedback, a control found by accident.
- It looked wrong: overlap, a cut-off label, a card drawn wrong, a blank pane.
- It was slow enough to notice.
- Two parts of the app disagree about the same idea.

Not findings: anything caused by driving the harness wrong, a stale ref, or
something the demo project simply does not have.

## Filing it

Read the open issues first — a duplicate costs a triage, and an open issue is
the best lead you have:

```bash
gh issue list --repo neoworks-dev/nib --state open --limit 100
gh issue view 12 --repo neoworks-dev/nib
```

Then one issue per finding, each with the screenshot that shows it:

```bash
bun run debug finding \
  --title "Dragging a card onto a folder drops it beside the folder" \
  --body .nib-debug/reports/drop.md \
  --label bug --label area:canvas \
  --screenshot .nib-debug/shots/004-after-drop.png
```

`--body` is a file or the text itself; `--label` and `--screenshot` repeat.
`ai-found` is added for you; pick the type (`bug` or `enhancement`) and one
`area:` label from `CLAUDE.md`. Screenshots are committed to the
`debug-screenshots` branch and embedded, because GitHub has no API for
attaching a file to an issue. Everything posts as neoworks-bot through `gh bot`.

Say what you did, what happened, and what you expected — in that order, in a few
lines. No speculation about the fix unless you read the code and know.

## Showing a fix works

When an issue is done, post the before and after on it:

```bash
bun run debug evidence --issue 12 \
  --body "Dropping onto a folder now moves the file into it." \
  --screenshot .nib-debug/shots/003-before.png \
  --screenshot .nib-debug/shots/009-after.png
```

## Exploring

`bun run debug explore [charter|scope]` hands the running session to a separate
Claude Code run (sonnet unless `--model`), which tests the app, keeps a report in
`.nib-debug/reports/`, and files what it finds. `--dry-run` files nothing.
`bun run debug charters` lists the scopes in `charters/`; anything else is taken
as the scope text itself.
