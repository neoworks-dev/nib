# Issues

Running list of defects and rough edges. `PLAN.md` holds the design, `NEXT.md` the gap between
design and code; this file is the bug log.

## Open

### Panes sit flush against the window edges

A docked pane is pinned to the viewport edge — `PaneLeaf.svelte:32-35` and `PaneHost.svelte:22-25`
place each side with `inset-y-0 left-0` and friends, so the pane's outer border is the window's
border. It should read as a floating surface instead:

- 32px gap on every side between the pane and the window edge.
- Rounded corners.
- Animate in from the bottom (slide up) rather than appearing in place.
