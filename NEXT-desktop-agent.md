# Next: `plugins/desktop-agent` — Wayland desktop control

A set of contributions that point a harness session at the host desktop rather than at the
repository: capture the screen, draw an overlay above other applications, detect the elements
inside a capture, and route the result into an ordinary nib session on the board that is open.

**Status: every step of §12 is built.** Contracts, protocol codec, pure modules, the Rust sidecar,
the supervisor, the preload bridge, the `desktop` pane, capture into the asset store, the
layer-shell overlay, both detectors and per-application harness routing. Speech to text is
deliberately not in it (§1.6). §10 is the risk list and the known limits, §11 the dependencies,
§13 what only hands-on testing can confirm.

The plugin owns capture, overlay, detection and routing. **It has no agent loop.** Context reaches
a model through `HarnessRegistry` → `HarnessAdapter.createSession` → `HarnessSession.send(text,
attachments)`, which is the pipeline that already exists.

---

## 1. Decisions

1. **No workspace of its own — the desktop tools act on the board that is open.** Captures land as
   `media` objects on the current board, and a session started from one runs in that board's `cwd`.
   There is no desktop board, no synthetic directory and no second root surface. §9.
2. **One sidecar owns every native concern.** Layer-shell overlay, portal capture, compositor IPC,
   AT-SPI and global shortcuts all live in one Rust process. The Electron main process is a
   supervisor, a pipe and an asset upload. Nothing native enters the renderer.
3. **The sidecar is resolved, never bundled.** `$NIB_OVERLAY_EXECUTABLE`, then
   `Bun.which('nib-overlay')` — the stance the repo already takes for the Claude Code CLI
   (`apps/web/src/lib/server/plugins/claude-code/binary.ts`). `electron-builder.yml` is untouched
   and nothing is cross-compiled.
4. **Capture bytes never cross the pipe or the renderer.** The sidecar writes a PNG to a temp path
   and reports the path; the Electron main process reads it and posts it to `POST /api/assets`
   through the `respond` handle it already holds.
5. **Advisory only.** No synthetic input. This host's portal does not even expose
   `org.freedesktop.portal.RemoteDesktop` — §7.
6. **Speech to text is deferred.** No `MediaRecorder`, no whisper subprocess, no transcript board
   object. Prompt text comes from the composer that already exists. §7 keeps the resolved-binary
   design on record for when it is wanted.
7. **The wire codec lives in `apps/desktop`, not in a shared package.** Only the Electron main
   process touches the wire; the renderer talks to it through the preload bridge and never sees a
   line. §4.
8. **Zero new npm dependencies.** Detection is a pure-TS worker, the overlay is the sidecar, the
   codec is hand-written. Rust crates are listed in §11 and need approval.
9. **Every desktop capability is a report, never an assumption.** No compositor is hardcoded; the
   pane mounts and explains itself on GNOME, on X11 and in a plain browser.
10. **Nothing is captured without an explicit act.** Armed sessions, per-capture confirmation,
    preview before send, per-application allowlist. §8.

---

## 2. Target shape

```
packages/ui-contracts/src/desktop-agent.ts   bridge + service types + the capability fold   [step 2/3]
packages/ui-contracts/src/desktop.ts         DesktopBridge extended, existing shape intact  [step 2]
packages/ui-contracts/src/panes.ts           'desktop' added to KnownPaneKind (additive)    [step 2]
apps/desktop/src/main/desktop-agent/         wire codec, supervisor, later portal + upload  [step 2/3]
apps/desktop/src/preload/index.ts            bridge surface, still contextIsolated and sandboxed [step 3]
plugins/desktop-agent/src/                   pane, pure modules; canvas kinds/tools later   [step 2/3]
plugins/desktop-agent/sidecar/               Rust crate: nib-overlay                        [step 3]
```

`packages/ui-contracts/src/desktop-agent.ts` imports **nothing**, deliberately. The Electron main
process consumes it through a `./desktop-agent` subpath export, and the package root pulls in
`pixi.js`, `svelte` and `@nib-ui/protocol` types that a DOM-less main-process tsconfig has no
business resolving. It declares its own `DesktopRect` for the same reason `PaneRect` declares one
(`packages/ui-contracts/src/panes.ts:32`).

---

## 3. Contracts

### `desktop.ts` — the bridge

Additive. `platform`, `version` and `pickDirectory` are untouched;
`plugins/sidebar/src/Sidebar.svelte:24` reads them.

```ts
export interface DesktopBridge {
  platform: string;
  version: string;
  pickDirectory(startIn?: string): Promise<string | null>;
  /** Absent in a build without the desktop-agent main-process module. */
  desktopAgent?: DesktopAgentBridge;
}
```

`desktopBridge()` already answers `null` in a browser, so `desktopBridge()?.desktopAgent` is
`undefined` in a browser _and_ in an Electron build whose main-process module failed to load: one
nullish check, one disabled state, not two.

### `desktop-agent.ts` — what the bridge carries

- `DesktopCapabilities` — `overlay`, `capture`, `focus`, `pointer` strategies, plus `compositor`,
  `sessionType` and a `notes` array rendered verbatim in the pane. Nothing branches on
  `compositor`; it is shown, not tested.
- `ApplicationIdentity` — `appId`, `atspiName`, `desktopEntry`, `title`, `pid`, every one nullable,
  because no Wayland compositor is obliged to answer any of them.
- `CaptureRequest` — a discriminated union over `screen` / `window` / `region`.
- `CaptureResult` — `assetId`, intrinsic `width`/`height`, `takenAt`, and the `ApplicationIdentity`
  captured _at capture time_, not re-queried later when focus has moved on. Plus two fields the
  first draft did not have: `layout`, the desktop-layout box the image covers, which is what lets a
  region found in the picture be pointed at on the screen; and `redacted`, how many password fields
  were blacked out before the file reached the store.
