# The vault

This directory is the project's memory. Everything in it is a real file, so it is readable
with `ls`, `grep` and your own editor, and it stays readable if nib is never opened again.

## The rules

- A **topic** is a directory. A **note** is a markdown file. Nothing else carries meaning —
  there are no reserved filenames and no manifest to keep in step.
- `[[name]]` links to another file by its **stem** (`[[placements]]` for `placements.md`) or to a
  topic by its **directory name** (`[[canvas]]`). Path-qualify when a name is not unique:
  `[[canvas/placements]]`.
- **Never link by path.** A link is a name, so reorganizing the tree does not break it.
- Frontmatter is optional. `id:` exists only to let a link survive a rename made outside this
  app; `title:` overrides the filename in a card.
- **Search before you create.** `grep -rl` over this directory first. A second note saying what
  the first one says is worse than no note.
- Media that is already in the repo is **referenced by path**, never copied. Only media with no
  path of its own — a screenshot from a clipboard — is written in here.
- Write back as you work: a decision that only exists in a transcript is a decision nobody can
  find later.

## What is committed

Notes and topics are committed. Transcripts and binary media are not: a JSONL log changes on
every turn and makes every diff unreadable.
