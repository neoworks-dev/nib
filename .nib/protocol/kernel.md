# The plugin microkernel

Everything is a plugin: the sidebar, the renderers, the canvas, the harness adapters, and the
server services. A plugin registers into a service and gets a `Disposer` back, always through
`ctx.effect(() => disposer)`, so unloading a plugin removes its registrations and nothing else
has to know it existed.

The one hard rule is the module boundary. A plugin package composes against
`@nib-ui/ui-contracts`, never against another plugin's internals and never against `apps/web` —
that is what `ui-contracts` is for, and why `plugins/canvas` re-exports the renderer toolkit
rather than letting a satellite import `engine/*`.

A card drawn in Pixi has no DOM to hang a button on, so interactive chrome inside a card is a
list of rectangles the renderer resolves itself. That is the seam [[renderers/pixi-boundary]]
is about.
