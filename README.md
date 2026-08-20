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

## Layout

| Path                            | Purpose                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `packages/kernel`               | Plugin microkernel: scopes, services, events, effects, forks   |
| `packages/protocol`             | Normalized event/command schemas (zod) + `reduceSession`       |
| `packages/ui-contracts`         | Frontend service contracts shared by the app and every plugin  |
| `apps/web`                      | SvelteKit app: server harness host + browser kernel instance   |
| `plugins/*`                     | Renderers, statusbar, trajectory inspector                     |

`packages/ui-contracts` exists so plugin packages never import from `apps/web`: it holds the
renderer/slot/command/session service interfaces plus the `@nib-ui/kernel` module augmentation.

## Extension points

| Service     | Contributed by                            | Used for                                        |
| ----------- | ----------------------------------------- | ----------------------------------------------- |
| `harnesses` | server adapters (`claude-code`)           | `createSession`/`resumeSession` per harness      |
| `workspace` | `workspace` (server)                      | cwd autocomplete + `@` file search over the cwd  |
| `renderers` | `core-renderers`, `renderer-diff`, `renderer-terminal` | block rendering by `(kind, toolName)`, plus interactive permission cards by `toolName` |
| `slots`     | `cost-tracker`, `trajectory-inspector`    | statusbar, headers, composer actions            |
| `commands`  | `trajectory-inspector`, dev commands      | command palette (⌘/Ctrl+K)                      |

Every registration goes through `ctx.effect(() => disposer)`, so disposing a plugin removes its
renderers, slot entries, listeners and commands. `Toggle plugin: <name>` in the palette exercises it.

## Session metadata

Slash commands, models, the active permission mode and the user's label all travel as
`session.meta` events on the same log — no side channel. The host emits the harness descriptor's
defaults (`defaultPermissionMode`, `models`) as the session's first event, so the composer's pills
are populated before the harness process is up. The Claude Code adapter then probes
`supportedCommands()`/`supportedModels()` and emits the resolved lists; `setPermissionMode`,
`setModel` and `setLabel` each emit a partial update, and the reducer keeps whatever a partial omits.
A harness that answers none of this simply leaves the composer's capability controls hidden.

## Permission rendering

`permission.requested` is routed through `renderers.resolvePermission(toolName)`. A plugin that
claims a tool answers it inline — `core-renderers` registers an `AskUserQuestion` card whose option
picks resolve the request with `{ behavior: 'allow', updatedInput: { …input, answers } }`. Everything
else falls back to the app's allow/deny card, which previews the pending call through the same block
renderers that draw it once it runs (`permissionPreviewBlock`).

## Commands

```bash
bun test          # kernel + protocol tests
bun run dev       # SvelteKit dev server
bun run build     # production build
bun run smoke "list the files here"   # headless adapter smoke test (JSONL to stdout)
```
