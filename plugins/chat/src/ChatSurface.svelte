<script lang="ts">
  import { Button } from "@neoworks-dev/ui";
  import type { MessageAttachment, SessionView } from "@nib-ui/protocol";
  import QuotesIcon from "phosphor-svelte/lib/QuotesIcon";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import { createAnnotation, type StagedAnnotation } from "./annotations";
  import Composer from "./Composer.svelte";
  import DetachedBanner from "./DetachedBanner.svelte";
  import MessageList from "./MessageList.svelte";
  import PermissionPrompt from "./PermissionPrompt.svelte";

  const {
    session,
    scrollToMessageId = null,
    annotations: hostAnnotations,
    attachments,
    onAnnotationAdd,
    onAnnotationRemove,
    onAttachmentsSent,
  }: {
    /** The task this surface talks to — not necessarily the active one. */
    session: SessionView;
    /** Lands on the turn a caller opened the chat for instead of on the tail. */
    scrollToMessageId?: string | null;
    /**
     * Hands the staged quotes to a host that keeps them itself — the canvas pins
     * the same records on its nodes, and one store is what keeps the two views
     * from drifting. Left out, the surface stages into state of its own.
     */
    annotations?: StagedAnnotation[];
    /** Files a host has waiting for this task; they ride the next prompt. */
    attachments?: MessageAttachment[];
    onAnnotationAdd?: (annotation: StagedAnnotation) => void;
    onAnnotationRemove?: (annotationId: string) => void;
    onAttachmentsSent?: () => void;
  } = $props();

  interface SelectionOffer {
    messageId: string;
    text: string;
    /** Selection end, in the coordinates of the feed's positioning context. */
    x: number;
    y: number;
  }

  let feed = $state<HTMLDivElement>();
  let feedFrame = $state<HTMLDivElement>();
  let annotateAction = $state<HTMLDivElement>();
  let notePopover = $state<HTMLDivElement>();
  let noteInput = $state<HTMLInputElement>();
  let follow = $state(true);
  let offer = $state<SelectionOffer | null>(null);
  /** The passage an open note input is about; it holds the popover's place too. */
  let composing = $state<SelectionOffer | null>(null);
  let note = $state("");
  let staged = $state<StagedAnnotation[]>([]);

  const controlled = $derived(hostAnnotations !== undefined);
  const annotations = $derived(hostAnnotations ?? staged);

  $effect(() => {
    // Follow the tail while new events land; `lastSeq` ticks on every one.
    session.lastSeq;
    if (follow) feed?.scrollTo({ top: feed.scrollHeight });
  });

  // Declared after the tail effect so the anchor wins the first flush; dropping
  // follow keeps the next event from pulling the view off the requested turn.
  $effect(() => {
    if (!scrollToMessageId || !feed) return;
    feed
      .querySelector(`[data-message="${CSS.escape(scrollToMessageId)}"]`)
      ?.scrollIntoView({ block: "start" });
    follow = false;
  });

  // A quote belongs to the transcript it was taken from, so swapping the session
  // out from under this surface drops what was staged against the old one. A host
  // keeps its own list per session, so only the internal one is cleared here.
  $effect(() => {
    session.sessionId;
    staged = [];
    offer = null;
    cancelNote();
  });

  $effect(() => {
    function onSelectionChange() {
      // Mid-drag the selection is still growing; only a collapse is acted on here.
      if (document.getSelection()?.isCollapsed !== false) offer = null;
    }

    function onPointerDown(event: PointerEvent) {
      // Typing a note collapses the selection, so the popover has to survive the
      // clicks that would otherwise read as leaving the offer behind.
      if (notePopover?.contains(event.target as Node)) return;
      if (composing) cancelNote();
      if (annotateAction?.contains(event.target as Node)) return;
      offer = null;
    }

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", readSelection);
    document.addEventListener("keyup", readSelection);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", readSelection);
      document.removeEventListener("keyup", readSelection);
    };
  });

  function trackScroll() {
    if (!feed) return;
    follow = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    offer = null;
  }

  /**
   * The anchor decides ownership: a selection starting outside the feed — the
   * composer, another pane — is not ours, and one spanning turns is filed under
   * the turn it began in with the highlighted text kept verbatim.
   */
  function readSelection() {
    // Keystrokes and clicks in the note input are not new offers.
    if (composing) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      offer = null;
      return;
    }

    const anchorNode = selection.anchorNode;
    const anchor = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
    const article = anchor?.closest("[data-message]");
    const messageId = article?.getAttribute("data-message");
    const text = selection.toString();
    if (
      !feed ||
      !anchor ||
      !feedFrame ||
      !messageId ||
      !feed.contains(anchor) ||
      text.trim().length === 0
    ) {
      offer = null;
      return;
    }

    const rects = selection.getRangeAt(selection.rangeCount - 1).getClientRects();
    const end = rects[rects.length - 1];
    if (!end) {
      offer = null;
      return;
    }

    const frame = feedFrame.getBoundingClientRect();
    offer = {
      messageId,
      text,
      x: Math.min(Math.max(end.right - frame.left, 60), frame.width - 60),
      y: Math.max(end.top - frame.top, 36),
    };
  }

  /** The action hands the passage to an input at the selection rather than staging it outright. */
  function openNote() {
    if (!offer) return;
    composing = offer;
    note = "";
    offer = null;
    queueMicrotask(() => noteInput?.focus());
  }

  function cancelNote() {
    composing = null;
    note = "";
  }

  /** An empty input still stages the passage — the note is the optional half. */
  function stageNote() {
    if (!composing) return;
    const annotation = createAnnotation(
      session.sessionId,
      composing.messageId,
      composing.text,
      note,
    );
    cancelNote();
    if (!annotation) return;
    document.getSelection()?.removeAllRanges();
    if (controlled) onAnnotationAdd?.(annotation);
    else staged = [...staged, annotation];
  }

  function removeAnnotation(annotationId: string) {
    if (controlled) onAnnotationRemove?.(annotationId);
    else staged = staged.filter((entry) => entry.id !== annotationId);
  }

  /** Sending consumes the quotes, so the host's pins go with the chips. */
  function clearAnnotations() {
    if (!controlled) {
      staged = [];
      return;
    }
    for (const annotationId of annotations.map((entry) => entry.id))
      onAnnotationRemove?.(annotationId);
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div bind:this={feedFrame} class="relative min-h-0 flex-1">
    <div bind:this={feed} onscroll={trackScroll} class="h-full overflow-y-auto">
      <MessageList {session} />
    </div>

    {#if offer}
      <div
        bind:this={annotateAction}
        class="absolute z-overlay -translate-x-1/2 -translate-y-full pb-1.5"
        style="left:{offer.x}px; top:{offer.y}px"
      >
        <Button size="sm" variant="surface" icon={QuotesIcon} onclick={openNote}>Annotate</Button>
      </div>
    {/if}

    {#if composing}
      <div
        bind:this={notePopover}
        class="absolute z-overlay w-72 -translate-x-1/2 -translate-y-full pb-1.5"
        style="left:{composing.x}px; top:{composing.y}px"
      >
        <div
          class="flex flex-col gap-1.5 rounded-xl border border-line bg-elevated px-2.5 py-2 shadow-lg"
        >
          <p
            class="line-clamp-2 border-l-2 border-line-strong pl-2 text-2xs leading-relaxed text-dim"
          >
            {composing.text}
          </p>
          <input
            bind:this={noteInput}
            bind:value={note}
            placeholder="Add a comment — Enter to attach"
            class="w-full rounded-md border border-line bg-input px-2 py-1 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
            onkeydown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelNote();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              stageNote();
            }}
          />
        </div>
      </div>
    {/if}
  </div>

  {#each session.pendingPermissions as request (request.requestId)}
    <PermissionPrompt {request} {session} />
  {/each}

  <DetachedBanner {session} />

  {#if annotations.length > 0}
    <div class="flex flex-wrap items-center gap-1.5 px-8 pb-2">
      {#each annotations as annotation (annotation.id)}
        <span
          class="flex max-w-72 items-center gap-1.5 rounded-full border border-line bg-raised py-1 pr-1.5 pl-2.5 text-xs text-muted"
        >
          <span class="shrink-0 text-faint"><QuotesIcon size={12} /></span>
          <span class="min-w-0 flex-1 truncate" title={annotation.text}
            >{annotation.note ?? annotation.text}</span
          >
          <button
            type="button"
            class="shrink-0 rounded-full p-0.5 text-faint hover:bg-hover hover:text-default"
            aria-label="Remove quote"
            onclick={() => removeAnnotation(annotation.id)}
          >
            <XIcon size={12} />
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <Composer
    {session}
    {annotations}
    {attachments}
    {onAttachmentsSent}
    onAnnotationsSent={clearAnnotations}
  />
</div>