- `accessibleRegions()` takes no `assetId` and answers in **desktop layout coordinates**. The
  sidecar has never heard of the capture, so mapping onto image pixels is the caller's job — it
  holds the capture's `layout` box and its pixel size, and the sidecar holds neither. The first
  draft had it answer in "the capture's pixel space", which the sidecar cannot do.
- `DetectedRegion` — `rect` in capture pixel space, optional `label` and `role`, `source`
  (`'atspi' | 'pixel'`), `confidence`, and `sensitive` where AT-SPI marks a node a password field.
- `OverlaySpec` — the regions and optional pointer ring the sidecar draws.
- `SidecarState` — `stopped` / `starting` / `ready` / `failed`, with a detail line.
- `DesktopAgentBridge` — `capabilities`, `start`, `stop`, `capture`, `focusedApplication`,
  `accessibleRegions`, `showOverlay`, `hideOverlay`, `onPointer`, `onSidecarState`. Every method is
  one `ipcRenderer.invoke` or one `ipcRenderer.on` fan-out. No `require`, no `fs`, no path handling
  in the renderer.
- `DesktopAgentService` — the renderer-side service: `capabilities`, `armed`, `arm`, `disarm`,
  `capture`, `detect`, `sendToHarness`. Added to the `Services` map in `index.ts` beside `canvas`.
  **Not provided yet**: it is mostly capture, and a service whose methods answer nothing is worse
  than one that is not there. It arrives in step 4; the pane reads a module-local state object
  until then, the way `plugins/settings` does.
- `describeCapabilities` and `disabledCapabilities` live here rather than in the plugin. The
  Electron main process is the side that holds `sidecarResolved` _and_ the sidecar's report, so it
  is the side that folds them, and it must not import a Svelte plugin package to do it. This is the
  one place a strategy is chosen, and `ui-contracts` already carries pure modules of this shape
  (`fuzzy.ts`, `display.ts`, `tool-summary.ts`).

### Board objects

Screenshots are `media` objects. `canvas-media` already parses, renders, resizes and
context-provides them, and a board written here opens on a host without this plugin because
`media` is claimed by a plugin that is always loaded. Two kinds are genuinely new:

| kind              | carries                                                                 | drawn as                                                                             |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `desktop-regions` | `captureObjectId`, `imageWidth`, `imageHeight`, `regions`, `detectedAt` | nothing of its own; the plugin's registered layer draws it over the capture it names |
| `desktop-view`    | `outputName`, `x`, `y`, `w`, `h`                                        | a live desktop view; a placeholder card until the ScreenCast path lands (§5)         |

`desktop-regions` holds no bytes and no image — it points at the `media` object by id, so removing
the capture leaves an orphan the layer skips rather than a dangling image reference. Both get a
defensive `parse` in the style of `parseMedia` (`plugins/canvas-media/src/media.ts:78`), and both
survive a load/save round trip on a host where this plugin is not loaded, because `board-ops`
already leaves unknown kinds untouched.

There is no transcript kind: STT is deferred (§1.6), and a free-floating note is `canvas-notes`'
job (NEXT.md §13.1).

---

## 4. D2 — Sidecar protocol

Line-delimited JSON over the sidecar's stdin/stdout, one message per `\n`. stderr is log text,
forwarded to the main-process console and never parsed. A unix socket buys nothing: the supervisor
owns the child, and stdio dies with it, which is the lifetime we want.

**Where it lives.** `apps/desktop/src/main/desktop-agent/protocol.ts`. Only the Electron main
process touches the wire — the renderer talks to main through the preload bridge over
structured-cloned objects. A shared workspace package would have exactly one consumer.

**Parsing is hand-written**, not `zod`. `apps/desktop` has no runtime dependencies today and this
does not add one; the style matches `parseMedia` and `board-store.ts`.

Envelope, versioned per message so a newer host talking to an older sidecar says so rather than
misparsing:

```ts
interface Envelope {
  v: 1;
  id: number;
}
```

`id` correlates a reply to its request; unsolicited events carry `id: 0`. The set:

| direction | type                  | payload                                                             | reply                                                                      |
| --------- | --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| →         | `hello`               | `{ protocol: 1 }`                                                   | `capabilities`                                                             |
| ←         | `capabilities`        | the strategy fields the sidecar can determine                       | —                                                                          |
| →         | `overlay.show`        | `OverlaySpec`                                                       | `ok` \| `err`                                                              |
| →         | `overlay.update`      | `OverlaySpec`, replacing the live spec without a surface round trip | `ok` \| `err`                                                              |
| →         | `overlay.hide`        | `{}`                                                                | `ok`                                                                       |
| →         | `pointer.subscribe`   | `{ hz }`, capped at 30                                              | `ok` \| `err`, then `pointer` events                                       |
| →         | `pointer.unsubscribe` | `{}`                                                                | `ok`                                                                       |
| ←         | `pointer`             | `{ x, y, output }` in layout coordinates                            | —                                                                          |
| →         | `capture`             | `CaptureRequest`                                                    | `ok` with `{ path, width, height, output, takenAt, application }` \| `err` |
| →         | `focus.query`         | `{}`                                                                | `ok` with `ApplicationIdentity` \| `err`                                   |
| →         | `focus.subscribe`     | `{}`                                                                | `ok`, then `focus` events                                                  |
| ←         | `focus`               | `ApplicationIdentity`                                               | —                                                                          |
| →         | `accessibility.tree`  | `{ appId?, maxNodes }`                                              | `ok` with `DetectedRegion[]` \| `err`                                      |
| →         | `shortcuts.bind`      | `{ shortcuts: { id, trigger, description }[] }`                     | `ok` \| `err`, then `shortcut` events                                      |
| ←         | `shortcut`            | `{ id }`                                                            | —                                                                          |
| →         | `shutdown`            | `{}`                                                                | the process exits                                                          |
| ←         | `ok` / `err`          | `{ payload }` / `{ code, message, retryable }`                      | —                                                                          |
| ←         | `log`                 | `{ level, message }`                                                | —                                                                          |

