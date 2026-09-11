# Task: `plugins/desktop-agent` — Wayland desktop control workspace

## Role

You are implementing a new **core plugin** in `nib-ui`. Read `README.md`, `NEXT.md`,
and `CLAUDE.md` before writing anything. This is a large, multi-process feature —
you will produce a design document first and stop for approval before implementation.

## Goal

A second top-level workspace surface, peer to the canvas board, that lets a harness
session observe and assist with the _host desktop_ rather than a repo:

- Capture screenshots (full screen, single window, region) and land them on the canvas
  as first-class board objects.
- Render a **Wayland layer-shell overlay** on the desktop that can track the pointer,
  highlight regions, and draw annotations above other applications.
- Detect UI elements inside a captured image (buttons, fields, icons) so a click on
  the image resolves to a labelled region.
- Transcribe speech locally with a GGUF/GGML model so the user can talk to the workspace.
- Route the resulting context (screenshot + detected regions + transcript + focused
  application identity) into an existing nib harness session, so **any** registered
  adapter and model can decide what to do — including invoking an MCP server or skill
  configured for that specific application (Blender, FreeCAD, a browser, …).

The plugin owns capture, overlay, detection, transcription and routing.
**It does not implement an agent loop** — the harness is the agent.

## Non-negotiable constraints

1. **The harness is reused, not reimplemented.** Context reaches a model through the
   existing session pipeline: `HarnessRegistry` → `HarnessAdapter.createSession` →
   `HarnessSession.send(text, attachments)`. Screenshots travel as
   `SessionAttachment` (`MessageAttachment` + resolved `path`), which is exactly why
   that field exists: a non-multimodal adapter still gets a file on disk.
2. **Board objects stay opaque.** `CanvasObject` is `{ kind, id, [key: string]: unknown }`.
   Typing happens in `CanvasObjectKind.parse`. A board written by this plugin must
   round-trip through a host that does not have the plugin loaded.
3. **Reuse `canvas-media` for images.** A screenshot on the board is a `media` object
   backed by an asset id, uploaded via `POST /api/assets`. Do not invent a parallel
   image kind and do not put bytes in `BoardDoc`.
4. **Everything registers through `ctx.effect(() => disposer)`.** Toggling the plugin
   off in the command palette must remove every pane, kind, tool, layer, command and
   listener, kill the sidecar process, and tear down the overlay surface.
5. **Plugin packages never import from `apps/web`.** Contracts go in
   `packages/ui-contracts`, added to the `Services` map by module augmentation, same
   as `canvas` and `panes`.
6. **The web build must not break.** `bun run dev:web` runs in a plain browser where
   `desktopBridge()` returns `null`. Every desktop capability must degrade to a
   disabled, explained state rather than throwing or failing to mount.
7. **Electron stays sandboxed.** `contextIsolation: true`, `sandbox: true`,
   `nodeIntegration: false`. New capabilities are exposed through the preload bridge
   in `apps/desktop/src/preload/index.ts` and typed in
   `packages/ui-contracts/src/desktop.ts`. No renderer-side Node access.
8. **No new dependencies without approval.** List every proposed dependency and
   native binary in the design doc with a one-line justification and stop.
9. **Do not verify by driving a browser** (`CLAUDE.md` §Tests). Verify with
   `bun test`, `bun run typecheck`, and reading code. Hand the runtime behaviour
   to the user to check and say so explicitly.
10. The working tree is dirty with user-owned changes. Do not stash, reset, stage,
    or commit anything you did not create.

## Platform reality you must design around

Electron/Chromium **cannot** create a Wayland overlay. It speaks `xdg-shell` only;
there is no `wlr-layer-shell` support and no arbitrary window positioning. Therefore:

- The overlay is a **separate native sidecar process** owning the layer surface,
  supervised by the Electron main process, speaking a line-delimited JSON protocol
  over stdio or a unix socket.
