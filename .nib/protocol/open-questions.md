# Open questions

Things that are decided-but-unwritten, or genuinely undecided. Keep them here rather than in a
commit message nobody reads.

- **Does deleting a vault card mean anything?** Today it only unlinks: the placement goes and the
  file stays. For an item in the board's own directory there is nothing to unlink, so the menu
  hides the action rather than offering one that does nothing.
- **Layout is per machine.** Placements live in the board document under `$XDG_DATA_HOME`, so a
  clone loses the arrangement. An opt-in committed layout is possible and not planned.
- **Transcripts are still outside the vault.** They belong in the topic they are about, which is
  the next storage move. See [[event-log]].
