// Turning a target into something Playwright can act on.

import { readFileSync } from "node:fs";
import type { Locator, Page } from "playwright-core";
import type { Box } from "../snapshot.ts";
import { describeTarget, NAME_ROLES, type Target } from "../targets.ts";
import type { RefsFile } from "./probe.ts";

/** The refs the last `probe` wrote, or none when it has not run. */
function readRefs(refsPath: string): RefsFile {
  try {
    const refs: RefsFile = JSON.parse(readFileSync(refsPath, "utf8"));
    return refs;
  } catch {
    return { elements: [], cards: [] };
  }
}

/** The element a target names, as a Playwright locator. */
export function locate(page: Page, refsPath: string, target: Target): Locator {
  if (target.kind === "ref") {
    const entry = readRefs(refsPath).elements.find((candidate) => candidate.ref === target.ref);
    if (!entry) throw new Error(`no such ref: ${target.ref} — run "debug probe" again`);
    return page.locator(entry.selector);
  }
  if (target.kind === "pane") {
    if (target.instanceId === "board") return page.locator("[data-pane-root]");
    return page.locator(`[data-pane-leaf="${target.instanceId}"]`);
  }
  if (target.kind === "css") return page.locator(target.selector);
  if (target.kind === "testid") return page.getByTestId(target.testId);
  if (target.kind === "text") return page.getByText(target.text).first();
  if (target.kind === "name") {
    if (target.role !== undefined) {
      return page
        .getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: target.name })
        .first();
    }
    // A bare name is what the screen reads as; try the roles a person clicks.
    const roles = NAME_ROLES.map((role) => `[role="${role}"]`).join(",");
    return page
      .getByRole("button", { name: target.name })
      .or(page.locator(roles, { hasText: target.name }))
      .or(page.getByText(target.name, { exact: true }))
      .first();
  }
  throw new Error(`${describeTarget(target)} is drawn on the board, not an element`);
}

/**
 * Where in the window a target is, for the actions that need coordinates.
 *
 * A card has no element — Pixi draws it — so its box comes from the last probe.
 */
export async function pointOf(
  page: Page,
  refsPath: string,
  target: Target,
): Promise<{ x: number; y: number }> {
  if (target.kind === "point") return { x: target.x, y: target.y };
  if (target.kind === "card") return centre(cardBox(refsPath, target.ref));
  const box = await locate(page, refsPath, target).boundingBox({ timeout: 10_000 });
  if (!box) throw new Error(`${describeTarget(target)} is not on screen`);
  return centre(box);
}

/** The box of a card ref from the last probe. */
export function cardBox(refsPath: string, ref: string): Box {
  const card = readRefs(refsPath).cards.find((candidate) => candidate.ref === ref);
  if (!card) throw new Error(`no such card: ${ref} — run "debug probe" again`);
  if (!card.visible) throw new Error(`card ${ref} is off screen — pan the board to it first`);
  return card.box;
}

/** The middle of a box. */
function centre(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
