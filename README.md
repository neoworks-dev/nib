# nib-ui

Extensible multi-harness agent UI. Everything is a plugin: a minimal Cordis-style microkernel
hosts every feature, on both the server and the client, and the only contract between them is an
append-only normalized event log.

## Install

The Claude Agent SDK ships the Claude Code CLI as per-platform optional dependencies. We do not
want that vendored binary — install without optional dependencies:

```bash
bun run install:lean   # bun install --omit optional
```

The adapter resolves a system-installed Claude Code binary instead: `$CLAUDE_EXECUTABLE` if set,
otherwise `Bun.which('claude')`. Install Claude Code separately (`npm i -g @anthropic-ai/claude-code`
or the native installer) or the session reports an error.

`--omit optional` also drops the native binaries the build toolchain ships as optional deps
(esbuild, rollup, `@tailwindcss/oxide`, lightningcss), so the workspace root depends on the
host-platform ones explicitly. On a machine that is not `linux-x64-gnu`, swap those four
devDependencies for the matching platform packages.

### The desktop sidecar (optional)

The desktop pane talks to the host compositor through `nib-overlay`, a small Rust binary that is
resolved at runtime and never bundled — the same stance taken for the Claude Code CLI. Without it
the pane still mounts and reports which capabilities are missing and why.

```bash
task build:overlay   # cargo build --release in plugins/desktop-agent/sidecar
```

Then put `plugins/desktop-agent/sidecar/target/release/nib-overlay` on `$PATH`, or point
`$NIB_OVERLAY_EXECUTABLE` at it. Building it needs a Rust toolchain and the `wayland-client`
development headers.

Two optional system tools widen what it can do, and each absence is reported rather than assumed:
`grim` (capturing one output or a region without a portal dialog) and a compositor with an IPC
socket — Hyprland or sway — for the focused window and the cursor position. Per-application capture
rules live in `~/.config/nib/desktop-agent.json` and are edited in Settings.

## Layout

| Path                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `packages/kernel`       | Plugin microkernel: scopes, services, events, effects, forks   |
| `packages/protocol`     | Normalized event/command schemas (zod) + `reduceSession`       |
| `packages/ui-contracts` | Frontend service contracts shared by the app and every plugin  |
| `packages/file-icons`   | Material icon subset + extension lookup, shared by app/plugins |
| `apps/web`              | SvelteKit app: server harness host + browser kernel instance   |
| `plugins/*`             | Sidebar, board, renderers, statusbar, trajectory, git, viewers |

`packages/ui-contracts` exists so plugin packages never import from `apps/web`: it holds the
renderer/slot/command/session service interfaces plus the `@nib-ui/kernel` module augmentation.

## Extension points

| Service      | Contributed by                                                                                | Used for                                                                               |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `harnesses`  | server adapters (`claude-code`, `codex`, `pi`)                                                | `createSession`/`resumeSession` per harness                                            |
| `workspace`  | `workspace` (server)                                                                          | cwd autocomplete + `@` file search over the cwd                                        |
| `git`        | `git` (server)                                                                                | status, diff, stage, commit for the session cwd                                        |
| `renderers`  | `core-renderers`, `renderer-diff`, `renderer-terminal`, `task-progress`                       | block rendering by `(kind, toolName)`, plus interactive permission cards by `toolName` |
| `slots`      | `sidebar`, `cost-tracker`, `trajectory-inspector`, `git-panel`, `file-browser`, `file-viewer` | the left rail, statusbar, headers, composer and per-message footers                    |
| `boards`     | `boards` (server)                                                                             | one board per directory, plus the project index the rail reads                         |
| `canvas`     | `canvas`                                                                                      | board object kinds, tools, paste/drop handlers, `openBoard`                            |
| `panes`      | `git-panel`, `file-browser`, `file-viewer`, `task-progress`, `web-browser`                    | tiles in the main area, opened and moved by the user                                   |
| `commands`   | `trajectory-inspector`, `git-panel`, dev commands                                             | command palette (⌘/Ctrl+K)                                                             |
| `fileViewer` | `file-viewer`                                                                                 | `open(sessionId, path)` for any other plugin                                           |

Every registration goes through `ctx.effect(() => disposer)`, so disposing a plugin removes its
renderers, slot entries, listeners and commands. `Toggle plugin: <name>` in the palette exercises it.

## The vault

A project is a directory, and `<project>/.nib` is its memory. Everything in there is a real
file: a **topic** is a directory, a **note** is a markdown file, and nothing else carries
meaning — no manifest, no reserved names, no `index.md`. `[[name]]` links by name rather than
by path, so reorganizing the tree does not break a reference. The rules are written once, in
`packages/vault/src/instructions.ts`, and reach a model twice: appended to the Claude Code
system prompt, and seeded into `.nib/AGENTS.md` when the vault is created, so a human or another
tool that wanders in finds them with no nib involvement.

A board is **one directory's canvas**. Its cards are that directory's own entries plus whatever
was placed on it from elsewhere; double-clicking a topic replaces the canvas with that topic's
board. Dragging a card onto a topic is a real `mv`, and the path-qualified links to it are
rewritten in the same undo step. The edges between cards are derived from `[[…]]` and cannot be
drawn by hand — a link is text in a file.

Only _where_ things sit is the app's: `$XDG_DATA_HOME/nib-ui/boards/<sha256(cwd)>.json` holds a
placements map and the pane layout, and deleting it loses arrangement, never content. A
filesystem watch on `.nib` pushes "it changed" over SSE, so a file the model writes mid-session
appears without a reload.