- Cursor position is not queryable on Wayland. Design the pointer-following overlay
  around the sources that actually exist and state which you chose: compositor IPC
  (`hyprctl cursorpos`, sway IPC), the overlay surface's own `wl_pointer` events when
  it holds pointer focus, or `org.freedesktop.portal.RemoteDesktop` (libei). Each has
  different permission and latency characteristics. Do not assume a global cursor API.
- Screen capture goes through `org.freedesktop.portal.ScreenCast` / `Screenshot`
  (PipeWire). Handle the restore-token flow so the user is not re-prompted every
  session, and handle refusal.
- Focused-application identity has no portable Wayland API. Use compositor IPC where
  present and AT-SPI2 over D-Bus as the portable fallback (AT-SPI works regardless of
  display server, when the target app exposes it).
- Global shortcuts: `Electron.globalShortcut` is a no-op on native Wayland. Use
  `org.freedesktop.portal.GlobalShortcuts` or a compositor keybind that pokes the app.
- Not every compositor implements layer-shell (GNOME does not). Put the overlay behind
  a strategy interface with at least two implementations: layer-shell sidecar, and an
  XWayland always-on-top `BrowserWindow` fallback (`setAlwaysOnTop(win, 'screen-saver')`,
  `transparent`, `frame: false`, `setIgnoreMouseEvents({ forward: true })`). Detect and
  report which is active.

## Phase 0 — Design document (deliver this first, then STOP)

Write `NEXT-desktop-agent.md` following the structure and tone of `NEXT.md`
(Decisions / Target shape / Contracts / Risks / Steps). It must resolve, with a
recommendation and a reason, every item below. Do not write implementation code
until this document is approved.

### D1. Sidecar language and toolkit

Rust + `smithay-client-toolkit`, GTK4 + `gtk4-layer-shell`, or another. Decide how it
is built and shipped: workspace build step, prebuilt binary, or resolved from `$PATH`
like the repo already does for the Claude Code CLI (`$CLAUDE_EXECUTABLE` / `Bun.which`).
State the cross-compilation and packaging consequences for `electron-builder.yml`.

### D2. Sidecar protocol

Define the full message set (overlay show/hide/move, region highlight, pointer
subscribe, capture request, capability report, error) as a versioned, testable
codec. The codec must be pure TypeScript so it is unit-testable with `bun test`
without spawning anything.

### D3. Capture path

Portal ScreenCast via Electron `desktopCapturer`, direct portal D-Bus calls, or
compositor tools (`grim`/`slurp`). Cover full-screen, per-window and region. State
where the bytes are decoded, where they are stored, and how they reach
`POST /api/assets` without a needless round trip through the renderer.

### D4. Detection

`@techstark/opencv-js` (WASM), ONNX Runtime with a UI-element model, or classical
template matching. Whichever you pick, put it behind a `RegionDetector` interface so
it is swappable, and run it off the main thread. Define the region shape and how a
click on a board image resolves to a region. State the model download/licensing story
if a model is involved.

### D5. Speech to text

The description says GGUF. Decide concretely: `whisper.cpp` (GGML/GGUF) invoked as a
subprocess or server, node bindings, or a `llama.cpp` audio model. Cover model path
configuration, streaming vs batch, VAD, microphone permission, and what happens when
no model is configured. Prefer the repo's existing stance: resolve a system-installed
binary, do not vendor one.

### D6. Actuation boundary — SECURITY GATE

The description implies "control the desktop". Split it explicitly:

- **Advisory** — the overlay highlights where to click, the harness explains; the user acts.
- **Actuating** — synthetic input is injected via `org.freedesktop.portal.RemoteDesktop`/libei.

Recommend advisory-only for the first phase and state the permission model actuation
would need: per-application opt-in, a visible armed indicator, an always-available kill
switch, an audit log of every injected event, and no injection while a password field
or a screen-lock surface has focus. Do not implement actuation in this phase unless
the design doc is approved with it in scope.

### D7. Privacy model

A desktop screenshot is the user's whole screen going to a model provider. Specify:
explicit per-capture confirmation or an armed session, a per-application allowlist,
a preview-before-send step, redaction of password fields where AT-SPI marks them, and
what is written to disk under `$XDG_DATA_HOME/nib-ui` versus held in memory.