`err.code` is a closed set — `unsupported`, `denied`, `timeout`, `not-found`, `internal` — so the
host branches on the code and shows the message. A portal `denied` is a first-class answer, not an
exception.

**Codec surface**, all pure, nothing spawned, nothing read from disk:

- `encode(message)` — JSON plus `\n`. The first draft had it refuse an embedded newline;
  `JSON.stringify` escapes every control character, so that guard was unreachable and is gone.
- `decode(line)` — a typed message, or `{ type: 'malformed', reason }`. Never throws.
- `class FrameReader { push(chunk): DecodedMessage[] }` — buffers partial lines, and drops a line
  over `MAX_LINE_BYTES` (1 MiB) with a `malformed` report rather than growing without bound. The
  supervisor decodes bytes with a streaming `TextDecoder` before pushing, so a chunk boundary
  inside a multi-byte sequence is not the codec's problem.

**Supervisor**: resolves the executable, spawns with piped stdio, sends `hello`, waits for
`capabilities` with a 3 s timeout, keeps a reply table, restarts at most 3 times with backoff, and
reports every state change through `onSidecarState`. Disposal sends `SIGTERM` then `SIGKILL` after
2 s — constraint 4 requires that toggling the plugin off ends the process, and a sidecar holding a
layer surface that outlives the app is the worst failure mode this feature has.

The restart budget is refilled only once a sidecar has stayed up for 30 s, not on a successful
handshake: a process that answers `hello` and then dies is exactly the shape of a crash loop, and
refilling on the handshake would let it restart without end. The child process is injected rather
than spawned inside the supervisor, so the handshake, the reply table, the budget and the kill
escalation are all covered by `bun test` without a binary.

---

## 5. D1 and D3 — Sidecar and capture

### D1. Language and toolkit

**Rust + `smithay-client-toolkit`**, one binary named `nib-overlay`, drawing into `wl_shm` buffers
with `tiny-skia`.

Not GTK4 + `gtk4-layer-shell`: the overlay needs an empty `wl_region` as its input region,
`keyboard_interactivity: none` and an exclusive zone of `-1`. Those are three calls on
`zwlr_layer_surface_v1` and a fight with GTK, which wants to own input handling and does not expose
an empty input region cleanly. GTK4 would also drag the whole toolkit into a process whose entire
job is rounded rectangles and a pointer ring.

Software rasterisation is enough because the overlay is **not one fullscreen surface**: it is one
small layer surface per highlighted region plus one for the pointer follower, each sized to its
content and placed by anchor and margin. A fullscreen shm surface at 4K is a 33 MB memcpy per
frame; a 200×60 highlight is 48 KB. An overlay of zero regions allocates nothing.

**Build and ship.** The crate lives at `plugins/desktop-agent/sidecar/` and is **not** built by
`bun run build`, `bun run dev` or `electron-builder`:

```yaml
build:overlay:
  desc: Build the Wayland overlay sidecar (requires a Rust toolchain and wayland-client)
  dir: plugins/desktop-agent/sidecar
  cmd: cargo build --release
```

The README gains a line telling the user to `cargo install --path plugins/desktop-agent/sidecar`
or to point `$NIB_OVERLAY_EXECUTABLE` at the built binary.

**Packaging consequences, plainly.** `electron-builder.yml` gains nothing. There is no
cross-compilation, because nothing is cross-compiled: the binary is built on the machine that runs
it, exactly as the Claude Code CLI is installed on the machine that runs it. An AppImage on a
machine with no sidecar reports `overlay: 'unavailable'` with the reason and everything else keeps
working. The cost is that the overlay is not turnkey for a non-developer.

**Overlay strategies**, behind one interface:

- `layer-shell` — the sidecar. Selected when the binary resolves _and_ the compositor advertises
  `zwlr_layer_shell_v1`. A GNOME session has no layer-shell, so it falls through here rather than
  failing at surface creation.
- `always-on-top-window` — an Electron `BrowserWindow` with `transparent: true`, `frame: false`,
  `setAlwaysOnTop(true, 'screen-saver')` and `setIgnoreMouseEvents({ forward: true })`, under X11
  only. On native Wayland `xdg-shell` gives no positioning and the compositor puts the window where
  it likes, so selecting it there would be a lie. **Not built**: the strategy stays in the union
  because it is the right shape for X11, and until something implements it an X11 session is
  reported `unavailable` with that as the reason — a named strategy that draws nothing is worse
  than an honest gap.
- `unavailable` — the pane names which precondition failed, and highlights are drawn on the board
  image instead of on the desktop. Everything else still works.

### D3. Capture path

**The portal, called from the sidecar.** `org.freedesktop.portal.Screenshot.Screenshot()` through
`ashpd`. The portal writes a PNG and returns a `file://` URI; the sidecar reports the path. Bytes
go portal → disk → Electron main → `POST /api/assets` → asset store. The renderer sees an
`assetId`, never a byte.

The upload uses the `respond` handle the main process already imports from
`apps/web/build/entry.js` (`apps/desktop/src/main/index.ts:41`) in production, and a plain `fetch`
against `NIB_APP_URL` in development. One code path, different base — no new route, no renderer
round trip, and no assumption about whether `net.fetch` reaches a custom protocol handler from the
main process.

