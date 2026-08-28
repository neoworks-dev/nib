# Next: Pixi canvas engine + workstreams

Rework of the canvas from a DOM board of per-turn nodes into a Pixi-rendered board of
workstreams that represents the whole state of a directory. Engine code is ported from
`~/Documents/neoworks/muse` (same author, private repo — reuse is unencumbered).

**Status: §10 steps 1 and 2 are done. Step 3 has `canvas-media` and `canvas-links`; `canvas-notes`
and `canvas-draw` are open. Step 4 is partly done.** §12 records what
landed and where; §13 is what is left. Decisions in §1 are settled; §9 lists risks and gotchas.

## 1. Decisions

1. **Full Pixi.** Every board object, workstream cards included, is drawn in Pixi.
   DOM survives only for the chat drawer, floating panes, and text-edit overlays.
2. **No projects.** One board per directory (`cwd`). The board is the project.
3. **Workstream = at most one harness session.** The card shows goal, inputs and output
   steps; per-turn exchange nodes stop being board objects and the transcript moves to the
   drawer. A workstream can exist as an unlaunched goal — `sessionId` is optional and set
   when the session is launched (today's unlaunched join node behaviour).
4. **Board state and pasted media are server-side**, not localStorage.
5. **Object kinds ship as plugins over the core**: media, link previews, notes, strokes.
6. **Branch and join stay as typed edge kinds** between workstreams; migration maps them 1:1
   with direction and label preserved.
7. **Board changes push over SSE.** A board events stream broadcasts writes to every window
   on the same board; `rev` still guards against stale writes.
8. **All on-disk state moves under `$XDG_DATA_HOME/nib-ui`** (default
   `~/.local/share/nib-ui`): sessions, boards, assets, link previews. Existing
   `./.nib-ui/sessions` logs are migrated on server start.
9. **Undo/redo ports muse's snapshot stack** (100-deep). Confirmed cheap: media objects hold
   `assetId` references, never bytes.

## 2. Target shape

```
plugins/canvas/                 core: engine, registry service, workstream + edge kinds   [done]
  src/engine/                   ported from muse, decoupled from its globals              [done]
plugins/canvas-media/           image / gif / video / pdf paste + drop, resize handles     [done]
plugins/canvas-links/           url paste → link preview card                             [done]
plugins/canvas-notes/           free-floating markdown notes                              [open]
plugins/canvas-draw/            pen + eraser, pressure strokes                            [open]
```

Each satellite plugin is `inject: ['canvas']` and registers into the canvas registry.
None of them import the engine directly.

## 3. What comes from muse

Paths relative to `~/Documents/neoworks/muse/src/lib/canvas`. Every file listed imports
muse's `state.svelte.ts` / `actions.svelte.ts` singletons; the port replaces those imports
with injected board access and intent callbacks.

| muse file | LOC | lands as | status |
|---|---|---|---|
| `core/CanvasRenderer.ts` | 401 | `plugins/canvas/src/engine/CanvasEngine.ts` | done — tick → `syncObjects`/`syncCamera`, pointer/pinch/middle-drag pan, wheel zoom, keyboard. `visibleObjects()` folder scoping, `ui.*` reads and direct `actions` calls all replaced by `EngineHost`. |
| `core/BaseObjectRenderer.ts` | 121 | `engine/ObjectRenderer.ts` | done — spawn/exit animation, world-space hit test, bounds. |
| `core/types.ts`, `core/pixi.ts` | 44 | contracts in `@nib-ui/ui-contracts` | done — `ToolId` is an open string; kinds are registered, not enumerated. The `pixi.ts` renderer singleton is gone: the engine hands its `Application` to `createRenderer`. |
| `tools/Tool.ts` + `tools/MultiSelectTool.ts` | 294 | `engine/tools/SelectTool.ts` | done — click / drag / rubber-band / resize-handle state machine, emitting intents instead of calling muse actions. |
| `tools/DrawTool.ts`, `tools/EraseTool.ts` | 81 | `plugins/canvas-draw` | open |
| `utils/geometry.ts`, `easing.ts`, `ids.ts`, `view.ts` | 83 | `engine/utils/*` | done — `view.ts` became `utils/camera.ts`; `zoomAt` returns a new camera rather than mutating, so a reactive store can assign it. |
| `objects/LinkRenderer.ts` | 226 | `plugins/canvas/src/objects/EdgeRenderer.ts` | done — arrow + label + direction, endpoints read from the live renderers each frame so a line follows a dragged card. |
| `objects/StrokeRenderer.ts` | 86 | `plugins/canvas-draw` | open |
| `objects/MediaRenderer.ts` | 457 | `plugins/canvas-media` | done as a rewrite. Animated GIFs use `pixi.js/gif`, which ships inside `pixi.js@8.14.2` — no new dependency. Video is a muted looping `HTMLVideoElement` textured into a sprite; a pdf is a labelled card that opens in a tab. |
| `objects/BookmarkRenderer.ts` | 288 | `plugins/canvas-links` | done as a rewrite. Image and favicon are both asset ids, never urls. |
| `objects/NoteRenderer.ts` | 201 | `plugins/canvas-notes` | open |
| `utils/markdownRenderer.ts` | 364 | `engine/utils/textTexture.ts` | done as a rewrite, not a port: runs → wrap → bake to one texture, with an LRU cache and zoom-stepped bake resolution. Markdown block parsing was dropped; nothing on the board needs it yet. Bring the block parser across with `canvas-notes`. |
| `objects/DocumentRenderer.ts`, `objects/FolderRenderer.ts`, `objects/rendererFactory.ts` | — | not ported | documents and folders are out of scope; the factory is replaced by the registry. |

Muse's paste/drop pipeline (`src/routes/+page.svelte:463-640`) is the model for the paste
handlers, but its network calls move to the server (§6). Ordered, first claim wins: media is
`order: 10` and links `order: 20`, because a copied image arrives with an HTML fallback whose
text is a url and the picture is the better reading of that paste. The board only claims a
paste whose target is not an input, textarea or contenteditable — the handler is on `window`,
and a url pasted into the chat composer must reach the composer.

## 4. Extensibility contract (cordis style)

Lives in `packages/ui-contracts/src/canvas.ts`, added to the `Services` map as `canvas`.
Registration follows the existing `panes` / `renderers` / `slots` pattern: register returns a
`Disposer`, plugins register inside `ctx.effect`, unloading a plugin removes its objects.

Shipped surface: `registerKind`, `registerTool`, `registerPasteHandler`, `registerDropHandler`,
`registerContextMenu`, `registerLayer`, plus `objects` / `selection` / `camera` / `activeTool`,
`addObject` / `updateObject` / `removeObjects` / `select` / `setTool`,
`screenToWorld` / `worldToScreen`, and `undo` / `redo`.

**The contract carries no concrete object kinds.** `CanvasObject` is opaque and that is all
ui-contracts knows: `workstream`, `edge` and `annotation` are typed in `plugins/canvas`, and
`media` / `bookmark` / `note` / `stroke` belong to their own plugins. `plugins/canvas` re-exports
the renderer toolkit (`ObjectRenderer`, the resize handles, the connect ports, `TextTextureCache`,
`boardTheme`) so a satellite composes against the package and never against `src/engine/*`.

Two things the original sketch did not have:

- **`CanvasRegistry` is not `CanvasEngineApi`.** The registry is the service and outlives any
  mounted engine, so it has no `app`. `CanvasEngineApi` — camera, hit testing, bounds,
  mutation, `beginHistory`, and the Pixi `Application` — is what `createRenderer` receives.
- **Board objects are opaque** (`{ kind: string; id: string; [key: string]: unknown }`).
  Typing happens in `CanvasObjectKind.parse`, which is what lets an object whose kind no
  loaded plugin claims survive a load/save round trip instead of being dropped.

Three opt-in renderer capabilities the select tool drives: `ResizableRenderer` (handles,
`beginResize` / `applyResize` / `endResize`) and `PressableRenderer` (`pressAt`, for chrome drawn
inside a card) in `engine/resize.ts`, and `ConnectableRenderer` (`portAt` / `hoverPort` /
`portAnchor`) in `engine/ports.ts`. The connect gesture ends at `CanvasEngineApi.connect(fromId,
toId, at)` — an intent, so the tool never learns what the objects on either end are.

Handles are the four corners only, drawn as circles *inside* the object and faded in by how close
the pointer is (`handleOpacity`). Mid-edge handles are gone: they collided with the ports, and
handles hung outside an object collide with whatever it sits next to. Selection is a ring drawn
outside the card at a constant width on screen, not a thicker border — a border that grows with
the selection reads as the card changing size.

## 5. Board document

```ts
interface BoardDoc {
  version: 1;      // schema version, bumped on shape changes
  rev: number;     // monotonic revision, incremented on every write; guards stale PUTs
  cwd: string;
  objects: CanvasObject[];
}
```

Kinds: `workstream`, `edge`, `annotation`, plus `note` / `media` / `bookmark` / `stroke` for
the satellite plugins. `annotation` was not in the original list but is needed by §7's
"keep annotations": it carries `sessionId` + `messageId` + `text` + optional `note`, has no
renderer of its own, and is drawn as a badge row by the workstream that owns its session.

**The board stores placement and authored content only.** A workstream's title, status,
model, working flag, inputs and outputs are derived from the live `SessionView` at render
time — never copied into the board.

Derivation lives in `plugins/canvas/src/workstream.ts` (`workstreamView`), reusing
`exchanges.ts` and `steps.ts`. `digest.ts` survives with `nodeDigest` replaced by
`digestOf(prompt, reply)`, since there are no trunk nodes any more. `graph.ts`, `layout.ts`,
`persistence.ts` and `NodeCard.svelte` are deleted; their tests are replaced by
`workstream.test.ts`, `board-ops.test.ts` and `migrate.test.ts`.

## 6. Server work

Done:

```
$XDG_DATA_HOME/nib-ui/
  sessions/<sessionId>.jsonl     (migrated once from ./.nib-ui/sessions)
  boards/<sha256(cwd)>.json
```

| route | status |
|---|---|
| `GET  /api/boards?cwd=` | done |
| `PUT  /api/boards?cwd=` | done — 409 unless `rev` is exactly current + 1 |
| `GET  /api/boards/events?cwd=` | done — `Last-Event-ID` = `rev`, sends the current board on connect so a window that missed a write catches up |
| `POST /api/assets` | done — 413 over the cap, 415 for a type the bytes are not |
| `GET  /api/assets/[id]` | done — immutable cache, `nosniff`, `default-src 'none'; sandbox` |
| `POST /api/link-preview` | done — 400 for a refused url, 502 for a scrape that failed |

Notes on what landed: the migration leaves a name already present in the XDG directory alone
(the new location is authoritative, so a re-run is a no-op) and removes the legacy directory
only when it empties on its own. Board writes are serialised per directory — the `rev` check
is read-then-write and must not interleave — and are written to a temp file then renamed, so
a crash mid-write cannot leave half a board.

Assets and link previews are server kernel plugins (`assets`, `linkPreviews` on the `Services`
map) registered in `serverContext()`, the way `boardsPlugin` is, with thin routes over them.
The link-preview cache key carries a schema version — without it an entry written by an older
build is served forever under a key that says nothing about its fields.

**Still to build — link preview must not copy muse's client-side fetch.**
`src/lib/api/link-preview.ts` works only because Electron runs with `webSecurity: false`; in a
browser CORS blocks it. Server-side requirements:

- `http:`/`https:` only; reject anything else outright.
- Resolve the host and refuse loopback, private, link-local and unique-local addresses before
  connecting, and re-check after redirects (SSRF: the URL is attacker-supplied whenever a
  transcript or a page the agent visited suggests one).
- 8s timeout, cap the response at ~2 MB, follow at most 3 redirects.
- Parse with a dependency-free head scanner — **not** Bun's `HTMLRewriter`, which an earlier draft
  of this plan called for. Production runs the SvelteKit server inside Electron, on Node, where
  that global does not exist. Pull `og:*`, `twitter:*`, `<title>`, `<link rel=icon>`, resolving
  relative urls against the final url.
- Fetch the OG image server-side into the asset store so the board never hotlinks.

Asset store: 25 MB cap, type sniffed from the bytes rather than the client's claim, stored under
the hash with a derived extension. PNG, JPEG, GIF, WebP, ICO, PDF, MP4 and WebM are kept; SVG is
refused outright, since it is a script-carrying document however it is served.

**Residual risk: DNS rebinding.** The guard resolves the host and validates every record before
each hop, then fetches by hostname — so a name that answers differently between the check and the
connection is not covered. Closing it means connecting to the validated address directly, which
breaks TLS SNI, or a custom `lookup` through an undici dispatcher. Not worth it while this is a
local-first app whose worst case is reaching a service on the user's own machine, but it is a
real gap rather than an oversight.

## 7. Client work

Done: `TransportService` gained `loadBoard` / `saveBoard` / `subscribeBoard`. `canvasState` is
now three pieces — `board.svelte.ts` (objects, persistence, undo), `registry.svelte.ts` (the
`canvas` service: registrations, selection, camera, tool) and `state.svelte.ts` (drawer,
prompt sheet, launching, annotations). Pan and zoom stay client-only; placement is persisted.
Migration from `nib-ui.canvas` runs once and deletes the key only after every board it
produced has been written. Annotation pins are a badge row on the Pixi card and `×` still
routes through `unpinAnnotation`. The rounded, resizable right-hand chat drawer is unchanged
and opening a card targets its session.

Dragging a connector port out of a card and dropping it on another links the two; dropping it on
empty board opens the prompt sheet with a compacted/full context toggle. `TransportService` is
untouched by the satellites — each fetches its own route.

## 8. Tests

`bun test`, targeted at the pure modules — Pixi rendering itself is not unit-tested.

Written:

- `engine/utils/geometry`: point-in-rect with padding, rubber-band intersection (a zero-area
  band selects nothing), corner normalisation, world bounds union, edge points.
- camera: `screenToWorld`/`worldToScreen` round trip, `zoomAt` keeps the pointer anchored
  (including at the clamp), zoom clamping, `cameraFitting`.
- board reducer: add/update/remove, a patch may move an object but never retype it, edge
  cascade on delete, rebase of a concurrent write, unknown-kind objects surviving untouched.
- registry dispatch: handlers run in `order`, first claim wins, an async handler is awaited
  before the next is offered the payload, a disposed handler stops receiving payloads.
- workstream derivation: unlaunched vs detached vs live, title from the session not the board,
  output is the newest answer, step summary across turns, annotations filtered to the session.
- card chrome: corner handles stay inside the object and shrink their inset with the zoom, a tiny
  object never pushes them past its middle, mid-edge points are not handles, handle opacity falls
  off with pointer distance, ports sit on the right and bottom edges and never overlap a corner.
- `transcriptDigest`: transcript order preserved, oldest turns dropped at the budget, the newest
  turn travels even when it alone is over budget, blank turns skipped.
- asset store: content-addressed naming, the same bytes stored once, no temp file left behind,
  type sniffed from the bytes (svg and html refused), size cap, and an id that is not one the
  store could have minted never reaching the filesystem.
- link preview: a table-driven SSRF guard (loopback, `10/8`, `172.16/12`, `192.168/16`,
  link-local, CGNAT, benchmarking, multicast, broadcast, `::1`, `fd00::`, `fe80::`, v4-mapped
  loopback, and a host that resolves to one public *and* one private record), the head scanner
  against fixture HTML (OG wins, twitter fallback, `<title>` fallback, none, relative favicon,
  entities, unquoted attributes, body tags ignored), relative-url resolution, and the redirect
  hops — followed, refused before a private hop is requested, and given up on in a loop.
- board writes: `rev` exactly current + 1 accepted, stale and skipped revs rejected, corrupt
  and duplicate objects, no temp file left behind.
- migration: old doc shape → board, a doc whose sessions are gone, positions carried by the
  topmost placed node, two docs in one directory without id collisions; session log move from
  `./.nib-ui/sessions` to the XDG directory, idempotent on re-run, never overwriting.

Still to write, with the features they cover:

- the board store's own debounce / conflict / SSE-echo behaviour. `board-ops.ts` covers the
  rules, but `BoardStore` itself is a `.svelte.ts` rune class and `bun test` cannot compile
  runes — it needs either a Svelte-aware test setup or the reactive shell kept thin enough
  that the plain module is the whole contract.

## 9. Risks and gotchas

Confirmed while building, keep in mind:

- **SSR is not a risk here.** `apps/web/src/routes/+layout.ts` sets `ssr = false`, so the page
  component is never imported on the server and `pixi.js` can be a static import. The
  dynamic-import-in-`onMount` dance in the original plan is unnecessary.
- **The dev server caches transforms.** `apps/web/node_modules/.vite` served pre-edit canvas
  code for an entire debugging session — fixes appeared to do nothing. This bit again while
  building the satellite plugins: Vite kept serving a stale transform of
  `plugins/canvas-links/src/*` after an edit, because the workspace packages reach it through a
  symlink it does not watch. `curl http://localhost:5173/@fs$PWD/plugins/<pkg>/src/<file>.ts`
  shows what is actually being served — check that before debugging the code. The fix is a
  server restart; clearing `.vite` while the server is running instead breaks it, since the page
  keeps requesting dep URLs whose hashes no longer exist.
- **`structuredClone` cannot copy a Svelte state proxy** — it throws `DataCloneError`. The
  undo snapshot uses `$state.snapshot`.
- **An `$effect` must not read and write board state.** `board.open()` writes `doc` before its
  fetch resolves; an effect that tracked `doc` re-entered it forever and opened thousands of
  EventSource connections. The pane tracks `sessionId`/`cwd` only and calls `focus` inside
  `untrack`, and `open` collapses concurrent calls for the same `cwd` onto one promise. Any
  new board-mutating call from an effect needs the same treatment.
- **Nothing expensive per frame.** `sync` runs every tick for every object. Folding the
  transcript there, or calling `getComputedStyle`, stalls the whole app. Cards memoise on
  `session.lastSeq`; the palette is read once and cached, with `themeRevision()` in the
  texture keys so a light/dark switch still invalidates the bakes.
- **Text sharpness.** `resolutionForZoom` re-bakes in three buckets. Watch it if cards start
  looking soft at high zoom.
- **Interactive card chrome** cost roughly what was budgeted. Allow/Deny, file chips and quote
  badges are `hotspots` rectangles resolved by `pressAt`; the select tool offers a press to the
  renderer before it starts a drag.
- **Accessibility.** Still an open regression: the board has no DOM to read. Either mirror
  workstreams into an offscreen aria list or accept it knowingly.
- **Desktop build.** `pixi.js` lands in the client bundle (~1 MB chunk) via Vite, so
  `electron-builder.yml` needs nothing extra. Re-check after any adapter change.

## 10. Order of work

1. ~~XDG storage move + engine port + registry service + board persistence + migration, with
   the workstream card drawing title/status/goal only.~~ **Done.**
2. ~~Inputs and outputs on the card, edges, annotation badges, drawer wiring, board SSE push,
   edge creation by dragging a port out of a card.~~ **Done.**
3. ~~`canvas-media` → `canvas-links`.~~ **Done.** `canvas-notes` and `canvas-draw` are open.
4. Polish: viewport culling. Undo/redo, texture cache eviction, the selection ring, the resize
   handles and the context menu's placement are done.

## 11. Open questions

None.

## 12. What landed

New:

```
packages/ui-contracts/src/canvas.ts          the contract, incl. BoardDoc and the object kinds
apps/web/src/lib/server/data-dir.ts          XDG paths + one-shot legacy session log migration
apps/web/src/lib/server/board-store.ts       parse / read / write, rev guard, atomic rename
apps/web/src/lib/server/plugins/boards.ts    the `boards` service, per-cwd write serialisation
apps/web/src/routes/api/boards/              GET + PUT, and events/ for the SSE stream
plugins/canvas/src/engine/                   CanvasEngine, ObjectRenderer, resize, ports, SelectTool,
                                             utils/{camera,geometry,easing,ids,textTexture}
plugins/canvas/src/board.svelte.ts           board doc, debounced save, conflict rebase, undo
plugins/canvas/src/board-ops.ts              the pure reducer behind it
plugins/canvas/src/registry.svelte.ts        the `canvas` service
plugins/canvas/src/dispatch.ts               ordered first-claim-wins dispatch
plugins/canvas/src/workstream.ts             board object parsing + SessionView derivation
plugins/canvas/src/theme.ts                  design tokens read out of CSS into Pixi colours
plugins/canvas/src/migrate.ts                localStorage doc → boards
plugins/canvas/src/drawer.ts                 chat drawer width (per window, stays local)
plugins/canvas/src/objects/                  WorkstreamRenderer, EdgeRenderer
```

Deleted: `graph.ts`, `layout.ts`, `persistence.ts`, `NodeCard.svelte` and their tests.
Rewritten: `CanvasPane.svelte`, `ChatOverlay.svelte`, `PromptSheet.svelte`, `state.svelte.ts`,
`model.ts` (down to `Exchange` / `TracedStep`), `digest.ts`.

Dependency added: `pixi.js@8.14.2` in `ui-contracts` (types only), `plugins/canvas`, `apps/web`.

## 13. Open

Ordered roughly by how much each is missed.

1. **`canvas-notes` and `canvas-draw`** (§2, §3). The registry hooks are in place; `canvas-media`
   and `canvas-links` are the worked examples to copy.
2. **Compacted hand-over is a digest, not the harness's.** Dragging a port out onto empty board
   offers `compact` (goal + conclusion, clipped) or `full` (every turn, ~24k char budget), both
   pure functions in `digest.ts`. The Agent SDK exposes its real summary only through the
   `PostCompact` hook (`compact_summary`); `SDKCompactBoundaryMessage` carries metadata alone,
   and there is no `Query.compact()` — triggering it means sending `/compact`, which destroys the
   source session's own context. Deferred until that trade is worth making.
3. **Board pane placement.** A card added for the session the shell opened lands at a fixed
   offset and `freeSlot` only nudges it off anything within 24px. It does not consider the
   viewport, so on a busy board a new card can appear off-screen.
4. **Viewport culling** (§10 step 4). Every object syncs every frame regardless of the camera.
   Fine at current board sizes, not at a hundred cards.
5. **Accessibility** (§9).
6. **`BoardStore` tests** (§8).
7. **Pre-existing, unrelated:** `bun run typecheck` fails on two errors in
   `plugins/trajectory-inspector/src/filter.ts` (exhaustive switches without a final return).
   Untouched by this work, and still failing.
