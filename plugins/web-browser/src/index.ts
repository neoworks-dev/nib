import type { Plugin } from "@nib-ui/kernel";
import GlobeIcon from "phosphor-svelte/lib/GlobeIcon";
import BrowserPanel from "./BrowserPanel.svelte";
import { showUrl } from "./open";
import { webBrowserState } from "./state.svelte";

const paneId = "browser";

export const webBrowserPlugin: Plugin = {
  name: "web-browser",
  inject: ["panes", "commands"],
  apply(ctx) {
    const panes = ctx.require("panes");
    // Nothing in the toolbar opens this pane: a card standing for a page does.
    ctx.provide("browser", {
      open(url) {
        if (showUrl(url)) panes.open(paneId);
      },
    });

    ctx.effect(() =>
      panes.register({
        id: paneId,
        kind: "browser",
        title: "Browser",
        icon: GlobeIcon,
        component: BrowserPanel,
      }),
    );
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "browser.toggle",
        title: "Toggle web browser pane",
        run: () => panes.toggle(paneId),
      }),
    );
    ctx.effect(() => () => webBrowserState.reset());
  },
};

export { showUrl } from "./open";
export { type BrowserTab, maxTabCount, webBrowserState } from "./state.svelte";
export { displayHost, normalizeUrl } from "./url";
