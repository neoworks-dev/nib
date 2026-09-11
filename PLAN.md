# PLAN: the `.nib` vault

Rework of nib from "a canvas of objects the user wires together by hand" into "a project
mindmap whose source of truth is a directory of real files".

**Status: nothing built.** §2's decisions are settled. §10–§11 are the change surface.
§15 is what is still open.

Reads with `NEXT.md` (the Pixi/workstream rework, largely landed) and supersedes its §1.2
("No projects. One board per directory. The board is the project") and the README's
"Projects and workstreams" section — neither describes this model.

## 1. Premise

The canvas today is a diagram editor, not a project tool, and the reason is structural:

- Board state lives at `$XDG_DATA_HOME/nib-ui/boards/<sha256(cwd)>.json` and assets at
  `$XDG_DATA_HOME/nib-ui/assets/`. The harness runs with `cwd` = the project directory, so
  **none of it is reachable by `Read`/`Grep`/`Glob`.** Nothing sets `mcpServers` or
  `systemPrompt` either.
- The only channel for context into a chat is text prepended to the first prompt, chosen by
  `planSpawn` (`plugins/canvas/src/spawn.ts:19`) from a hand-dragged edge whose
  `carried?: boolean` (`plugins/canvas/src/workstream.ts:106`) is one-shot.

So a note, image or transcript is visible to the model only if the user dragged it there, and
only for the session created at that moment. **The user is the retrieval engine**, and because
wiring is the only transfer mechanism the graph has to be the primary UI. Both symptoms follow
from that one cause.

The fix is not a better graph. It is to make the corpus a directory of files the model already
knows how to read.

## 2. Decisions

1. **`.nib/` in the workspace is the source of truth.** All topics, notes, ideas, decisions,
   images and transcripts live there as real files, usable and readable with nib uninstalled.
2. **The structure is the type system.** A topic is a folder. A folder is a topic. No `index.md`,
   no manifest, no reserved directories, no per-file `kind:` — the tree carries the meaning.
3. **Every file is just itself.** A markdown file is a note because it is a markdown file. No
   file has special significance to the reader.
4. **Position is decoration; the directory tree is structure.** XDG holds arrangement only, and
   holds nothing that cannot be regenerated.
5. **Spatial manipulation is filesystem manipulation.** Dragging an object onto a topic card is a
   real `mv`. There is no parallel record of the relationship.
6. **A board is one directory's canvas.** Entering a topic replaces the entire canvas, the way
   entering a folder does. A topic is collapsed by default.
7. **An item can appear on more than one board** — the same object, not a copy, with its own
   position on each board. That is what "a symlink, the same thing gets shown in the subfolder as
   well" means in practice (§5).
8. **Transcripts and assets live in topic folders**, so they are retrievable by location like
   everything else.
9. **Instructions are first-class.** The model writes the vault, so the vault's format must be
   told to it explicitly and always.

## 3. The vault

```
<repo>/.nib/
  a-note.md                       # a note at the root of the vault
  topic-x/                        # a topic: a folder object on the root board
    a-note.md
    diagram.png                   # referenced by path if already in the repo
    <sessionId>.jsonl             # the transcript of a chat about this topic
    sub-topic/                    # a subtopic: a folder object on topic-x's board
      a-note.md
```

There are no reserved names and no metadata files. `topic-x` is a topic because it is a
directory; `a-note.md` is a note because it is a markdown file.

Opening a directory with nib creates `.nib/`, whether or not anything is written yet. The vault root
is the repo root; a `.nib/` in a subdirectory is **not** a second vault (§5).

If the directory is not writable, the vault reports that it could not be created rather than
failing the boot: a project still opens, with a board that says why it is empty.

## 4. Identity, links, rename

A folder has no frontmatter, so it has no id. That is the deliberate cost of decision 3, and it
is paid for in one place: link durability under rename.

- `[[name]]` resolves by **name** — a file stem or a directory name — most-specific match wins,
  path-qualified (`[[topic-x/a-note]]`) when ambiguous. Links into a folder resolve to the topic.
- Optional `id:` frontmatter on any markdown file makes a link survive an external rename. It is
  opt-in and never required; frontmatter on a markdown file is ordinary markdown, not a special
  file.
- **The app owns `mv`.** A drag between folders rewrites every link to the moved name in the same
  operation, so links survive app-driven moves. `git mv` or a rename in an editor will break
  them. Accepted: the alternative was an indirection file, which decision 3 rules out.

Backlinks and the edge set are **derived**, not authored: scan `.nib/**/*.md` for `[[…]]` and
render the result. `EdgeObject.direction`, `EdgeObject.carried` and the whole
drag-a-port-to-create-a-link gesture exist only because the user was the retrieval engine, and
they go away.