```text
GET    /api/vault?cwd=…&mentions=1        the scan: items, links, backlinks, unlinked mentions
GET    /api/vault/file?cwd=…&path=…       one file's bytes, confined to the vault
PUT    /api/vault/file?cwd=…&dir=…&name=… write bytes into a topic directory
DELETE /api/vault/file?cwd=…&path=…       delete an entry
POST   /api/vault/move                    mv + link rewrite, reported for an exact undo
GET    /api/vault/events?cwd=…            SSE: the vault changed
```

## Workstreams

A workstream is a goal with at most one harness session behind it, so a directory with no
session yet is still a project you can open and write goals on. Its transcript is written to
`<project>/.nib/<sessionId>.jsonl`, which puts the chat inside the harness's own working
directory: the model can `Grep` its own history.

There is no start screen and no task list. The app opens on the board it was last in, and the
left rail — contributed by the `sidebar` plugin into the `app.sidebar` slot — lists the projects
with the workstreams that still want attention: anything running or waiting on the user, plus
anything not yet marked read. Marking a workstream read writes `reviewedAt` onto the board object
through `POST /api/boards/review`, server-side, because the rail can mark a workstream in a board
no window has open. A reviewed workstream that starts working again comes back: being active
outranks the mark.

```text
GET  /api/boards/list                     every board with its workstreams — the project index
POST /api/boards/review                   set or clear one workstream's review mark
```

## Session metadata

Slash commands, models, the active permission mode, the reasoning-effort level, the archived flag
and the user's label all travel as `session.meta` events on the same log — no side channel. The host emits the harness descriptor's
defaults (`defaultPermissionMode`, `models`) as the session's first event, so the composer's pills
are populated before the harness process is up. The Claude Code adapter then probes
`supportedCommands()`/`supportedModels()` and emits the resolved lists; `setPermissionMode`,
`setModel` and `setLabel` each emit a partial update, and the reducer keeps whatever a partial omits.
A harness that answers none of this simply leaves the composer's capability controls hidden.

A task is named by what it was asked to do: the first `session.send` derives a label from the
prompt, and a log restored from an earlier process backfills one the same way. Renaming by hand
sets a label, and a label already on the log is never overwritten.

## Reviewing in the editor

`file-viewer` reads the session log rather than a git diff: the newest turn's `Edit`/`Write` calls
for the open file are located in the text by their replacement string, drawn as a hunk with the
removed lines above the added ones, and given Accept/Deny. Deny deliberately leaves the file alone
— once every hunk in the file has a verdict, the rejections go back to the agent as a message
asking it to revert them, so the harness stays the only thing writing to disk. An all-accepted
review says nothing: that is already the state of the world.

Selecting lines with nothing left to review opens a prompt above the selection. The question
carries the path, the line range and the selected text, so the agent answers about what is on
screen instead of re-reading the file. The range is painted by the viewer, not left to the
browser's own selection, which collapses the moment the prompt takes focus.

## Detached sessions

A session's harness is a subprocess, and the SDK's `resume` is an argument to starting one, not a
handle on a running one — so a server restart or an explicit stop leaves a task with a transcript
and no process. That is the host's problem, not the user's: any command that needs the harness
reattaches first (`revive`), and concurrent commands on the same task share one reattach. Nothing
in the UI asks to be resumed. File checkpoints are stored by the CLI per session, so a turn stays
undoable across a reattach.

The one case still worth saying out loud is a harness that cannot resume at all: its transcript is
readable and nothing more, so the composer says so.

## Checkpoints and undo

Each prompt is pushed into the harness carrying a uuid we generate, and the same uuid goes out as a
`message.checkpoint` event. That is what makes a turn undoable: `session.rewind` hands the id back
to the harness, which restores the working tree to how it looked before the turn. The transcript is
deliberately untouched — the turn still describes edits that are no longer on disk, so the outcome
is written to the log as well. The Claude Code adapter backs this with the SDK's file checkpointing
(`enableFileCheckpointing` + `rewindFiles`); a harness that has no equivalent leaves `checkpoints`
off its capabilities and the changed-files card never offers Undo.

## Permission rendering

`permission.requested` is routed through `renderers.resolvePermission(toolName)`. A plugin that
claims a tool answers it inline — `core-renderers` registers an `AskUserQuestion` card whose option
picks resolve the request with `{ behavior: 'allow', updatedInput: { …input, answers } }`. Everything
else falls back to the app's allow/deny card, which previews the pending call through the same block
renderers that draw it once it runs (`permissionPreviewBlock`).

## Trajectory

The inspector folds the flat log into the call tree it describes: one row per message, its blocks
nested underneath, and each tool call carrying the result of its own `toolUseId`. Streaming deltas
disappear into the row they were filling. Selecting a row opens Summary / Payload / Result / Raw for
that step, where Raw lists the underlying events with consecutive deltas merged.

## Session-scoped HTTP

Everything a panel needs is addressed by session, so the server resolves the working directory and a
client can never reach outside it:

```text
GET  /api/sessions/[id]/files?query=      fuzzy file search for `@` references
GET  /api/sessions/[id]/tree?path=        one directory level, each entry tagged with its git status
GET  /api/sessions/[id]/file?path=        one file's text for the viewer (1 MB cap)
GET  /api/sessions/[id]/git               branch, ahead/behind, changed files with +/- counts
GET  /api/sessions/[id]/git/diff?path=    unified patch for one file
POST /api/sessions/[id]/git/stage         stage or unstage paths
POST /api/sessions/[id]/git/commit        commit staged work (local only — nothing is pushed)
```

## Commands

```bash
bun test          # kernel + protocol tests
bun run dev       # Electron desktop shell
bun run dev:web   # SvelteKit dev server
bun run build     # production build
bun run typecheck # tsc across every workspace
bun run smoke "list the files here"   # headless adapter smoke test (JSONL to stdout)
```
