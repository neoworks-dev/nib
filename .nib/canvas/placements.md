# Placements

Where a card sits is the only part of a board that is the app's own. Item identity and content
come from disk; a placement is a rectangle keyed by *board directory*, then by vault-relative
path.

Keyed by path and not by `id` on purpose: `id:` is opt-in, so most items have none, and keying on
it would leave most of a vault unpositionable. An `id` is recorded alongside when there is one,
so a rename the app performs carries the position across.

Reconciling is one pure function. It keeps what is stored, drops a position whose path is gone,
carries one across a rename by `id`, and gives anything new a slot. The *slot* is the caller's
policy: the cursor when the user is putting something there, the middle of the canvas otherwise.

Placements live in the same document as the pane layout, because that document is already one per
directory and already has the revision guard, the write chain and the push that a second file
would have to rebuild. See [[canvas/topics]].
