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

## Code Quality & Architecture

Prioritize cohesion, standard TypeScript idioms, and end-to-end readability over arbitrary line-count rules or micro-abstractions.

### Anti-Patterns to Avoid

- **Micro-Extraction / Function Splattering:** Do not extract 3–5 line single-use helper functions (e.g., `toSpec`, `isSuccess`, `buildResult`) purely to avoid nesting or reduce function length. Keep linear async flows readable from top to bottom.
- **Trivial Factory Functions:** Do not create constructor helpers for plain object literals unless they encapsulate complex invariant validation.
- **Redundant Event/Hook Duplication:** Consolidate repeated telemetry, event bus emissions, and lifecycle hooks into single dispatch calls or pipeline wrappers rather than scattering them across loops.
- **Manual Type Guards for Discriminated Unions:** Rely on TypeScript's native control flow narrowing on discriminant fields (`kind`, `type`) rather than writing redundant `isX()` predicate functions.
- **Forced Indentation Rules:** Do not artificially extract blocks solely to satisfy arbitrary indentation targets. Use early returns and guard clauses instead.

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

2. **Lint (required):** Every change that touches JS/TS/JSON must pass Biome before it is reported as done:

   ```bash
   bun run lint
   ```

   Always pass `--reporter=concise` (already wired into the script). Use `bun run lint:fix` to apply safe fixes. Never disable a rule or add a `biome-ignore` comment to silence a finding without stating why in the response. `biome.json` at the repo root is user-owned configuration — do not edit it to make a check pass.

3. **Svelte check (required):** Every change that touches `.svelte` files or anything under `apps/web` must pass:

   ```bash
   bun run check:svelte
   ```

   This runs `svelte-kit sync && svelte-check` for `@nib-ui/web`. Biome does not analyze `.svelte` templates, so it does not substitute for this.

4. **Svelte formatting (required):** Every change that touches `.svelte` files must pass:

   ```bash
   bun run format:svelte
   ```

   Prettier with `prettier-plugin-svelte` owns `.svelte` formatting because Biome 2.x has no Svelte formatter. Use `bun run format:svelte:fix` to apply. The two formatters are scoped disjointly by `.prettierignore` — never widen Prettier's scope to a language Biome already formats.

5. **Additional Checks:** Run type-checking (`bun run typecheck` or `tsc --noEmit`) and build steps when relevant.
6. **Playwright:** Resolve base URLs strictly from Playwright configuration (`playwright.config.ts`). Never hardcode `http://localhost:...` inside test files.
7. **Integrity:** Never weaken, skip, or remove valid tests to force a green suite. If a test is fundamentally obsolete due to an intentional API change, explain why before editing it.
8. **Zero Tests Justification:** If an edit does not include tests (e.g., pure documentation, comment fix, config change), provide a one-sentence rationale.
9. **No Browser Driving:** Do not verify UI changes by driving a browser. This means no Claude in Chrome (`mcp__claude-in-chrome__*`) and no ad-hoc scripts that launch or attach to a headless browser (CDP, Puppeteer, Playwright `chromium.launch()`, screenshot harnesses). The user runs the app and reports what is broken.

   Verify UI work with `bun run lint`, `bun run format:svelte`, `bun run check:svelte`, `bun run typecheck`, `bun test`, and reading the code. When a change genuinely cannot be verified that way, say so and hand it to the user to check.

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
