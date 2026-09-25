# The DOM boundary

Almost everything on a board is drawn in Pixi, including the cards. DOM survives in three
places, and each is there for a reason rather than by accident:

- the chat drawer, which is scrollable text that wants selection;
- floating panes, which are real windows over the board;
- the prompt sheet and text edits, which are inputs.

The board itself has no DOM to read, which is a known accessibility regression rather than an
oversight. A list of notes that people could read with a screen reader would be the cheapest
place to start fixing it — and the vault is exactly that list.
