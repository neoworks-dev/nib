## Git

Commit the worktree first if it's dirty, then write your changes. Short, to-the-point commit title; a body explaining the change when the title doesn't carry it; ask if you're unsure what to write. Always say the commit was made by you, not a human. On a feature branch, only commit what that branch is for.

No trailers, ever: no `Co-Authored-By` on a commit, no "Generated with Claude Code" on a PR.

## Writing

Commits and issues carry only what matters. Say the thing, explain what a reader won't see for themselves, stop. No restating the diff, no summarising what you just said, no section that exists because the format seemed to want one.

Write issues and their comments the way you'd explain it to a colleague, in complete sentences.

- Start with a 2–3 sentence summary: what happened, why, and the fix.
- Use short headings, with short paragraphs of normal prose under them.
- Never join ideas with arrows, slashes, colons or dashes. Write "first X, then Y" instead of "X → Y", and "A and B" instead of "A / B".
- Use at most two code identifiers per sentence. Say what each one does the first time it appears.
- Use bullets only for genuinely separate items, and make each bullet a full sentence.
- Use tables only for numbers or timelines.
- Use one date format everywhere: 2026-10-07 18:28.
- Put error messages, paths and commands in code formatting, and long logs in a collapsed `<details>` block.
- Put side findings in a short "Out of scope" section at the end.

## How we work

One agent at a time, with me giving feedback as it goes. Keep each step small enough for me to read in one sitting, and stop to show me rather than piling up work I then have to catch up on.

`main` is what I've reviewed and what I run nib from. It stays checked out in the repo root: never switch branches there.

Straight to `main` in the root, no branch: typos, one-liners, and anything that only touches how we work rather than the app — this file, `.claude/skills/`, lint and editor config.

Everything else happens on a branch off `main`, in a worktree under `.worktrees/<branch>` (`git worktree add .worktrees/<branch> -b <branch> main`). Name it `<issue-number>-<slug>` when there is an issue (`12-tab-strip-overflow`), `<slug>` when there isn't. One branch is one thing; anything found along the way gets written down as an issue and stays off the branch, unless the branch can't finish without it.

Before starting on anything, check whether it is already half-built: `git branch` and `git worktree list` for the feature, the issue's comments, and what is on the branch. Sessions end mid-feature, and a branch is where that work is — starting again writes it a second time and loses whatever the first attempt learned. If a branch for it exists, continue on it.

No pull requests unless I ask for one. Review happens here, on the diff, before the merge.

## Issues

Issues on `neoworks-dev/nib` carry goals across sessions. A session ends and its context goes with it; an issue is the only thing that carries a goal to the next one. So:

- Work that finishes in this session, with me here, needs no issue.
- Work that won't finish in one session gets one, however loosely defined it still is.
- Something concrete found along the way, that isn't what we're doing now, gets one instead of being done.

Write them as soon as the list exists, not once the work starts.

Write to GitHub as the bot: issues, comments and labels go through `gh bot` (`gh bot issue comment 12 --body …`), so they show as `neoworks-bot[bot]`, not as me. Plain `gh` is for reading only. The bot as author already says a model wrote it, so no "written by Claude" line in the text. If `gh bot` fails, say so rather than falling back to plain `gh`. It lives in `~/Documents/neoworks/gh-bot`.

Labels are two axes. Type is GitHub's default `bug` or `enhancement`. Area is exactly one of:

- `area:canvas` — the board: Pixi engine, cards, stacks, the right-click menu, the `canvas-*` plugins
- `area:vault` — the vault as data and its writes: `@nib-ui/vault`, vault-write, trash, board store
- `area:agents` — harness plugins, sessions, protocol, chat pane, composer
- `area:comfyui` — ComfyUI client, workflow library, node graph editor
- `area:panes` — layout, splits, pane chrome
- `area:plugins` — kernel, ui-contracts, plugin loading, and the panes built as plugins (git, file browser, web browser, …)
- `area:ui` — app shell: sidebar, command palette, settings, theming
- `area:desktop` — Electron app, packaging, desktop agent

Two areas is fine when an issue genuinely spans them; three means split it.

`ai-found` is not a third axis — it marks issues a model found on its own, so they can be told apart from a person's. Nothing else uses it.

## Done means verified

Work is done when it has been shown to work, not when the code is written. Shown means one of:

- shown fixed through `bun run debug`, with a screenshot (and one from before, if you reproduced it);
- a test under the workspace's `tests/` that fails without the fix and passes with it.

`bun test` passes on the branch either way.

Then hand it over and stop: what changed in a sentence or two, the evidence, and the branch. When it has an issue, the evidence also goes on the issue (`bun run debug evidence --issue <n> --body … --screenshot …`) — that comment is what I read, so it's written for someone who wasn't in the session.

Reference the issue in commits with `Refs #<n>`, never `Closes`, `Fixes` or `Resolves`: those close it the moment the commit reaches `main`.

## Merging

I review the branch's diff, and it merges into `main` when I say so — never before, and never without evidence. Merge in the root with `git merge --no-ff <branch>`, so the branch stays one unit in the history; if it conflicts, resolve it in the merge commit. Push `main`. Then remove the worktree and delete the branch, and close its issue with `gh bot issue close <n>`.

Merges land in my running app; when one touches `apps/desktop/src/main` or `apps/desktop/src/preload`, tell me to restart.

