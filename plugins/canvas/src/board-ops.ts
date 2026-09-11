import type { CanvasObject } from "@nib-ui/ui-contracts";

/**
 * The board's reducer. Kept apart from the reactive store so the rules — what a
 * patch may change, what a delete drags with it, how a concurrent write is
 * folded back in — are plain functions.
 */
export function addObject(objects: CanvasObject[], object: CanvasObject): CanvasObject[] {
  if (objects.some((existing) => existing.id === object.id)) return objects;
  return [...objects, object];
}

/** `id` and `kind` are identity: a patch may move an object, never retype it. */
export function updateObject(
  objects: CanvasObject[],
  id: string,
  patch: Partial<CanvasObject>,
): CanvasObject[] {
  let changed = false;
  const next = objects.map((object) => {
    if (object.id !== id) return object;
    changed = true;
    return { ...object, ...patch, id: object.id, kind: object.kind };
  });
  return changed ? next : objects;
}

/**
 * Edges hang off the objects they connect: keeping one whose endpoint is gone
 * would leave a line into empty space that nothing can select or delete.
 */
export function withCascade(objects: CanvasObject[], ids: string[]): string[] {
  const removing = new Set(ids);
  for (const object of objects) {
    if (object.kind !== "edge") continue;
    if (removing.has(object.fromId as string) || removing.has(object.toId as string))
      removing.add(object.id);
  }
  return [...removing];
}

export function removeObjects(objects: CanvasObject[], ids: string[]): CanvasObject[] {
  if (ids.length === 0) return objects;
  const removing = new Set(withCascade(objects, ids));
  return objects.filter((object) => !removing.has(object.id));
}

/**
 * Folds a concurrent write back together. The server board is the base, since it
 * is what every other window already has; objects this window touched since its
 * last confirmed revision win over it, and ones it deleted stay deleted.
 */
export function rebaseObjects(
  server: CanvasObject[],
  local: CanvasObject[],
  removedIds: string[],
): CanvasObject[] {
  const removed = new Set(removedIds);
  const pending = new Map(local.map((object) => [object.id, object]));
  const merged: CanvasObject[] = [];

  for (const object of server) {
    if (removed.has(object.id)) continue;
    merged.push(pending.get(object.id) ?? object);
    pending.delete(object.id);
  }
  for (const object of local) {
    if (pending.has(object.id)) merged.push(object);
  }
  return merged;
}
