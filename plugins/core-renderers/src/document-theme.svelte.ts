/**
 * Which theme the page is in, as something a component can read reactively.
 *
 * Everything in a message is styled by CSS variables and follows a light/dark
 * switch on its own. A mermaid diagram does not: it is rendered markup with its
 * colours already in it, so it has to be drawn again when the switch happens.
 *
 * One observer for the app rather than one per message: the settings plugin
 * writes the resolved theme onto the root element, and a chat is a page of
 * blocks that would otherwise each watch it.
 */

import type { MermaidTheme } from "@nib-ui/render";

let watched = false;
let theme = $state<MermaidTheme>("light");

function read(): MermaidTheme {
  return document.documentElement.dataset["theme"] === "dark" ? "dark" : "light";
}

/**
 * The page's theme now, and again whenever it changes. This is called from
 * `$derived`, where state may not be written, so the first call hands back what
 * it read and the state catches up a microtask later.
 */
export function documentTheme(): MermaidTheme {
  if (!watched) {
    watched = true;
    const initial = read();
    queueMicrotask(() => {
      theme = initial;
    });
    new MutationObserver(() => {
      theme = read();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return initial;
  }
  return theme;
}