## Validation

Never launch or restart my instance of the app. Ask me to restart it after Electron main-process changes; the renderer and the SvelteKit server hot-reload on their own.

Debug through `bun run debug` rather than asking me what I see: it launches the built app as an isolated instance of its own on a VNC display (I watch with `vncviewer`) and drives it by clicking, dragging and typing, and `bun run debug explore` hands that to a Claude Code instance which files what it finds. The `nib-debug` skill has the commands. It is the only way to drive the app — no Claude in Chrome, no ad-hoc Playwright or CDP scripts.

Reproduce a reported UI bug through the harness and confirm the mechanism before proposing a fix. Guessing from source has been wrong more often than right. After changing app code, `bun run debug start --build`, or you are testing the old build.

Every change that touches code passes, compared against the files you touched:

- `bun run lint` — oxlint (all JS/TS, `--type-aware`) plus ESLint (Svelte markup only). Local rules live in `tools/oxlint-local-plugin.ts` and `tools/eslint-local-plugin.js`. Never give ESLint a `projectService`. `.oxlintrc.json` and `eslint.config.js` are mine — don't edit them to make a check pass, and state why for any disable comment.
- `bun run format` — Prettier owns all formatting; `bun run format:fix` applies it.
- `bun run check:svelte` for anything under `apps/web` or any `.svelte` file; `bun run typecheck` when types move.

Known noise on a clean tree:

- `bun run lint` is not green — several plugins carry pre-existing errors.
- `plugins/trajectory-inspector/src/filter.ts` has two pre-existing errors, so `typecheck` and `check:svelte` exit non-zero.
- `plugins/canvas/src/state.svelte.ts` holds a literal `\0`; `grep`/`rg` treat it as binary and print nothing for a match. Use `rg -na`.

## Directory structure

A Bun workspaces monorepo. The web app is the product; the desktop app packages it.

```
apps/web/        the SvelteKit app: src/lib/server (vault writes, board store, harness host), src/lib/client, src/routes/api
apps/desktop/    Electron: src/main, src/preload, wrapping apps/web
packages/        shared libraries: kernel, ui-contracts, protocol, vault, render, file-icons
plugins/         features loaded into the kernel at runtime: canvas, chat, harness-*, …
tools/           the local lint plugins
scripts/debug/   the debug harness behind `bun run debug`; driver/ runs under node
*/tests/         `bun test` from the root runs every workspace's tests; one file per subject, named after it
```

nib runs on a plugin kernel (`@nib-ui/kernel`): every feature is a plugin talking through the service interfaces in `@nib-ui/ui-contracts`. Read the `extension-system` skill before touching any plugin or service.

The vault is the truth. A project's vault — a directory of markdown, images and transcripts — is what the board draws. The board document holds only placements plus authored objects; a card stands for a file, so creating, moving or deleting one is a filesystem operation, and the scan is what puts it on screen. Server writes go through `apps/web/src/lib/server/vault-write.ts`; plugins reach the server only through `apps/web/src/lib/client/plugins/transport.ts`, never `fetch`.

## Style

Neoworks has a shared design system in `/home/moritz/Documents/neoworks/neoworks.dev/packages/ui` (`@neoworks-dev/ui`), including ready-made components. Scan what it offers before designing anything frontend, reuse what's there, and follow its guidelines for anything new. `node_modules/@neoworks-dev/ui` is linked to that directory; if it doesn't resolve, `bun link @neoworks-dev/ui` — never install it from a registry or vendor it. Change it only in its own repo.

## Code style

Readability and maintainability over cleverness. Match the surrounding code when it conflicts with the rules below.

- Give every function a `/** … */` doc comment saying what it does, so it reads clearly at the call site. The signature carries the types — don't restate them in `@param`/`@returns` tags.

  ```ts
  /** Resolves a vault path to the card that stands for it, or null if none does. */
  function findCardForPath(vaultPath: string): CanvasObject | null {
  ```

- Comments are technical, concise, and for the reader who arrives later. Add them where skimming the code isn't enough — not to restate it. Don't document a feature you just removed.
  - Good: `// Normalize external IDs before database lookup.`
  - Bad: `// Now we loop through the items and do the thing.`
- Descriptive names, never shortened. `camelCase` for variables, functions, parameters and object fields unless the language or the existing code says otherwise.
  - Good: `recordId`, `customerAccount`, `paymentMethod`
  - Bad: `rid`, `acct`, `pm`
- Explicit control flow over shorthand. Avoid `??`, ternaries and compact conditionals unless they clearly save a lot of repetition.
  - Good: `if (timeout === undefined) { timeout = DEFAULT_TIMEOUT }`
  - Bad: `const timeout = options.timeout ?? DEFAULT_TIMEOUT`
- More than 2 levels of nesting is too much — use guard clauses, early returns, or extracted helpers.
  - Good: `if (!session) { return null }` up front, then the real work unindented.
  - Bad: `if (session) { if (session.worktree) { for (…) { … } } }`
- Short, focused functions, one responsibility each. Prefer a named helper over long inline logic with a comment above it.
- A cast at a call site means the signature is wrong. Fix the function, not the callers.
- Don't change behaviour, public APIs, data shapes, validation or side effects unless asked.

## Tests

When your changes are written, consider whether they need a test. If so, add one under the workspace's `tests/` and run `bun test`. Failures mean investigate, not move on.
