# Agent Instructions

Be direct, concise, and technically precise.

- State incorrect assumptions clearly and explain why they are wrong.
- Point out simpler or safer alternatives when a proposed approach is flawed.
- Avoid pleasantries, filler, emotional cushioning, and meta-narration.
- Preserve exact technical identifiers, commands, API names, code, and error messages.
- Do not invent abbreviations for identifiers or technical concepts.
- Quote the shortest possible log/output snippet needed to identify a problem.
- Ask only when missing information materially affects correctness, safety, public API, or architecture. Otherwise, make a sound engineering decision and proceed.

---

## Design System

NeoWorks uses the shared design system from `@neoworks-dev/ui`.

Local development links the package from:

```text
/home/moritz/Documents/neoworks/neoworks.dev/packages/ui
```

`node_modules/@neoworks-dev/ui` must resolve to this linked directory. Inspect components via `node_modules`, but make design-system edits only inside the source repository itself.

Before creating a new UI component:

1. Check `@neoworks-dev/ui` for an existing component that satisfies the requirement.
2. Reuse or compose existing components when practical.
3. Create an app-specific component only when design-system components cannot be adapted.
4. When introducing a custom component, state in one sentence which existing components were considered and why they were insufficient.

Never edit files under `node_modules/`.

If `@neoworks-dev/ui` is unresolved:

1. Verify the local source repository path.
2. Attempt to restore the link:

   ```bash
   bun link @neoworks-dev/ui
   ```

3. Do not install from an external registry, vendor components into the app, or delete the dependency as a workaround.
4. If linking fails, output the shortest actionable error and halt.

---

## Repository Map

Bun workspaces monorepo. Three roots: `apps/web` (SvelteKit app, also packaged for Electron via `apps/desktop`), `packages/*` (shared libraries), `plugins/*` (features loaded into the kernel at runtime). Lint plugins live in `tools/`. Tests sit in each workspace's own `tests/` directory and all run from `bun test` at the root.

### Packages

- `@nib-ui/kernel` — the plugin kernel: `Plugin`, `Context`, revertible `ctx.effect`, `inject`/`provide`. See the `extension-system` skill before writing one.
- `@nib-ui/ui-contracts` — the service interfaces plugins talk through (`PaneRegistry`, `TransportService`, `SessionsService`, `CanvasObject`, `CanvasMenuItem`).
- `@nib-ui/protocol` — harness/session wire types and event reduction.
- `@nib-ui/vault` — the markdown vault as data: `scan`/`tree` (index and snapshot), `placements`, `frontmatter`, `links`, `trash`. Pure, no IO.

### The vault is the truth

A project's vault — a directory of markdown, images and transcripts — is what the board draws. The board document holds **only** placements (`x/y/w/h/z`, optional `stack`) plus authored objects; a card stands for a file, so creating, moving or deleting one is a filesystem operation and the scan is what puts it on screen.

- Server writes: `apps/web/src/lib/server/vault-write.ts` (`moveVaultEntry` — `mv`, creates the destination directory, rewrites `[[links]]`; `writeVaultFile`; `writeVaultText`; `deleteVaultEntry`), `vault-trash.ts` (the recycling bin behind Delete), `board-store.ts` (board documents).
- Client transport: `apps/web/src/lib/client/plugins/transport.ts` — one method per API route; plugins never call `fetch` for vault work.

### The canvas plugin (`plugins/canvas`)

The board itself: a Pixi surface, its cards, and everything the right button offers.

- `state.svelte.ts` — `canvasState`, the one store the app and the menu reach into. Holds `board`, `vault`, `registry`, `editor` and the selection-level gestures (`collapseSelection`, `arrangeSelection`).
- `vault.svelte.ts` — `VaultStore`: which directory the board shows, what it holds, previews, piles, and every write that reaches the vault. The only writer of placements.
- `board-view.ts` — the snapshot-to-cards derivation, the per-kind card sizes (`FOLDER_SIZE`, `STICKY_SIZE`, …) and the folder-preview layout.
- `stacks.ts` — pile and grid geometry: `collapse`, `spread`, `arrangeGrid`, `dissolve`, `release`. Pure.
- `menu.ts` — the whole right-click menu, built pure from state plus callbacks, so what a selection offers is testable without a renderer.
- `theme.ts` — every drawn constant, including `CARD_GAP` (the one gutter a drag snaps to and the grid arranges by).
- `index.ts` — the plugin: registers panes, card kinds, the context menu, commands, and hands the menu its phosphor icons.
- `engine/` — the Pixi layer: camera, tools, snapping, hit testing. `objects/` — one renderer per card kind.

### Gotchas

