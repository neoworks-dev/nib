import type { Plugin } from "@nib-ui/kernel";
import { canvasState } from "@nib-ui/plugin-canvas";
import { untrack } from "svelte";
import type { ReactivePaneRegistry } from "../registries/panes.svelte";

/**
 * Where the panes of a working directory were left. It rides on the board
 * document — one file per directory, already revision-guarded and debounced — so
 * reopening a project brings its windows back rather than an empty board.
 */
export const paneLayoutPlugin: Plugin = {
  name: "pane-layout",
  inject: ["panes"],
  apply(ctx) {
    const panes = ctx.require("panes") as ReactivePaneRegistry;
    const board = canvasState.board;
    /** Directory whose stored layout is the one on screen. */
    let restored: string | null = null;

    const stop = $effect.root(() => {
      $effect(() => {
        const cwd = board.cwd;
        const loaded = board.loaded;
        if (!loaded || cwd.length === 0 || cwd === restored) return;
        restored = cwd;
        untrack(() => panes.restoreLayout(board.layout));
      });

      // Every frame move and split drag lands here; the board store's own
      // debounce is what keeps a drag from writing per pointer event.
      $effect(() => {
        const layout = panes.snapshotLayout();
        untrack(() => {
          if (restored !== null && restored === board.cwd) board.setLayout(layout);
        });
      });
    });

    ctx.effect(() => stop);
  },
};
