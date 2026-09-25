---
title: What a card draws
---
# What a card draws

A single click on a topic lays its contents out beside it as a real block of cards, positions
unused. A double click enters it. A file card answers only the double click, leaving the single
click to the select tool — which is why the kind contract hands the *gesture* to `activate`
rather than swallowing the single click.

The overview is **the items themselves**, not a list of their names: a topic is the collection of
what is inside it, so its preview shows that collection. The same auto-layout function places a
newly discovered item on a board, which is why a preview and a first sighting agree.
Text is baked to one texture per card and re-baked in three resolution buckets as the camera
zooms. Nothing expensive may run per frame: the engine reads its object list every tick, and the
list is memoised on the identity of both halves it is built from.
