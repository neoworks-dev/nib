# The vault: files created, moved and deleted from the board

A card stands for a file, so every change on the board is a filesystem change.

- Create a note and a folder from the board. Do the files appear in `demo/.nib/`?
- Rename and move notes; do `[[links]]` in other notes follow them?
- Delete a card; is it in the recycling bin, and does restoring it bring it back
  where it was?
- Change a file on disk (with the Write tool, inside `demo/.nib/`); does the board
  pick it up without a reload?
- Files the board does not know how to draw: an empty file, odd names, spaces,
  unicode.