- `plugins/canvas/src/state.svelte.ts` holds a literal `\0` inside a key template. `grep`/`rg` treat the file as binary and print **nothing** for a match; pass `-a` (`rg -na …`) when searching it.
- `bun run lint` is not green on this tree — several plugins carry pre-existing errors. Compare the output against the files you touched rather than the exit code.
- `plugins/trajectory-inspector/src/filter.ts` has two pre-existing errors, so `bun run typecheck` and `bun run check:svelte` both exit non-zero on a clean tree.

---

## Code Quality & Architecture

Prioritize cohesion, standard TypeScript idioms, and end-to-end readability over arbitrary line-count rules or micro-abstractions.

### Anti-Patterns to Avoid

- **Micro-Extraction / Function Splattering:** Do not extract 3–5 line single-use helper functions (e.g., `toSpec`, `isSuccess`, `buildResult`) purely to avoid nesting or reduce function length. Keep linear async flows readable from top to bottom.
- **Trivial Factory Functions:** Do not create constructor helpers for plain object literals unless they encapsulate complex invariant validation.
- **Redundant Event/Hook Duplication:** Consolidate repeated telemetry, event bus emissions, and lifecycle hooks into single dispatch calls or pipeline wrappers rather than scattering them across loops.
- **Manual Type Guards for Discriminated Unions:** Rely on TypeScript's native control flow narrowing on discriminant fields (`kind`, `type`) rather than writing redundant `isX()` predicate functions.
- **Forced Indentation Rules:** Do not artificially extract blocks solely to satisfy arbitrary indentation targets. Use early returns and guard clauses instead.
- **Branching to an Empty Value:** Do not add a branch or default whose only job is to produce `""`, `[]` or `{}`. Either the empty case is unreachable, in which case the fallback is dead code that implies a state the code never sees, or it is reachable and deserves a named, explicit path. `local/no-empty-ternary-branch` catches the ternary form; the `??` form is not lint-caught, so watch for it in review:

  ```ts
  // Dead fallback: `split` always returns at least one element, so `?? ""` can never fire.
  // It exists only to satisfy `noUncheckedIndexedAccess`.
  const preview = block.text.trim().split("\n")[0] ?? "";
  ```

  Rewriting this is not automatically an improvement — every alternative trades the dead fallback for either an allocation, a multi-line block, or a `.join("")` trick. Prefer leaving a line like this alone over replacing one wart with a worse one; the point is to avoid writing new ones.

- **Casting at the Call Site:** A cast at a call site means the signature is wrong. Fix the function, not the callers. A cast repeated across files is proof.

  ```ts
  // Bad — `blockToolInput(block: BlockView): unknown` forced this into six files.
  const input = $derived((blockToolInput(block) ?? {}) as Record<string, unknown>);

  // Good — one type parameter deletes the cast and the `?? {}` at every call site.
  export function blockToolInput<T = unknown>(block: BlockView): T | undefined;
  const input = blockToolInput<{ file_path?: string; notebook_path?: string }>(block);
  ```

  A defaulted type parameter keeps this backward compatible. Before adding a cast, check whether the callee is ours, then grep for other callers. Apply the same reading to parameters: if callers keep writing `x ? fn(x) : undefined`, widen the parameter to accept `undefined` and return `undefined` from a guard clause.

- **Chained Fallbacks and Nested Ternaries:** Do not stack `?:` or `??` to select among candidates. Use guard clauses, one condition per line. `no-nested-ternary` catches the ternary form.

  ```ts
  // Bad
  const path = $derived(
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.notebook_path === "string"
        ? input.notebook_path
        : "unknown file",
  );

  // Also bad — reads as one dense expression rather than a decision.
  const path = $derived(input?.file_path ?? input?.notebook_path ?? "unknown file");

  // Good
  const path = $derived.by(() => {
    const input = blockToolInput<{ file_path?: string; notebook_path?: string }>(block);
    if (input?.file_path) return input.file_path;
    if (input?.notebook_path) return input.notebook_path;
    return "unknown file";
  });
  ```

- **Intermediate `$derived` Feeding Only One Other:** If a derived value has exactly one consumer, inline it as a local inside that consumer's `$derived.by`. A separate top-level `$derived` should earn its place by being read from more than one site or from the template.

### Structure & Naming

- Use descriptive, full-word `camelCase` identifiers (`paymentMethod`, `customerAccount`, `toolExecutionResult`). Never use truncated names (`pm`, `acct`, `res`).
- Co-locate types with the domain logic that owns them. Prefer `interface` for public contracts and `type` for unions/intersections.
- Avoid multi-level ternaries and deeply nested conditionals. Flatten execution paths using guard clauses.

### Comments

- Write comments **only** for non-obvious business rules, external API quirks, or hardware/runtime constraints.
- Never write comments that:
  - Restate obvious code or type signatures.
  - Narrate routine control flow (e.g., `// loop through items`).
  - Explain historical changes or mention "previous implementation" (rely on Git history).

