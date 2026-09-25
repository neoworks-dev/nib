<script lang="ts">
  /**
   * The question asked of a card at a point on the table: the chat composer on
   * its own, floating over the board. Anchored in world space so it stays put
   * when the board pans, and sending puts a workstream there and starts it.
   *
   * The card's plus dragged off and dropped opens it: the card's picture is at
   * the top and the new workstream is linked to it, so a picture becomes "make a
   * 3D model of this" in one gesture. Asking the board itself is the composer
   * docked at the foot of the pane, not this.
   *
   * `@neoworks-dev/ui` has no popover, and the composer is the chat's own.
   */
  import { Composer, type PendingComposer } from "@nib-ui/plugin-chat";
  import type { MessageAttachment } from "@nib-ui/protocol";
  import type { OpenPrompt } from "./registry.svelte";
  import { canvasState } from "./state.svelte";

  interface Props {
    prompt: OpenPrompt;
    /** The pane's own box, so the popup is kept inside it. */
    paneWidth: number;
    paneHeight: number;
  }

  const { prompt, paneWidth, paneHeight }: Props = $props();

  const registry = canvasState.registry;

  const WIDTH = 576;
  const ESTIMATED_HEIGHT = 240;
  const MARGIN = 8;

  const source = $derived(
    canvasState.objects.find((object) => object.id === prompt.sourceId) ?? null,
  );

  /** What the card would send: shown before the question is asked. */
  let attachments = $state<MessageAttachment[]>([]);

  $effect(() => {
    const target = source;
    if (!target) return;
    const context = registry.contextFor(target);
    attachments = [];
    if (context?.attachments) attachments = context.attachments;
    if (!context?.resolveAttachments) return;

    let current = true;
    context
      .resolveAttachments()
      .then((resolved) => {
        if (current) attachments = [...attachments, ...resolved];
      })
      // A preview that cannot be made is not worth an error: the launch will say.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  });

  /** Where the drop point is on screen now, kept inside the pane. */
  const position = $derived.by(() => {
    const at = registry.worldToScreen(prompt.at.x, prompt.at.y);
    const left = Math.min(Math.max(MARGIN, at.x - WIDTH / 2), paneWidth - WIDTH - MARGIN);
    const top = Math.min(Math.max(MARGIN, at.y), paneHeight - ESTIMATED_HEIGHT - MARGIN);
    return { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) };
  });

  const composer = $derived.by((): PendingComposer => {
    const settings = canvasState.boardSettings;
    const sourceId = prompt.sourceId;
    return {
      // Keyed by the card, so a draft survives the popup being dismissed.
      id: `spawn:${sourceId}`,
      harnessId: settings.harnessId,
      model: settings.model,
      permissionMode: settings.permissionMode,
      effort: settings.effort,
      busy: canvasState.busy,
      setHarness: (harnessId) => canvasState.configureBoard({ harnessId }),
      setModel: (model) => canvasState.configureBoard({ model }),
      setPermissionMode: (permissionMode) => canvasState.configureBoard({ permissionMode }),
      setEffort: (effort) => canvasState.configureBoard({ effort }),
      start: async (text) => {
        const at = prompt.at;
        registry.closePrompt();
        await canvasState.startFromAsset([sourceId], text, at);
      },
    };
  });

  // The card the question was about has gone — moved off the board, deleted —
  // so there is nothing left to ask it.
  $effect(() => {
    if (!source) registry.closePrompt();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    registry.closePrompt();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<button
  type="button"
  class="absolute inset-0 z-overlay cursor-default"
  aria-label="Close the question"
  onclick={() => registry.closePrompt()}
></button>

<!-- The composer draws its own box; this only places it and lifts it off the table. -->
<div
  class="absolute z-overlay drop-shadow-xl"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:width="{WIDTH}px"
>
  <Composer pending={composer} {attachments} />
</div>
