# Next

What is still missing, ordered by what blocks the premise rather than by effort. `PLAN.md` holds
the design; this is the gap between it and the code.

## The gap

**The old model is still in the document.** `BoardDoc.objects` holds authored workstreams, edges,
annotations, media and bookmarks alongside `BoardDoc.placements` holding vault geometry. Two object
models in one file is the state that drifts back, and `objects` goes away when the canvas renders
entirely from the scan.

It is blocked on a decision `PLAN.md` does not make, and the decision is small enough to state
exactly:

- A **launched** workstream already has a vault item — its transcript, now at
  `.nib/<sessionId>.jsonl`. A card for it would be derived, the way a note's card is: the session
  id is the file's stem, `sessions.view(stem)` is already the live projection, and
  `WorkstreamRenderer` already takes nothing from the board but `{id, sessionId, goal, geometry}`.
- An **unlaunched** one has no session, no transcript and four launch picks (harness, model,
  permission mode, effort) plus `reviewedAt`. **There is no file it is.** Making it a note means
  reworking the whole compose-then-launch flow — `PromptSheet`, `openSheet`, `boardPicks`,
  `settingsFor`, `branchCard`, `spawnFrom`, `assetCard` — and inventing where the picks live.

Until that is answered, deriving workstream cards from the scan would give the board **two** ways
to get one, which is worse than the one it has. PLAN §11's remaining deletions —
`EdgeObject.direction`, `EdgeObject.carried`, the port-drag gesture, `AnnotationObject` — wait on
the same answer: derived `[[…]]` edges cover the vault's items, and a workstream is not one yet, so
the port drag is still the only way to relate two tasks.

Smaller, and known:

- **No breadcrumb.** Leaving a topic is the palette command (`canvas.vault.up`) or the empty-board
  menu. `VaultStore.breadcrumb` and `goTo` exist and nothing draws them.
- **An unlinked mention can be seen but not acted on.** The links pane lists them and clicking one
  reveals the target; there is no "link it", because that means editing a body and the app has no
  writer for a note's text — only for its bytes.
- **A dropped url is still a `bookmark` board object.** Files go into the vault now; a url has no
  file, and what note it should become is part of the decision above.

## Still true from the canvas rework

Recorded because nothing else does, and each one already cost a debugging session:

- **`settingSources` was never the reason project settings were invisible.** In
  `@anthropic-ai/claude-agent-sdk@0.3.238` omitting it defaults to `["user", "project", "local"]`
  and emits no `--setting-sources` flag, so the CLI default applies. The adapter sets it anyway, to
  pin the behaviour rather than to change it. PLAN §8 carried the wrong claim and now records this.
- **A bare `[[name]]` is never rewritten by a move, and must not be.** The name did not change;
  only a path-qualified reference breaks. `movedLinkTarget` returns `null` for any reference with
  no `/` in it, and a test asserts it — the first draft rewrote `[[note]]` when `note.md` left the
  vault root and quietly broke every link to it.
- **Resolution only understands two link forms**: a bare name, and a path without its extension.
  `[[topic/note.md]]` resolves to nothing even before a move. The rewrite handles it anyway,
  because a human writes it, but do not add a third form without teaching `resolveLink` first.
- **Vite serves a stale transform for a workspace package.** It reaches `plugins/*` and `packages/*`
  through a symlink it does not watch, so an edit can appear to do nothing. Restart the dev server;
  clearing `.vite` _while it runs_ is worse, because the page keeps requesting dep URLs whose hashes
  are gone. `curl http://localhost:5173/@fs$PWD/plugins/<pkg>/src/<file>.ts` shows what is served.
- **`structuredClone` cannot copy a Svelte state proxy** — it throws `DataCloneError`. The undo stack
  uses `$state.snapshot`.
- **An `$effect` must not read and write board state.** `board.open()` writes `doc` before its fetch
  resolves, so an effect tracking `doc` re-entered it forever. `VaultStore.derive` is explicit for
  exactly this reason: every path into it is a user action or a sync the board reported.
- **Nothing expensive per frame.** `sync` runs every tick for every object, so folding a transcript
  there stalls the app. `BoardStore.objects` is memoised on the identity of both halves, and
  `syncObjects` skips anything whose own rectangle is outside the camera.
- **Culling reads the object, not the renderer.** An unsynced renderer has no bounds yet, so asking
  it would make every card visible on its first frame. `worldBox` reads `x/y/w/h` off the object;
  a kind with no rectangle of its own — an edge — is never culled.
- **Interactive chrome in a Pixi card is hotspot rectangles** resolved by `pressAt`; the select tool
  offers a press to the renderer before it starts a drag.
- **Text sharpness:** `resolutionForZoom` re-bakes in three buckets. Watch it if cards look soft.
- **`plugins/canvas/src/state.svelte.ts` contains a deliberate NUL** in its focus key
  (`${cwd}\x00${sessionId}`), so `grep` reports the file as binary. Use `grep -a`.
- **Accessibility is improving but not fixed:** the board still has no DOM to read. The links and
  search panes are the first real surface — both are ordinary DOM over the same scan.
- **The desktop build is fine:** `pixi.js` lands in the client bundle via Vite, and
  `electron-builder.yml` needs nothing extra. Re-check after an adapter change.

## Carried over

- **The hand-over is our digest, not the harness's summary.** `digest.ts` folds a source workstream
  into a prompt. The Agent SDK exposes its real summary only through the `PostCompact` hook, and
  triggering one means sending `/compact`, which destroys the source session's context.
- **A recursive `fs.watch` is not portable.** It is native on Linux and macOS and absent elsewhere.
  `vault-watch.ts` falls back to watching the vault's own directory, which still catches a new topic
  or a note at the root — most of what a model writes first — and never costs the boot.
- **Nothing on screen is verified by machine.** The repo tests the pure halves — the scan, the
  board view, the link rewrite, the placements, the undo stack — and no test renders a card. Every
  visual claim in `PLAN.md` §14 is a claim.
- **Pre-existing, unrelated:** `bun run typecheck` fails on two errors in
  `plugins/trajectory-inspector/src/filter.ts` (exhaustive switches with no final return), and
  `bun run lint` reports 101 ESLint problems repo-wide plus an oxlint set of the same age. Two of
  the oxlint errors are new — `no-empty-pattern` on the `const {}: PaneProps = $props()` in the
  links and search panes, which is the idiom `canvas-3d/src/ModelViewer.svelte` already uses.