### D8. Per-application routing

Config shape mapping an application identity (compositor `app_id`, AT-SPI name,
desktop entry) to a harness adapter, model, system prompt fragment, MCP server, and
skill. Where it is stored, how it is edited, precedence rules, and behaviour for an
unknown application.

### D9. Workspace hosting

Determine how a surface peer to the canvas board is actually hosted in this codebase
today — the board is a pane (`PaneKind: 'canvas'`) inside the pane layout, so "a second
workspace alongside the canvas" needs a concrete mechanism. State it, and state how the
desktop workspace and the board share selection, camera and objects, given that
`CanvasRegistry` outlives any mounted engine.

## Phase 1 — Implementation (only after approval)

### Target shape

```
packages/ui-contracts/src/desktop-agent.ts   DesktopAgentService contract, Services augmentation
packages/ui-contracts/src/desktop.ts         extend DesktopBridge (do not break existing shape)
apps/desktop/src/main/desktop-agent/         sidecar supervisor, portal calls, capture
apps/desktop/src/preload/index.ts            bridge surface, still sandboxed
plugins/desktop-agent/                       core plugin: pane, canvas kinds/tools/layers, commands
plugins/desktop-agent/sidecar/               native layer-shell process (per D1)
```

### Canvas integration

The workspace is a full canvas participant, not a bolt-on:

- `registerKind` for the desktop-specific objects (detected-region overlay, live
  desktop view, transcript card) — screenshots reuse `media`.
- `registerTool` for the region-select / point-at gestures.
- `registerLayer` for the detection overlay drawn above the object layer.
- `registerContextMenu` for "Send to harness", "Detect regions", "Track this window".
- **`registerContextProvider`** so a desktop object contributes a `CanvasObjectContext`
  (`label`, `attachments`, `text`) when a workstream carries it into a prompt. This is
  the seam that makes a screenshot mean something to the session.
- `registerDropHandler` / `registerPasteHandler` where an image arriving from the
  desktop should be claimed by this plugin rather than `canvas-media`. Respect the
  existing ordering convention (media `order: 10`, links `order: 20`).

### Harness routing

On "send", resolve the application identity, look up its routing config (D8), create
or reuse a session on the matching adapter, and `send` a prompt composed of the
transcript, the detected regions, and the screenshot as a `SessionAttachment`.
Reuse `SessionsService` / the transport SSE stream for responses. Do not open a
second event channel and do not add a second reducer — `reduceSession` already folds
the log.

## Tests

- `bun test` unit coverage for every pure module: sidecar protocol codec (round-trip
  and malformed input), region geometry and hit resolution, application→config
  routing precedence, board object `parse` round-trips including the
  unknown-plugin-loaded case, capability detection given a fake environment.
- Sidecar spawn, portal grants, overlay rendering and audio capture are **not**
  unit-testable here. State that plainly, list exactly what the user must verify by
  hand, and do not fake a green suite around it.
- `bun run typecheck` must pass across the workspace.

## Deliverable order

1. `NEXT-desktop-agent.md` with D1–D9 resolved. **Stop.**
2. Contracts + protocol codec + tests. **Stop.**
3. Sidecar + supervisor + capability detection.
4. Capture → asset → board.
5. Overlay + pointer tracking.
6. Detection.
7. STT.
8. Harness routing + per-application config.

Do not skip ahead. If a phase reveals a decision from Phase 0 was wrong, say so and
stop rather than working around it.

## Do not

- Add an agent loop, a second event log, or a second session store.
- Put image or audio bytes in `BoardDoc` or in localStorage.
- Bypass the preload bridge or relax the Electron sandbox.
- Hardcode a compositor. Detect capabilities and degrade.
- Implement input injection in Phase 1.
- Refactor the canvas engine, the pane layout, or anything else outside this feature.
- Edit files under `node_modules/`, including `@neoworks-dev/ui`.
