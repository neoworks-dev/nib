import type { Plugin } from "@nib-ui/kernel";
import FallbackRenderer from "../components/FallbackRenderer.svelte";
import SpotlightButton from "../components/SpotlightButton.svelte";
import { PaneAttachments } from "../registries/attachments";
import { ReactiveCommandRegistry } from "../registries/commands.svelte";
import { ReactiveComposerTargetRegistry } from "../registries/composer-targets.svelte";
import { ReactivePaneRegistry } from "../registries/panes.svelte";
import { ReactiveRendererRegistry } from "../registries/renderers.svelte";
import { ReactiveSessionsStore } from "../registries/sessions.svelte";
import { ReactiveSlotRegistry } from "../registries/slots.svelte";

export const sessionsPlugin: Plugin = {
  name: "sessions",
  inject: ["transport"],
  apply(ctx) {
    const store = new ReactiveSessionsStore(ctx.require("transport"));
    ctx.provide("sessions", store);
    ctx.effect(() => () => store.disposeAll());
    ctx.effect(() => store.startPolling());
    void store.refresh();
  },
};

export const renderersPlugin: Plugin = {
  name: "renderers",
  apply(ctx) {
    const registry = new ReactiveRendererRegistry();
    ctx.provide("renderers", registry);
    ctx.effect(() => registry.setFallback(FallbackRenderer));
  },
};

export const slotsPlugin: Plugin = {
  name: "slots",
  apply(ctx) {
    ctx.provide("slots", new ReactiveSlotRegistry());
    // Where a composer can send besides an agent: contributed, like the slots.
    ctx.provide("composerTargets", new ReactiveComposerTargetRegistry());
  },
};

export const panesPlugin: Plugin = {
  name: "panes",
  apply(ctx) {
    const registry = new ReactivePaneRegistry();
    ctx.provide("panes", registry);
    // Reading what a pane sits next to is a different job from opening panes, and
    // a plugin that only wants its neighbours should not get the whole registry.
    ctx.provide("attachments", new PaneAttachments(registry));
  },
};

export const commandsPlugin: Plugin = {
  name: "commands",
  inject: ["slots"],
  apply(ctx) {
    const registry = new ReactiveCommandRegistry();
    ctx.provide("commands", registry);
    ctx.effect(() =>
      ctx.require("slots").register("app.toolbar", { component: SpotlightButton, order: 10 }),
    );
    ctx.effect(() => {
      const onKeydown = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || event.key !== "k") return;
        event.preventDefault();
        registry.togglePalette();
      };
      window.addEventListener("keydown", onKeydown);
      return () => window.removeEventListener("keydown", onKeydown);
    });
  },
};
