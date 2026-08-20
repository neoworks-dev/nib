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
| `renderers` | `core-renderers`, `renderer-diff`, `renderer-terminal` | block rendering by `(kind, toolName)` |
| `slots`     | `cost-tracker`, `trajectory-inspector`    | statusbar, headers, composer actions            |
| `commands`  | `trajectory-inspector`, dev commands      | command palette (⌘/Ctrl+K)                      |

Every registration goes through `ctx.effect(() => disposer)`, so disposing a plugin removes its
renderers, slot entries, listeners and commands. `Toggle plugin: <name>` in the palette exercises it.

## Commands

```bash
bun test          # kernel + protocol tests
bun run dev       # SvelteKit dev server
bun run build     # production build
bun run smoke "list the files here"   # headless adapter smoke test (JSONL to stdout)
```
