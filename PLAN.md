# PLAN: the `.nib` vault

Rework of nib from "a canvas of objects the user wires together by hand" into "a project
mindmap whose source of truth is a directory of real files".

**Status: steps 1–7 of §14 are built; step 8 is not.** §2's decisions are settled. §10–§11 are
the change surface. §15 is what is still open.

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

The model writes the vault, so the format has to be told, always. Two layers, **both done**:

1. `systemPrompt: { type: "preset", preset: "claude_code", append: <vault rules> }` — appends
   rather than replaces, so the prompt-caching prefix survives. Set unconditionally in
   `plugins/harness-claude-code/src/adapter.ts`; it is not a caller option, because a session that
   was never told the format writes a vault nothing can read back.
2. `.nib/AGENTS.md` — the same rules as a file, so a human, `pi` or `codex` that wanders in finds
   them with no nib involvement. This is decision 1 doing its job. Seeded by `openVault` on the
   call that creates the vault — `mkdir` names the first directory it made — so a guide the user
   rewrote or deleted is never restored.

Both read `packages/vault/src/instructions.ts`, which holds the rules once. Two copies of a format
spec is the drift this plan is otherwise built to avoid.

**Correction:** an earlier draft recorded that the SDK does not load project settings unless
`settingSources` includes `"project"`. That is wrong for `@anthropic-ai/claude-agent-sdk@0.3.238`:
omitting the option defaults to `["user", "project", "local"]` and passes no `--setting-sources`
flag, so the CLI's own default applies. The adapter now sets it explicitly anyway — the project's
`.claude/` is part of what the model is being pointed at, and should not ride on an SDK default.

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
  boards/<sha256(cwd)>.json   # { rev, placements, layout }
  sessions/                   # session logs, until they move into the vault (§14 step 7)
  link-previews/              # regenerable cache
