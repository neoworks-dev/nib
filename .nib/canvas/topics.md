---
id: canvas-topics
title: A topic is a folder
---

# A topic is a folder

A directory *is* a topic, and that is the whole type system. There is no `index.md`, no manifest
and no `kind:` field, because the tree already says it.

That has one cost, paid in one place: a folder has no frontmatter, so it has no `id`, so a rename
made outside the app breaks links to it. Frontmatter `id:` on a *file* is the opt-out.

**A board is one directory's canvas.** Entering a topic replaces the entire canvas, the way
entering a folder does. A topic is collapsed by default: its contents are not drawn on its
parent's board, only a card that says how much is inside it.

Two rules follow, and both are implemented:

> A board shows its own directory's entries, **plus anything explicitly placed on it from
> elsewhere.** An ancestor's item does not appear on a deeper board unless it was added there.

> The topic a drop lands in is the destination directory — dropping onto a card is a real `mv`.

See [[placements]] for where a card sits, and [[renderers/pixi-boundary]] for what
one draws.
