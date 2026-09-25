<script lang="ts">
  /**
   * The question asked of a card at a point on the table: the chat composer on
   * its own, floating over the board. Anchored in world space so it stays put
   * when the board pans, and sending puts a workstream there and starts it.
   *
   * The card's plus dragged off and dropped opens it: the card's picture is at
   * the top and the new workstream is linked to it, so a picture becomes "make a
   * 3D model of this" in one gesture. The composer can also send it to a
   * ComfyUI workflow, which takes the picture as its input and puts the result
   * where the plus was dropped. Asking the board itself is the composer docked
   * at the foot of the pane, not this.
   *
   * `@neoworks-dev/ui` has no popover, and the composer is the chat's own.
   */
  import { Composer, type PendingComposer } from "@nib-ui/plugin-chat";
  import type { MessageAttachment } from "@nib-ui/protocol";
  import { untrack } from "svelte";
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

  /** Every card asked about that is still on the board, the dragged one first. */
  const sources = $derived(
    prompt.sourceIds.flatMap((id) => {
      const found = canvasState.objects.find((object) => object.id === id);
      if (!found) return [];
      return [found];
    }),
  );

  /**
   * Which cards those are, as a value that only changes when the cards do. The
   * board hands out new objects on every sync, and resolving the attachments
   * again for each would upload the same pictures over and over.
   */
  const sourceKey = $derived(sources.map((object) => object.id).join("\n"));

  /** What the cards would send: shown before the question is asked. */
  let attachments = $state<MessageAttachment[]>([]);

  $effect(() => {
    void sourceKey;
    const targets = untrack(() => sources);
    // Collected before it is assigned: reading `attachments` here would make the
    // effect depend on what it writes.
    const immediate: MessageAttachment[] = [];
    let current = true;
    for (const target of targets) {
      const context = registry.contextFor(target);
      if (context?.attachments) immediate.push(...context.attachments);
      if (!context?.resolveAttachments) continue;
      context
        .resolveAttachments()
        .then((resolved) => {
          if (current) attachments = [...attachments, ...resolved];
        })
        // A preview that cannot be made is not worth an error: the launch will say.
        .catch(() => undefined);
    }
    attachments = immediate;
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
    const sourceIds = sources.map((object) => object.id);
    return {
      // Keyed by the cards, so a draft survives the popup being dismissed.
      id: `spawn:${sourceIds.join(",")}`,
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
        await canvasState.startFromAsset(sourceIds, text, at);
      },
      target: {
        cwd: registry.cwd,
        boardDirectory: registry.boardDirectory,
        sources: sourcePaths(),
        at: prompt.at,
      },
      onTargetSent: () => registry.closePrompt(),
    };
  });

  /** The vault paths of the cards asked from, which a workflow's image inputs take. */
  function sourcePaths(): string[] {
    return sources.flatMap((object) => {
      if (typeof object.path !== "string") return [];
      return [object.path];
    });
  }

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