```

One board document per directory, holding the placements map — board directory to path to position
— and the pane layout. Nothing else: if it cannot be regenerated it is not here. Deleting the
directory loses layout and camera state, never content.

**Placements live in the board document, not in a `placements/` file of their own**, which is what
an earlier draft of this plan called for. The document is already one per directory, which is one
per vault, and it already carries the `rev` guard, the per-directory write chain, the SSE push and
the routes (`apps/web/src/lib/server/board-store.ts`). A separate file would reuse none of that and
buy only a migration.

`objects` stays in the document while the client is on the old model. Item identity and content
already come from the vault; once the canvas renders from it (§14 step 3), `objects` goes away and
the document is placements and layout alone.

## 10. Code changes

| Area          | File                                                    | Change                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault scan    | `packages/vault`                                        | **Done.** Walk, frontmatter, `[[name]]`, backlinks, unlinked mentions.                                                                                                                               |
| Vault service | `apps/web/src/lib/server/vault.ts`                      | **Done.** Creates the vault on open, scans, projects a wire snapshot, `GET /api/vault`.                                                                                                              |
| Vault files   | `readVaultFile`, `GET /api/vault/file`                  | **Done.** Bytes by vault-relative path, confined to the vault, never served as a document.                                                                                                           |
| Board view    | `plugins/canvas/src/board-view.ts`                      | **Done.** Which objects one board shows, where they sit, and the preview's own auto-layout.                                                                                                          |
| Placements    | `packages/vault/src/placements.ts`, `BoardDoc`          | **Done.** Map keyed by board then path, prune, carry-by-id, `flowSlot`, persisted by `BoardDoc.placements` and covered by the undo stack.                                                            |
| Topics        | `plugins/canvas/src/objects/VaultRenderer.ts`           | **Done.** Topic and file cards, an auto-laid-out preview, an enter action; a drawable file renders its own bytes rather than its extension.                                                          |
| Navigation    | `plugins/canvas/src/registry.svelte.ts`, `dispatch.ts`  | **Done.** Single click previews, double click enters; `dropOnto` reports a drag released on a card, which is what makes a drop a `mv`.                                                               |
| Rendering     | `plugins/canvas/src/engine/`                            | **Done for the vault's own cards.** Derived `[[…]]` edges draw through `VaultLinkRenderer`; `syncObjects` culls anything outside the camera.                                                         |
| History       | `plugins/canvas/src/board.svelte.ts`, `vault.svelte.ts` | **Done.** The trail and the back stack, plus an undo stack over objects, placements and the filesystem action a drag performed.                                                                      |
| Liveness      | `apps/web/src/lib/server/vault-watch.ts`                | **Done.** One recursive watch per project, shared by every subscriber, debounced; `GET /api/vault/events` pushes "it changed" and the client re-scans.                                               |
| Move          | `apps/web/src/lib/server/vault-write.ts`                | **Done.** `POST /api/vault/move`: `mv` + link rewrite + reposition in one undo step. Under `/api/vault`, not `/api/fs`: everything here is confined.                                                 |
| Transcripts   | `apps/web/src/lib/server/session-logs.ts`               | **Done.** `sessionLogDirectory(cwd)` is the project's vault; `sessionHostPlugin` takes a function and restores across every known project.                                                           |
| Assets        | `plugins/assets.ts:31`                                  | **Superseded.** A dropped file is written into the topic directory now, so the store is left holding prompt attachments and the regenerable preview cache — both of which §9 puts in XDG on purpose. |
| Instructions  | `packages/vault/src/instructions.ts`, `adapter.ts`      | **Done.** The rules once; `systemPrompt` append, `settingSources`, and the seeded `.nib/AGENTS.md` all read them.                                                                                    |
| Deprecations  | `plugins/canvas/src/spawn.ts`, `digest.ts`              | `planSpawn`'s source-picking and the compact/full digest lose their reason to exist once the model reads the vault. Keep until retrieval replaces them.                                              |

## 11. Deletions

- ~~`packages/protocol/src/schema.ts` (`Project`, `Session`, `Asset`, `Edge`), `project.ts`, and
  the `index.ts:70` re-export.~~ **Done**, and `assets.ts` and `blobs.ts` went with them: both were
  reachable only from `schema.ts` and had no consumer either. That removes the second object model
  competing with `BoardDoc` for the same concepts.
- ~~The README's "Projects and workstreams" section~~ — **rewritten rather than deleted.** It was
  accurate about workstreams, which still exist; what it was missing was the vault. It is now two
  sections, "The vault" and "Workstreams".
- `EdgeObject.direction`, `EdgeObject.carried`, and the port-drag link-creation gesture.
  **Blocked on the same thing as `BoardDoc.objects`:** derived edges cover the vault's items, and
  a workstream is not one yet, so the port drag is still the only way to relate two tasks.
- `AnnotationObject` as a separate kind: an annotation becomes a note with a source reference,
  which is a file in the vault like everything else. **Blocked on the same thing.**

## 12. Migration

Two one-shot moves, in the shape of `migrateLegacySessionLogs` (idempotent, never overwriting,
new location authoritative):

1. ~~`$XDG_DATA_HOME/nib-ui/sessions/*.jsonl` → `.nib/<topic>/`.~~ **Done** —
   `migrateSessionLogsIntoVaults`. Nothing is guessed: a log's own `session.created` event names
   the directory it was recorded against, so each transcript is filed under its own project, at
   the vault root (§15 q2). A log whose project is gone is left exactly where it is.
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
   **Done** — `packages/vault`: `frontmatter.ts`, `links.ts`, `tree.ts`, `placements.ts`,
   `snapshot.ts`, and `scan.ts` on a `./scan` subpath so the browser bundle never reaches `node:fs`.
   Placed in a package rather than the server because `plugins/canvas` needs the item types and
   cannot import from `apps/web`.
2. **Placements** — per-board position map in XDG, replacing `BoardDoc.objects` as item
   storage. **Done** — `packages/vault/placements.ts` (map, prune, carry-by-id, `flowSlot`,
   `parsePlacements`) and `BoardDoc.placements` persisted by the existing board document, with
   `BoardWrite` keeping an older window from deleting the map. The one policy call left is where an
   unplaced item lands (§15 q3): `flowSlot`'s default, swappable without touching the store.
3. **Canvas from the scan** — topic cards, the auto-laid-out preview, double-click entering a topic.
   **Built, unverified by machine** — `board-view.ts` (which objects a board shows and where, plus
   the preview's own layout), `VaultStore` (navigation, preview, placement persistence),
   `objects/VaultRenderer.ts` (`topic` and `file` cards), `activate(object, gesture)`,
   `GET /api/vault/file`, and `BoardStore` routing vault geometry to placements instead of the
   board document. The repo tests the pure parts; nothing here tests rendered output.
   Since closed: a preview card can be dragged (it has no position of its own, so the drag exists
   to drop it somewhere); a drawable file renders its own bytes; the derived `[[…]]` edges are on
   screen; and the links and search panes give the board a DOM surface it never had. Still open:
   there is no breadcrumb — leaving a topic is the palette command or the empty-board menu.
4. **Instructions** — `systemPrompt` append, `settingSources`, `.nib/AGENTS.md` (§8).
   **Done** — `packages/vault/src/instructions.ts` holds the rules and the vault's two fixed names;
   the adapter appends them to the preset prompt with the vault's absolute path, and `openVault`
   writes the guide into a vault it just created.
5. **Move** — `mv` route, drop-onto-topic hit test, link rewrite, one undo step.
   **Done** — `vault-write.ts` does the `mv` and the rewrite and reports which files it touched;
   `SelectTool` reports the card a drag was released over; `VaultStore.moveInto` performs the move,
   hangs a `BoardAction` off the drag's open history scope and re-keys the placement, so the whole
   gesture is one undo step. The reversal is handed back the files the move rewrote, so it cannot
   touch a link elsewhere that already read the way the move would have produced.
6. **Liveness** — watcher on `.nib/` → SSE, so a model-created file appears without a reload.
   **Done** — `vault-watch.ts`, one shared recursive watch per project with a 120 ms settle;
   `GET /api/vault/events` carries the fact and nothing else, and the client re-scans through the
   same path a manual refresh takes.
7. **Transcripts and assets** — relocate to topic directories, per-vault stores, migration.
   **Transcripts done** — `session-logs.ts`; `sessionHostPlugin` takes `logDirectoryFor(cwd)` and
   restores from every project the board index knows about. **Assets superseded**, see §10.
8. **The old model goes** — `BoardDoc.objects` disappears once a workstream, an annotation and an
   authored edge are vault items like everything else. **Not started, and blocked on a decision
   this plan does not make:** a launched workstream already has a vault item — its transcript —
   but an _unlaunched_ one is a goal with no session, no transcript and four launch picks, and
   nothing here says what file that is. §11's remaining deletions wait on the same answer.

Steps 1–3 are the core. Everything after them is reachable incrementally, and the vault is
useful at every point.

## 15. Open questions

1. ~~**Do boards hide anything?**~~ **Answered:** a board is one directory's canvas, entered by
   replacing the canvas, so a sibling's or ancestor's objects simply are not on it (§5).
2. ~~**Where do existing sessions land?**~~ **Answered: the vault root.** A log names the
   directory it was recorded against, so it is filed under its own project; within that project it
   has no topic, and the root board _is_ the project. An `inbox/` would be a directory that exists
   only because the app made one, which is the metadata decision 2 rules out. (§12)
3. ~~**Where does an item with no stored position land** on its board?~~ **Answered:** at the
   cursor when the user is putting it there, and in the middle of the canvas otherwise. The
   board passes both to `reconcileBoard` as its `slot`; the flowed-row default only applies to a
   caller that supplies neither, which is no longer a case the app hits.
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