### Behavior & API Preservation

- Preserve existing public APIs, exported types, data shapes, and error contracts unless explicitly directed to change them.
- Do not broaden scope or perform unrelated refactorings during bug fixes.
- If a requested refactor requires breaking an existing contract, pause and explain the conflict before proceeding.

---

## Scope & Execution

Make the smallest coherent change that completely solves the task.

Do not:

- Refactor unrelated files or modules.
- Reformat lines outside the direct scope of the change.
- Upgrade, swap, or add dependencies without explicit approval.
- Touch unrelated failing tests.

If an adjacent defect blocks current work, state it directly and request guidance.

---

## Tests & Verification

Verify every behavioral change with targeted automated tests.

1. **Test Runner:** Always execute tests using:

   ```bash
   bun test
   ```

2. **Lint (required):** Every change that touches JS/TS/Svelte must pass before it is reported as done:

   ```bash
   bun run lint
   ```

   This runs two linters with disjoint scopes. Keep them that way.

   - **oxlint** (`bun run lint:ts`, `.oxlintrc.json`) owns all JS/TS, including `<script>` blocks inside `.svelte`. `--type-aware` is on: `no-floating-promises`, `no-misused-promises`, `require-await` and friends run through `tsgolint`, the Go TypeScript compiler.
   - **Local rules** live in two plugins, split by what each linter can parse. `tools/oxlint-local-plugin.ts` loads through oxlint's `jsPlugins` for JS/TS rules — oxlint resolves that TypeScript source directly, no build step, though JS plugins are alpha there and not subject to semver. `tools/eslint-local-plugin.js` holds rules that inspect Svelte _markup_, which oxlint cannot see at all. Put new rules in whichever plugin matches the syntax they target rather than reaching for a third linter.
   - **ESLint** (`bun run lint:svelte`, `eslint.config.js`) owns `.svelte` markup only — `svelte/prefer-style-directive` and the rest of `eslint-plugin-svelte`. This is the one thing oxlint cannot do, since it parses script blocks and ignores templates.

   Never give ESLint a `projectService`. Type-aware linting through the Svelte parser costs roughly 0.8s per component and took the full run from 2s to 105s; oxlint already covers those rules. Never disable a rule or add an `eslint-disable`/`oxlint-disable` comment without stating why in the response. Both config files are user-owned — do not edit them to make a check pass.

3. **Svelte check (required):** Every change that touches `.svelte` files or anything under `apps/web` must pass:

   ```bash
   bun run check:svelte
   ```

   This runs `svelte-kit sync && svelte-check` for `@nib-ui/web`. Neither linter type-checks `.svelte` templates, so neither substitutes for this.

4. **Formatting (required):** Every change must pass:

   ```bash
   bun run format
   ```

   Prettier owns formatting for every language, `.svelte` included via `prettier-plugin-svelte`. Use `bun run format:fix` to apply. Neither linter formats: `svelte.configs.prettier` switches off ESLint's stylistic rules so the two never conflict. Do not add formatting rules to either lint config.

5. **Additional Checks:** Run type-checking (`bun run typecheck` or `tsc --noEmit`) and build steps when relevant.
6. **Playwright:** Resolve base URLs strictly from Playwright configuration (`playwright.config.ts`). Never hardcode `http://localhost:...` inside test files.
7. **Integrity:** Never weaken, skip, or remove valid tests to force a green suite. If a test is fundamentally obsolete due to an intentional API change, explain why before editing it.
8. **Zero Tests Justification:** If an edit does not include tests (e.g., pure documentation, comment fix, config change), provide a one-sentence rationale.
9. **No Browser Driving:** Do not verify UI changes by driving a browser. This means no Claude in Chrome (`mcp__claude-in-chrome__*`) and no ad-hoc scripts that launch or attach to a headless browser (CDP, Puppeteer, Playwright `chromium.launch()`, screenshot harnesses). The user runs the app and reports what is broken.

   Verify UI work with `bun run lint`, `bun run format`, `bun run check:svelte`, `bun run typecheck`, `bun test`, and reading the code. When a change genuinely cannot be verified that way, say so and hand it to the user to check.

---

## Git Safety & Workflow

Before modifying files, check working tree status:

```bash
git status --short
```

- Treat pre-existing dirty files as user-owned. Do not stash, reset, overwrite, stage, or commit them.
- Create commits only when explicitly instructed or when the active prompt is an explicit commit task.
- Keep commits atomic and scoped to one logical change.
- Commit messages: Use imperative, concise subjects. Include a body only when the context cannot be deduced from the diff.
- AI attribution (if requested):

  ```text
  Generated by: AI agent
  ```

  _(Never use `Co-Authored-By` for AI tools)._

- **Push/Merge Safety:** Never force-push. Never merge an unverified branch into `main`. Push/merge only on direct request.
