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
(rollup, `@tailwindcss/oxide`, lightningcss), so `apps/web` depends on the host-platform ones
explicitly. On a non-`linux-x64-gnu` machine, swap those three devDependencies for the matching
platform packages.

## Layout

| Path                            | Purpose                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `packages/kernel`               | Plugin microkernel: scopes, services, events, effects, forks   |
| `packages/protocol`             | Normalized event/command schemas (zod) + `reduceSession`       |
| `apps/web`                      | SvelteKit app: server harness host + browser kernel instance   |
| `plugins/*`                     | Renderers, statusbar, trajectory inspector                     |

## Commands

```bash
bun test          # kernel + protocol tests
bun run dev       # SvelteKit dev server
bun run build     # production build
bun run smoke "list the files here"   # headless adapter smoke test (JSONL to stdout)
```