One derived feature is worth building because it makes the mindmap feel alive: **unlinked
mentions** — an item's title or name appearing in another item's body without a link. It is how
a connection the user never made gets surfaced.

## 5. Boards and navigation

A board is the canvas for **one directory**. Entering a topic **replaces the entire canvas** — it is
entering the folder, not panning a shared space. A topic is a collapsed card on its parent's board;
its contents are not drawn there.

That gives one rule, and it is what makes the whole thing coherent:

> The topic a drop lands in is the destination directory.

Dropping an object onto a topic card is `mv` into that directory; dropping it on empty canvas is
`mv` to the current board's directory. Hit-testing is the existing topmost-wins walk
(`workstreamAt`, `plugins/canvas/src/workstream.ts:327`) over topic cards.

Consequences:

- **A board never needs positions for its topics' contents.** A subtopic's items are a card on this
  board and a layout on the subtopic's own board, so a board's placements cover its own directory's
  items and nothing deeper. This is what keeps a board finite however large the vault grows.
- **The whole-project view is the vault root board**, reached by going back to the top, not by
  zooming out.
- **Placements are per board** (§9). An item can appear on more than one board — the same object,
  with its own position on each — which is what decision 7's symlink means in practice.

**Moving objects is filesystem mutation and must be undoable.** The snapshot stack is
`NEXT.md` §1.9; a `mv` plus link rewrites plus a reposition is one step.

## 6. Previews and navigation

| Gesture                 | What happens                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Single click on a topic | The items inside are laid out by the app and drawn — the real items, positions unused |
| Double click on a topic | That topic's board **replaces the canvas**                                            |
| Single click on an item | Selects it                                                                            |
| Double click on an item | Opens it — the kind decides what opening means                                        |

The gesture plumbing already exists and needs only its contract changed:

| Where                                               | What it already does                                               |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/ui-contracts/src/canvas.ts:100`           | `ActivationGesture = "click" \| "doubleClick"`                     |
| `plugins/canvas/src/engine/tools/SelectTool.ts:277` | emits `activate(id, "click")`                                      |
| `plugins/canvas/src/engine/CanvasEngine.ts:531`     | emits `"doubleClick"`                                              |
| `plugins/canvas/src/dispatch.ts:35`                 | **swallows the single click** for any kind that defines `activate` |

So: let a kind answer the click as preview and the double-click as open. The topic renderer gets
`preview`/`expand` instead of only `activate`.

The preview is **the items themselves, laid out by the app** — a note is its note card, an image is
its image — and not a list of names. A topic _is_ the collection of what is inside it, so its
overview shows that collection. That means Pixi and the existing per-kind renderers, reusing
`kind.createRenderer` for each item, rather than a DOM list.

Positions are unused, so the arrangement comes from the **same auto-layout function** a board uses
for an item that has no stored position yet (§9, §14 step 2). One function, two uses: arranging a
collection that has no positions, and choosing where a newly discovered item sits.

Open: whether the preview expands the topic in place, with the surrounding board still visible, or
takes over the canvas as an auto-arranged view — which would make it a read-only sibling of the real
board rather than a peek at it (§15 q5).

## 7. Chats, transcripts, assets

A transcript lives at `.nib/<topic>/<sessionId>.jsonl` and renders as an object on that topic's
board — which is what the workstream card already is. So "a chat is attached to a topic" becomes a
statement about location, and needs no field, no edge and no wiring. Item 1 of §2's goals falls
out of the storage layout.

- `sessionsDirectory()` (`apps/web/src/lib/server/data-dir.ts:15`) becomes per-vault.
  `migrateLegacySessionLogs` next to it is the pattern for the one-shot move.
- **The model should not read raw JSONL.** Tool payloads and delta events make it expensive and
  noisy. The topic's notes are where the record of the work belongs, maintained by the model as
  it works. The transcript is the evidence you go back to when the notes are wrong.
- Media dropped with no path in the repo is written into the topic directory. Media that is
  already in the repo is **referenced by path, never copied** — a copy is a second source of
  truth that goes stale and outlives a deletion.

Storage split, and the principle behind it:

| Kind                                      | Where   | Why                       |
| ----------------------------------------- | ------- | ------------------------- |
| Notes, topics, transcripts, dropped media | `.nib/` | authored or irreplaceable |
| Placements, camera, pane layout           | XDG     | regenerable               |
| Link-preview OG images and favicons       | XDG     | regenerable by refetching |

Notes are committed. Transcripts and binary assets are gitignored by extension inside `.nib/` —
JSONL changes every turn, and committing it makes every diff unreadable.

## 8. Instructions to the model

The model writes the vault, so the format has to be told, always. Two layers:

1. `systemPrompt: { type: "preset", preset: "claude_code", append: <vault rules> }` — appends
   rather than replaces, so the prompt-caching prefix survives. Verified available in the
   installed SDK (`@anthropic-ai/claude-agent-sdk@0.3.238`, `sdk.d.ts` `Options.systemPrompt`).
2. `.nib/AGENTS.md` — the same rules as a file, so a human, `pi` or `codex` that wanders in finds
   them with no nib involvement. This is decision 1 doing its job.

**Gotcha:** `plugins/harness-claude-code/src/adapter.ts:110` spreads `opts.options` into the SDK
`Options` but never sets `settingSources`. The SDK does not load project settings unless
`settingSources` includes `"project"`, so a `.claude/` directory inside the repo is currently
invisible.

The rules the instructions must cover:

1. Where the vault is, and that it — not XDG — is the source of truth.
2. A topic is a folder, a note is a markdown file, and nothing else carries meaning.
3. `[[name]]` links; resolve by name; path-qualify when ambiguous; never link by id unless the
   target opts into one.
4. **Search the vault before creating anything**, so duplicates do not accumulate. This is the
   rule that keeps retrieval working as the vault grows.
5. Reference media by path when it is already in the repo; write into the topic directory only
   when there is no path.
6. Write work back into the topic's notes as it happens.
7. What is committed and what is gitignored.

## 9. What lives in XDG

```
$XDG_DATA_HOME/nib-ui/
  placements/<sha256(vaultRoot)>.json   # { board → { path → { id, x, y, w, h, z } } }
  link-previews/                        # regenerable cache