| mode                          | path                                                                                   | degrades to                        |
| ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| full screen, no output named  | portal `Screenshot`                                                                    | `err denied` when the user refuses |
| full screen, one output named | `grim -o <name>`                                                                       | `err not-found` without `grim`     |
| region                        | `grim -g "<geom>"`                                                                     | `err not-found` without `grim`     |
| window                        | compositor IPC for geometry (`hyprctl activewindow`, sway's `GET_TREE`) then `grim -g` | `err unsupported` with no IPC      |

`ashpd` is **not** used. The portal's request pattern is one method call and one signal, and
writing it out over the `zbus` connection already open for the capability probe avoids pulling an
async runtime into a process whose other needs are a blocking socket read and a Wayland queue. The
`Request` signal is subscribed to _before_ the call, on the object path the portal derives from our
unique name and handle token — subscribing after would race a portal that answers immediately,
which one with a stored permission does.

**The layout box, and refusing to guess it.** Every capture reports the desktop-layout rectangle it
covers, so a region found in the picture can be drawn on the screen. It is checked before it is
reported: if the image's pixel aspect does not match the layout box's, the capture is not of that
box and `layout` is `null` rather than a mapping that would put every highlight in the wrong place.
Without it the overlay is not offered for that capture, and the pane says so.

**Region capture has no picker.** The protocol takes a rectangle and the sidecar honours it, but
nothing in the UI can draw one on the desktop yet — that needs `slurp` or a layer-shell selection
surface. The pane offers whole screen and focused window. Cropping on the board is still the
intended answer and is not built.

**Restore tokens.** `Screenshot` has none — the portal's permission store decides whether the user
is asked again and we cannot influence it. `ScreenCast` does: `SelectSources` takes
`persist_mode: 2` and `Start` returns `restore_token`, which is written to
`$XDG_DATA_HOME/nib-ui/desktop/screencast-token` at mode `0600` and passed back on the next
`SelectSources`. A token the portal rejects is deleted and the flow falls back to a fresh prompt.
Refusal at any point is `err { code: 'denied' }`, rendered as "the desktop refused the capture"
with a retry — never a thrown exception and never a silent empty object on the board.

**Live view** (`desktop-view`) needs a PipeWire consumer. Node has none without a native module and
Chromium has one built in, so the live path is `desktopCapturer` + `getUserMedia` in the renderer,
textured into the Pixi object. That is the one capability where bytes reach the renderer, it is
deferred to §12 step 5, and `desktop-view` ships as a placeholder card until then.

---

## 6. D4 and pointer tracking

### Pointer position

No global cursor API exists on Wayland. Three real sources:

| source                                         | latency                    | permission                             | availability                                                                             |
| ---------------------------------------------- | -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| compositor IPC — Hyprland socket, sway IPC     | socket round trip, ~0.2 ms | none                                   | wlroots-adjacent compositors                                                             |
| the overlay's own `wl_pointer`                 | frame-accurate             | none                                   | **only while the overlay holds pointer focus**, which a click-through surface never does |
| `org.freedesktop.portal.RemoteDesktop` / libei | frame-accurate             | a consent dialog for _input injection_ | not implemented by this host's portal (§7)                                               |

**Chosen: compositor IPC, polled by the sidecar, capped at 30 Hz**, over a socket the sidecar holds
open rather than a `hyprctl` process per sample. `pointer.subscribe` answers
`err { code: 'unsupported' }` on a compositor without it, and `capabilities.pointer` reports
`'unavailable'`. The pointer-following overlay is then not offered; region highlighting still is,
because it needs no cursor.

The `wl_pointer` route is rejected on its own terms: a surface with an empty input region receives
no pointer events by construction, and one that receives them is one the user cannot click through.

### D4. Detection

Two detectors behind one interface, composed rather than chosen:

```ts
export interface RegionDetector {
  readonly id: string;
  detect(input: DetectorInput): Promise<DetectedRegion[]>;
}
```

- **`AtspiDetector`** — the sidecar walks the focused application's accessibility tree over D-Bus,
  keeps nodes with a screen extent and an interactive role (`push button`, `entry`, `check box`,
  `menu item`, `link`, `combo box`, …), and returns the accessible name as `label`. Authoritative,
  works on X11 too, and gives nothing at all for an application that exposes no tree.

  The `atspi` crate is **not** used. What is needed is four methods and two properties —
  `GetChildren`, `GetRoleName`, `GetState`, `Component.GetExtents`, and the `Name` property — over
  a second `zbus` connection to the address `org.a11y.Bus` reports. The crate's value is its typed
  event machinery, which is for a client that subscribes rather than one that walks once.

  The walk is breadth-first from the window AT-SPI marks `ACTIVE`, two levels down from the
  registry root, with a node budget. Depth-first from the root would spend seconds in one
  application's tree before reaching the one in front.

- **`PixelDetector`** — pure TypeScript in a `Worker`: greyscale → Sobel → adaptive threshold →
  morphological close → connected components → bounding boxes → merge → filter by area and aspect.
  Every stage a pure function over a `Uint8ClampedArray`, every stage testable against a synthetic
  bitmap. It finds high-contrast rectangles, which is what buttons, fields and panels are.

Merged: an AT-SPI region wins over any pixel region it overlaps by more than half that region's
area, because a named region beats an unnamed one. `mergeRegions` is pure and tested.

Not `@techstark/opencv-js` (~9 MB of WASM for a page of array code) and not ONNX with a UI-element
model (a weights download and a licence to audit, for a capability AT-SPI already does better where
it exists). The `RegionDetector` interface exists so either can be added later as a third detector
without touching a caller — that is the swap this design pays for, not a promise to make it.

**Hit resolution.** A `media` object stores display `w`/`h`; `desktop-regions` stores the capture's
intrinsic `imageWidth`/`imageHeight`. A pointer at world `(wx, wy)` over a capture at `(x, y, w, h)`
maps to `((wx - x) / w * imageWidth, (wy - y) / h * imageHeight)`. `regionAt` then returns the
**smallest** containing rect, so a button inside a panel wins over the panel. Both are pure, live
in `plugins/desktop-agent/src/regions.ts`, and are tested for: outside the image, exactly on an
edge, nested rects, zero-area rects, a non-uniform scale after a resize, and an empty list.

---

## 7. D5 and D6 — Speech, and the actuation boundary

### D5. Speech to text — deferred

Not built in this phase, by decision. The design, on record for when it is wanted:

`whisper.cpp` as a **resolved** subprocess — `$NIB_WHISPER_EXECUTABLE`, then
`Bun.which('whisper-cli' | 'whisper-cpp' | 'main')` — never vendored and never downloaded, the same
stance the repo takes for the Claude CLI. Model from `$NIB_WHISPER_MODEL`, else the newest `*.bin`
under `$XDG_DATA_HOME/nib-ui/models/whisper/`. Batch, not streaming: push-to-talk is the
segmentation, and a VAD that clips the end of a sentence is worse than a button. Recording via
`MediaRecorder` in the renderer, one `webm/opus` blob to a server route, a temp file deleted in a
`finally`. Microphone permission would need an explicit `setPermissionRequestHandler` in the main
process, which Electron currently does not install.

One correction to the brief, since it matters if this is revived: **whisper.cpp reads GGML `.bin`
models**. GGUF is llama.cpp's container, and a GGUF _audio_ model means llama.cpp's multimodal path
— heavier, less stable, and worse at transcription.

### D6. Actuation boundary — SECURITY GATE

**Advisory only. No synthetic input is implemented in this phase.**

Advisory means the overlay draws where to click and the harness explains what to do; the user acts.
The overlay is a picture with no input region — it cannot receive a click, let alone send one.

This is not only the cautious choice, it is the available one. Probing this host's portal:

```
org.freedesktop.portal.InputCapture
org.freedesktop.portal.ScreenCast
org.freedesktop.portal.Screenshot
```

— and no `org.freedesktop.portal.RemoteDesktop`. `xdg-desktop-portal-hyprland` does not implement
it, so on the machine this is being built for, injection has no supported path at all. `libei` and
`libeis` are installed, but a libei session still comes from the RemoteDesktop portal; reaching an
EIS socket directly means a compositor-specific side channel, which is exactly the hardcoding
constraint 7 forbids.

If actuation is ever approved, it needs all of the following, none optional:

1. **Per-application opt-in**, stored in the routing config (§8), defaulting to off, never
   inherited from a wildcard rule.
2. **A visible armed indicator** on a surface the agent cannot draw over — the app's own chrome and
   a distinct overlay border, not a toast.
3. **A kill switch** that is always live: a global shortcut through
   `org.freedesktop.portal.GlobalShortcuts` _and_ a click target in the pane, both of which drop
   the RemoteDesktop session rather than set a flag.
4. **An audit log** of every injected event — timestamp, type, coordinates, target application, and
   the session and message that asked for it — appended to
   `$XDG_DATA_HOME/nib-ui/desktop/actuation.jsonl` and never truncated by the app.
5. **A focus interlock**: no injection while AT-SPI reports the focused node as a password field
   (role `password text`, or the `SENSITIVE` state), while a lock surface is up, or while AT-SPI
   cannot answer at all. Unknown focus is unsafe focus.
6. **A rate limit with a bounded burst**, so a runaway loop is a nuisance rather than a shredder.

**Global shortcuts.** `Electron.globalShortcut` is a documented no-op on native Wayland.
`shortcuts.bind` goes through `org.freedesktop.portal.GlobalShortcuts` in the sidecar, which this
host does expose; where the portal lacks it, the capability report says so and the user binds a
compositor keybind that pokes the app. Nothing is registered by default.

---

## 8. D7 and D8 — Privacy, and per-application routing

### D7. Privacy model

A desktop screenshot is the user's whole screen leaving the machine.

1. **Armed sessions plus per-capture confirmation.** The tools start disarmed. `arm(minutes)` opens
   a window during which captures skip the per-capture dialog; it expires on its own, on window
   blur, and on plugin disposal. While disarmed, every capture confirms, naming the mode and the
   target. The armed state is renderer memory only and is never persisted — an armed state that
   survives a restart is a trap.
2. **Preview before send.** A capture lands on the board and stops. Nothing reaches a harness until
   the user runs "Send to harness", which opens a sheet showing the exact image, the exact region
   list and the exact prompt text. That sheet is the last point of refusal and is not skippable.
3. **Per-application allowlist.** A `deny` rule blocks capture while that application has focus,
   evaluated _before_ the capture request. An application with no rule is unknown, and unknown is
   `ask`.
4. **Redaction.** Where AT-SPI gives a node the role `password text`, its extent is filled with a
   flat block in the sidecar, on the bytes, before the path is reported — so the redacted version
   is the only version that ever exists on disk. The capture reports how many it filled, and the
   pane says so. Where AT-SPI says nothing, nothing is redacted and the preview is the user's
   protection.

   **A correction to the brief, and it matters here.** The brief asked for AT-SPI's `SENSITIVE`
   state as a second signal. In AT-SPI `SENSITIVE` means the widget is _enabled_ — it is the
   opposite of greyed out, not a marker for secret content. Treating it as "holds a secret" would
   redact almost every control on the screen and teach the user that the black blocks mean nothing.
   The role is the whole test.

5. **On disk versus in memory.**

   | held                         | where                                                    | lifetime                                                                   |
   | ---------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
   | capture PNG                  | `$XDG_DATA_HOME/nib-ui/assets/`, the existing store      | until the board object is removed; assets are content-addressed and shared |
   | portal temp PNG              | `$XDG_RUNTIME_DIR`                                       | deleted by the main process immediately after upload                       |
   | screencast restore token     | `$XDG_DATA_HOME/nib-ui/desktop/screencast-token`, `0600` | until the portal rejects it                                                |
   | accessibility tree           | main-process memory                                      | one request                                                                |
   | armed state, pointer samples | renderer memory                                          | never written                                                              |

   Nothing goes in `localStorage`. Nothing goes in `BoardDoc` but ids, geometry and text.

### D8. Per-application routing

`$XDG_CONFIG_HOME/nib/desktop-agent.json`, beside the `config.json` that
`apps/web/src/lib/server/user-config.ts:16` already writes, read and written with the same
merge-and-keep-unknown-keys discipline so an older build never eats a newer build's fields.

```jsonc
{
  "version": 1,
  "default": { "policy": "ask", "harnessId": null },
  "applications": [
    {
      "match": { "appId": "blender", "atspiName": "Blender", "desktopEntry": "blender.desktop" },
      "policy": "allow",
      "harnessId": "claude-code",
      "model": "claude-opus-5",
      "promptPrefix": "You are helping inside Blender. …",
      "options": { "mcpServers": { "blender": { "command": "blender-mcp" } } },
      "skill": "blender-modelling",
    },
    { "match": { "appId": "org.keepassxc.KeePassXC" }, "policy": "deny" },
  ],
}
```

**Precedence**, most specific first, first match wins, ties broken by array order:

1. `desktopEntry` exact
2. `appId` exact
3. `appId` prefix (`org.mozilla.` matches `org.mozilla.firefox`)
4. `atspiName` exact, case-insensitive
5. `atspiName` substring, case-insensitive
6. a `"*"` wildcard entry
7. `default`

`policy: 'deny'` short-circuits at any level and no later rule overrides it. An **unknown
application** gets `default`, shipping as `policy: 'ask'` with `harnessId: null`, so capture is
confirmed and the harness falls back to the resolution a board already uses — what this board runs,
then what the directory ran, then the first registered harness
(`plugins/canvas/src/state.svelte.ts:688`). An unknown application never silently picks a model or
an MCP server.

`resolveRouting(identity, config)` is pure, lives in `plugins/desktop-agent/src/routing.ts`, and is
tested for every precedence level, a deny outranking a more specific allow, an empty config, a
malformed entry, and an identity with no `appId` at all.

**How it reaches the model with no new plumbing.** `CreateSessionInput.options` passes through
`POST /api/sessions` → `SessionHost.create` → `HarnessAdapter.createSession(opts)`, and the Claude
Code adapter spreads it straight into the SDK — `...(opts.options as Options)` at
`apps/web/src/lib/server/plugins/claude-code/adapter.ts:89`. So `mcpServers`, `agents`,
`systemPrompt` and `allowedTools` already reach the model. `options` is therefore adapter-specific
by design and documented as such; `promptPrefix` is the portable half, composed into the prompt
client-side so a rule still means something on an adapter that ignores `options` entirely.

**Editing.** A `settings.section` slot entry, the way `plugins/settings` registers
`GeneralSettings`: the rule list, add/remove/reorder, and the resolved rule for the focused
application shown live.

**Sending.** `sendToHarness(objectId, text)`:

1. Read the `ApplicationIdentity` stored on the capture at capture time — focus has moved on since.
2. `resolveRouting`; a `deny` stops here with a message.
3. Find a workstream on the **current board** already bound to this application, or create one and
   link the capture to it with a `context` edge — which is what `canvasState.assetCard` does for a
   picture today.
4. `sessions.create({ harnessId, cwd: <the open board's cwd>, options: { ...launchOptions,
...rule.options } })`, then `sessions.sendTo(sessionId, prompt, attachments)`.
5. The prompt is `promptPrefix` + the user's text + a rendered region list (`label — x,y,w,h`), and
   the attachment is the capture's `MessageAttachment`, resolved to a `SessionAttachment` with a
   real `path` by the machinery that already exists, so a non-multimodal adapter gets a file.

No second event channel, no second reducer, no second session store. Responses arrive on the
existing SSE stream and fold through `reduceSession` like every other turn.

---

## 9. D9 — Hosting

**The question, restated:** the board is a pane (`PaneKind: 'canvas'`) but not an ordinary one.
`rootPaneId = 'canvas'` (`apps/web/src/lib/client/registries/panes.svelte.ts:24`) is rendered
directly by the shell (`PaneHost.svelte:33`), and `open`, `openInstance`, `close` and
`restoreLayout` all special-case it. There is exactly one root and it is the canvas.

**Chosen: there is no second surface and no board of its own. The desktop tools act on the board
that is open.** A capture lands as a `media` object on the current board at the current camera; a
session started from one runs in that board's `cwd`. The plugin contributes:

- a `desktop` pane (`kind: 'desktop'`) for the chrome that is not board content — the capability
  report, arm/disarm, the capture buttons, the focused-application readout, the routing editor —
  which floats over the board like every other pane;
- canvas kinds, a region-select tool, a detection layer, context-menu entries and a context
  provider, all into the `canvas` registry that is already there.

What this buys: nothing to share, because nothing is duplicated. Selection, camera, objects, undo,
persistence, the board SSE stream and the pane layout are the board's, and the desktop tools are
just another set of contributions to it — the same relationship `canvas-media` and `canvas-3d`
already have.

**Rejected: `panes.setRoot(paneId)`** — a `PaneRegistry` contract change touching four methods and
`restoreLayout`, buying a surface with no camera, object model, persistence, undo or SSE, every one
of which would then be reimplemented inside this plugin. That is a canvas engine rewrite wearing a
different pane id.

**Rejected: a dedicated desktop board** at a synthetic directory — it would show up in the project
list as a fake project, would need a real directory minted for a harness `cwd`, and would make the
camera jump when switching boards. Acting on the open board avoids all three.

**Consequence to accept:** with no project open, `CanvasRegistry.cwd` is empty, there is no board
to place a capture on and no `cwd` to start a session in (`spawn` already refuses an empty one).
Capture is therefore **disabled while no board is open**, and the pane says so. It is not an error
path; it is the same "open a project first" state the rest of the app has.

---

## 10. Risks and gotchas

- **The sidecar outliving the app** is the worst failure here: a layer surface stuck above every
  window with no process to ask it to leave. Mitigations: `SIGTERM` then `SIGKILL` on dispose, the
  sidecar exits when stdin closes, and it installs `SIGHUP`/`SIGTERM` handlers that destroy the
  surface before exiting.
- **Electron cannot make a Wayland overlay**, and no `BrowserWindow` option changes that. A future
  patch that "simplifies" the sidecar into a transparent window is wrong on native Wayland and gets
  rejected with this line.
- **`desktopCapturer` on Wayland goes through the portal**, so live view inherits the portal's
  picker and permission lifetime, neither of which we control. That is why it is a separate, later
  step rather than part of the capture story.
- **AT-SPI is opt-in for the _target_ application.** GTK and Qt apps generally expose it; Electron
  apps need `--force-renderer-accessibility`; games and Blender expose nothing useful. The pixel
  detector is not a last resort, it is the common case for the applications this is most
  interesting for.
- **A screenshot is the entire screen.** Every guard in §8 exists because the failure mode is not a
  crash, it is the user's password manager in a provider's request log. The preview step is the one
  that must never be optimised away for convenience.
- **Region coordinates have three spaces** — desktop layout pixels, capture image pixels, board
  world units — and a bug in any conversion looks like a detection failure. All three are pure
  functions with tests, and nothing converts inline.
- **`ChildProcess`'s event methods do not typecheck in `apps/desktop`.** `@types/node` 26 gives
  them through an interface merge (`interface ChildProcess extends InternalEventEmitter<…>`) that
  does not resolve under that package's tsconfig, and `skipLibCheck` turns the failure into missing
  members instead of an error. `child.ts` declares the two events it uses and addresses the emitter
  through that. Pinning `@types/node` would be the real fix and is a dependency change.
- **The overlay draws no text.** A label would need a font rasteriser and a font stack in the
  sidecar. `OverlayRegion.label` travels over the protocol and is ignored; the label is rendered in
  the pane and in the prompt instead.
- **The pointer ring is anchored to one output.** A layer surface belongs to the output it was
  created on, so a cursor that crosses to another monitor drags the ring against that monitor's
  edge rather than following. Rebuilding the surface on the new output is the fix and is not done.
- **A failed overlay thread used to report success.** Sending into a `mpsc` channel whose receiver
  has not been dropped yet succeeds even when the thread behind it is already dying, so a
  compositor without layer-shell was answered as a working overlay. The thread now hands its
  startup result back before the first command is applied. Any future thread started this way needs
  the same handshake.
- **`plugins/canvas/src/state.svelte.ts` contains a NUL byte** (`rg` reports it binary, around
  offset 3946). Unrelated and user-owned, but it defeats `grep` on that file.
- **`bun run typecheck` already fails** on two errors in `plugins/trajectory-inspector/src/filter.ts`
  (NEXT.md §13.7). Pre-existing and unrelated; this work must not add to it and cannot fix it.
- **Vite serves stale transforms of workspace plugin sources** (NEXT.md §9). A new plugin package
  will hit this; restart the dev server rather than debug the code.

---

## 11. Dependencies needing approval

**npm: none.** That is the point of the pure-TS detector, the hand-written codec and the sidecar.

**Rust crates, sidecar only, never installed by `bun install`:**

| crate                    | why                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `serde_json`             | the wire protocol's other end; messages are built and read as `Value`, so no `serde` derive |
| `wayland-client`         | registry enumeration, and the protocol binding the overlay is built on                      |
| `smithay-client-toolkit` | `wlr-layer-shell` surfaces, output geometry and shm pools; the reason the sidecar exists    |
| `tiny-skia`              | software rasteriser for the highlight and pointer surfaces; no GPU context needed           |
| `png`                    | decode and re-encode a capture, to black out a password field before it reaches disk        |
| `zbus`                   | the desktop portal and the accessibility bus, both spoken directly                          |

Two crates the first draft proposed are **not** used. `ashpd` would wrap a portal request pattern
that is one call and one signal, at the cost of an async runtime. `atspi` would wrap four D-Bus
methods with typed event machinery aimed at a subscriber rather than a one-off walk. Both reasons
are recorded in the module comments so neither is re-added without an argument.

**System binaries, resolved at runtime and never vendored:** `grim` (region and window fast path),
`hyprctl` / `swaymsg` (window geometry, pointer position). Each is optional and its absence is a
capability report, not an error.

**Toolchain:** a Rust toolchain, on the developer's machine only.

**Not proposed, and why:** `@techstark/opencv-js`, ONNX Runtime plus a UI-element model, any Node
D-Bus binding (the sidecar already speaks D-Bus), any PipeWire native module (Chromium has the
consumer), `zod` in `apps/desktop` (hand-written parsers instead).

---

## 12. Order of work

Each step ends with `bun test` and the dev server both running, and with the plugin toggleable off
leaving nothing behind.

1. ~~Design document.~~ **Done.**
2. **Contracts + protocol codec + pure modules + tests.** `desktop-agent.ts`, the `DesktopBridge`
   addition, the wire codec, `regions.ts`, `routing.ts`, the board object `parse` functions,
   `capabilities.ts`, prompt composition. All pure, all tested, nothing spawned. **Stop.**
3. ~~**Sidecar + supervisor + capability detection.**~~ **Done.** The Rust crate answering `hello`
   with `capabilities` and everything else with `unsupported`, the supervisor, the preload bridge,
   and the pane rendering the report and its disabled states.
4. ~~**Capture → asset → board.**~~ **Done.** Portal `Screenshot` and `grim`, upload in the main
   process, a `media` object on the open board, and the arm / confirm / preview flow.
5. ~~**Overlay + pointer tracking.**~~ **Done**, with two limits in §10: no text on the overlay, and
   a pointer ring anchored to one output. The always-on-top X11 fallback is **not** built, and
   `describeCapabilities` reports `unavailable` with that as the reason rather than naming a
   strategy nothing implements. Live `desktop-view` is not built and stays a placeholder kind.
6. ~~**Detection.**~~ **Done.** The pixel detector in a worker, the accessibility walk in the
   sidecar, the merge, the `desktop-regions` object and the layer that draws it over its capture.
   Click-to-region on a board capture is not wired: `regionAt` and `imagePointAt` exist and are
   tested, and no tool calls them yet.
7. ~~**Harness routing + per-application config.**~~ **Done.** `desktop-agent.json` behind
   `/api/desktop-agent/config`, the settings section, `sendToHarness`, the context provider and the
   context-menu entries.

Speech to text is not in this list (§1.6). Three things named above are deliberately left undone
and are not hidden behind a working-looking control: the X11 window fallback, the live view, and
click-to-region.

---

## 13. Tests, and what tests cannot cover

**`bun test`, pure modules only:**

- protocol codec: round-trip for every message type, unknown `type`, wrong `v`, missing or
  non-numeric `id`, truncated JSON, a line arriving in three chunks, two messages in one chunk, an
  over-length line, an event interleaved between a request and its reply, an embedded newline
  refused on encode.
- region geometry: world→image mapping including a non-uniformly resized object, `regionAt` picking
  the smallest containing rect, points outside and exactly on an edge, zero-area rects, an empty
  list, `mergeRegions` preferring AT-SPI over an overlapping pixel region.
- routing precedence: every level in §8, deny outranking a more specific allow, the wildcard, an
  empty config, a malformed entry, an identity with no `appId`, and unknown keys kept on write.
- board object `parse` round-trips for `desktop-regions` and `desktop-view`, including a board
  holding both loaded and saved by a host where the plugin is **not** loaded.
- capability detection against a fake environment: each degradation combination reports the right
  strategy and the right note, and a browser (`desktopBridge() === null`) yields the fully-disabled
  report without throwing.
- sidecar resolution: the override winning, an override that does not resolve being reported rather
  than falling through to `$PATH`, the `$PATH` scan, and an empty `$PATH`.
- the supervisor against an injected process: the handshake, a handshake nobody answers, out-of-order
  replies, a timeout, an `err` arriving as a value, events and logs not being mistaken for replies,
  the restart budget, the budget refilling only after a stable run, and `stop` escalating to
  `SIGKILL`.
- pixel detector stages against synthetic bitmaps: greyscale weighting, Sobel finding a boundary
  and not an interior, `close` joining a one-pixel gap and leaving a wide one, four-connected
  components, a component too large for a recursive fill, and the whole pipeline locating a control
  drawn on a flat panel, dropping a speck, dropping the window itself and honouring its limit.
- layout↔image mapping: a scaled output, a second monitor's origin, the two directions being
  inverses, a non-uniform capture, and refusing to divide by a zero-sized box.
- the capture upload: the bytes posted as a png, and the temp file removed whether the store
  accepted it, refused it or the request threw.
- the config file: a missing, corrupt, array and scalar document all reading as empty, unknown keys
  surviving a write, and the rule list being replaced rather than concatenated.
- prompt composition: prefix + text + region list + attachment metadata, with no text, no regions,
  and a label containing newlines.

**Not unit-testable here, and not faked:** sidecar spawn, layer-surface creation, portal grants and
refusals, restore-token persistence, PipeWire live view, compositor IPC, AT-SPI tree walking, and
every visual result. There will be no mock that pretends otherwise and no test asserting a green
result for a path that never ran.

**What the user must verify by hand** (`CLAUDE.md` §Tests — no browser driving, no headless
harness; the app is run by the user):

1. `bun run dev:web` in a plain browser: the pane mounts, every control is disabled, the reason is
   "Desktop control needs the desktop app". Nothing throws.
2. `bun run dev` with no sidecar installed: the pane mounts and reports every capability
   `unavailable`, naming the missing binary.
3. `task build:overlay` then `bun run dev`: the pane reports `overlay: layer-shell` and the
   compositor name.
4. A capture while disarmed asks in the pane; while armed it does not; the armed state expires on
   its own and when the app loses focus.
5. The portal dialog appearing and being **refused** leaves a message, not an empty board object.
6. The overlay draws above a fullscreen application and is click-through — clicks reach the
   application underneath. **This is the least verified part of the feature**: the surfaces, their
   placement and their input regions have never been drawn, only compiled.
7. Toggling the plugin off in the palette removes the pane, the layer, the settings section and the
   commands, **and the `nib-overlay` process is gone** (`pgrep nib-overlay` returns nothing).
8. A capture sent to a harness arrives as an image the model can see, and the file exists at the
   path the attachment resolves to.
9. With no project open, capture is disabled and says why.
10. "Find elements" over a GTK or Qt window returns named regions; over a game or Blender it returns
    only pixel regions, and the pane says nothing was named.
11. A capture taken with a password manager in front comes back with the field blacked out and the
    pane saying how many were filled.
12. A `deny` rule on the focused application blocks the capture **before** the shutter, not after.

`bun run typecheck` must pass across the workspace, except for the two pre-existing
`plugins/trajectory-inspector/src/filter.ts` errors recorded in NEXT.md §13.7.

---

## 14. Open questions

None. The four from the first draft are settled: the desktop tools act on the open board (§9),
STT is deferred (§7), the sidecar is resolved from `$PATH` and never bundled (§5), and the codec
lives in `apps/desktop` because it has exactly one consumer (§4).