```

One map per vault, keyed by board directory and then by path (§5). A board's own directory is the
only one it needs entries for, because a topic's contents are laid out on the topic's board and
never on its parent's. Nothing else lives here: if it cannot be regenerated it is not here.
Deleting this directory loses layout and camera state, never content.

This replaces `BoardStore`'s one-document-per-cwd model (`boardFileName(cwd)`,
`apps/web/src/lib/server/board-store.ts:18`) for _objects_; the `rev` guard and SSE push
(`/api/boards/events`, `Last-Event-ID` = rev) stay as they are, since concurrent windows still
need last-writer protection.

## 10. Code changes

| Area         | File                                                          | Change                                                                                                                                                  |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault scan   | `packages/vault`                                              | **Done.** Walk, frontmatter, `[[name]]`, backlinks, unlinked mentions.                                                                                  |
| Placements   | new, server + `packages/ui-contracts`                         | Per-vault map keyed by board then path, replacing `BoardDoc.objects` as the storage for item positions.                                                 |
| Topics       | `plugins/canvas/src/workstream.ts`                            | Topic object kind: a collapsed card, an auto-laid-out preview of its contents, an enter action.                                                         |
| Navigation   | `plugins/canvas/src/registry.svelte.ts:216`, `dispatch.ts:35` | Single click → preview the contents, double click → replace the canvas with that topic's board.                                                         |
| Rendering    | `plugins/canvas/src/engine/`                                  | Draw from the scan; the preview reuses the per-kind renderers at app-chosen positions.                                                                  |
| History      | `plugins/canvas/src/board.svelte.ts`                          | Which board the window is on, and the back stack.                                                                                                       |
| Liveness     | new, server                                                   | Filesystem watch on `.nib/` → SSE. **Nothing watches the filesystem today.**                                                                            |
| Move         | new route, `apps/web/src/routes/api/fs/`                      | `mv` + link rewrite + reposition, one undo step. No such route exists.                                                                                  |
| Transcripts  | `apps/web/src/lib/server/data-dir.ts:15`, `context.ts:35`     | Per-vault `sessionsDirectory()`; `sessionHostPlugin`'s `logDirectory` follows.                                                                          |
| Assets       | `plugins/assets.ts:31`                                        | Per-vault store; `assetsDirectory()` stops being a singleton.                                                                                           |
| Instructions | `plugins/harness-claude-code/src/adapter.ts:110`              | `systemPrompt` append; set `settingSources`.                                                                                                            |
| Deprecations | `plugins/canvas/src/spawn.ts`, `digest.ts`                    | `planSpawn`'s source-picking and the compact/full digest lose their reason to exist once the model reads the vault. Keep until retrieval replaces them. |

## 11. Deletions

- `packages/protocol/src/schema.ts` (`Project`, `Session`, `Asset`, `Edge`), `project.ts`, and the
  `index.ts:70` re-export. Dead — no consumer — and it competes with `BoardDoc` for the same
  concepts (`Edge.relation: "branch" | "join" | "ref"` vs the canvas' `EdgeDirection`). Two object
  models describing one idea is how the design drifts back.
- The README's "Projects and workstreams" section, and `NEXT.md` §1.2.
- `EdgeObject.direction`, `EdgeObject.carried`, and the port-drag link-creation gesture.
- `AnnotationObject` as a separate kind: an annotation becomes a note with a source reference,
  which is a file in the vault like everything else.

## 12. Migration

Two one-shot moves, in the shape of `migrateLegacySessionLogs` (idempotent, never overwriting,
new location authoritative):

1. `$XDG_DATA_HOME/nib-ui/sessions/*.jsonl` → `.nib/<topic>/`. Existing sessions have no topic.
   Needs a destination rule — see §15.
2. `$XDG_DATA_HOME/nib-ui/boards/<sha256>.json` → materials for the placements map, plus `.nib/`
   files for any object that holds authored content (notes, media). Objects with no content
   (edges) are dropped: the relation is re-derived from the files.

`plugins/canvas/src/migrate.ts` (localStorage → board) is the worked example for a migration that
must run once and delete its source only after the target is written.

## 13. Risks

- **Drag mutates the filesystem.** Undo must cover `mv` + link rewrites + reposition as one step,
  or an accidental drag is unrecoverable.
- **Region/directory drift** after external renames (§5).
- **Link rot** on external renames (§4). Accepted, with `id:` as the opt-out.
- **`bun test` cannot compile runes**, so `.svelte.ts` reactive shells stay untested
  (`NEXT.md` §8, §13.6) — keep the pure logic in plain modules so the contract is testable.
- **Per-frame cost.** Fold nothing new into `sync`; the scan must be memoised and invalidated by
  the watcher, not recomputed per frame (`NEXT.md` §9).
- **Culling.** `NEXT.md` §13.4 (every object syncs every frame, camera ignored) still stands. A
  board per directory bounds how many objects a board has, but a single flat directory with a
  hundred files is still a hundred objects, so culling becomes required rather than deferred.
- **Accessibility.** `NEXT.md` §9 already notes the board has no DOM to read; a vault of markdown
  is the opportunity to fix it properly, with a file tree as the accessible surface.
- **Size.** A vault with hundreds of topics and a transcript per topic is a lot of objects and a
  lot of bytes. Transcripts are the bulk.

## 14. Build order

1. **Vault scan** — walk `.nib/`, parse frontmatter, resolve `[[name]]`, compute backlinks and
   unlinked mentions. Pure functions over the tree, no UI, fully testable.
   **Done** — `packages/vault`: `frontmatter.ts`, `links.ts`, `tree.ts`, `scan.ts`, 57 tests.
   Placed in a package rather than the server because `plugins/canvas` needs the item types and
   cannot import from `apps/web`.
2. **Placements** — per-board position map in XDG, replacing `BoardDoc.objects` as item storage.
   _Pure half done_ — `packages/vault/placements.ts`: per-board map, prune, carry-by-id, slot
   chooser, 14 tests. The server store and the one policy call (where an unplaced item lands) are
   open (§15 q3).
3. **Canvas from the scan** — topic cards, the auto-laid-out preview, double-click entering a topic.
   _After this the vault is a working mindmap._
4. **Instructions** — `systemPrompt` append, `settingSources`, `.nib/AGENTS.md` (§8).
5. **Move** — `mv` route, drop-onto-topic hit test, link rewrite, one undo step.
6. **Liveness** — watcher on `.nib/` → SSE, so a model-created file appears without a reload.
7. **Transcripts and assets** — relocate to topic directories, per-vault stores, migration.

Steps 1–3 are the core. Everything after them is reachable incrementally, and the vault is
useful at every point.

## 15. Open questions

1. ~~**Do boards hide anything?**~~ **Answered:** a board is one directory's canvas, entered by
   replacing the canvas, so a sibling's or ancestor's objects simply are not on it (§5).
2. **Where do existing sessions land?** They have no topic. An inbox topic, or the vault root?
   (§12)
3. **Where does an item with no stored position land** on its board — beside its topic, in a grid
   row, or in an inbox region? (§14 step 2)
4. **How do ancestors' items show on a deeper board** — only if explicitly placed there, or
   automatically on entry? The two readings of "it's a symlink" differ here.
5. **Does a topic's preview expand in place**, with the surrounding board still visible, or **take
   over the canvas** as an auto-arranged view? (§6)
6. **Do transcripts also get a rendered markdown view** for the model, or is raw JSONL the only
   form? Recommended: neither, per §7 — the model maintains the notes and reads the JSONL only
   when asked.
7. ~~**Is `.nib/` created eagerly** on opening any directory, or only on first write?~~ **Eagerly,
   on open** (§3).
8. **Committed layout?** Placements are per-machine today. An opt-in `.nib/`-committed layout is
   possible but not planned.
