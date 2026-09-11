<script lang="ts">
  import { Composer, type PendingComposer } from "@nib-ui/plugin-chat";
  import {
    type PaneProps,
    parseWorkspaceFileRefs,
    workspaceFileTransferType,
  } from "@nib-ui/ui-contracts";
  import ArrowsMergeIcon from "phosphor-svelte/lib/ArrowsMergeIcon";
  import CornersOutIcon from "phosphor-svelte/lib/CornersOutIcon";
  import TrashIcon from "phosphor-svelte/lib/TrashIcon";
  import { onMount, untrack } from "svelte";
  import { CanvasEngine } from "./engine/CanvasEngine";
  import { cameraFitting, clampZoom, zoomAt } from "./engine/utils/camera";
  import { unionRects } from "./engine/utils/geometry";
  import PromptSheet from "./PromptSheet.svelte";
  import { canvasState } from "./state.svelte";
  import { boardTheme, refreshBoardTheme } from "./theme";
  import { CARD_MIN_HEIGHT, CARD_WIDTH } from "./workstream";

  const { session }: PaneProps = $props();

  const registry = canvasState.registry;

  let host = $state<HTMLDivElement>();
  let boardWidth = $state(0);
  let boardHeight = $state(0);
  let menuWidth = $state(0);
  let menuHeight = $state(0);
  let engine: CanvasEngine | null = null;

  const selection = $derived(registry.selection);
  const menu = $derived(registry.menu);
  /** Anything a plugin placed counts: a board of images is not an empty board. */
  const empty = $derived(canvasState.objects.length === 0);
  /** No project entered yet: the board is not empty, there is no board. */
  const opened = $derived(canvasState.board.cwd.length > 0);

  /**
   * The board's own composer. It is the one a session gets, driven by a target
   * with no session behind it: the picks are held on the board, and sending is
   * what puts a workstream on it. Keyed by directory so a draft survives the pane
   * being closed and belongs to the project it was written for.
   */
  const boardComposer = $derived.by((): PendingComposer => {
    const settings = canvasState.boardSettings;
    return {
      id: `board:${canvasState.board.cwd}`,
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
        // The card is centred on what the pane is looking at, not dropped at its
        // top-left corner, so it lands in view above the composer.
        const at = boardPoint();
        await canvasState.startWorkstream(text, {
          x: at.x - CARD_WIDTH / 2,
          y: at.y - CARD_MIN_HEIGHT,
        });
      },
    };
  });

  // The menu coordinates are canvas-element relative, which is what the pane's
  // own box is, and it is flipped rather than clipped near an edge.
  const menuPosition = $derived.by(() => {
    if (!menu) return { left: 0, top: 0 };
    const left = menu.x + menuWidth > boardWidth ? menu.x - menuWidth : menu.x;
    const top = menu.y + menuHeight > boardHeight ? menu.y - menuHeight : menu.y;
    return { left: Math.max(4, left), top: Math.max(4, top) };
  });

  // Tracks the ids only, and runs the call untracked: `focus` writes board state,
  // and an effect that both reads and writes it re-enters itself forever.
  $effect(() => {
    const sessionId = session?.sessionId ?? null;
    const cwd = session?.cwd ?? "";
    untrack(() => void canvasState.focus(sessionId, cwd));
  });

  onMount(() => {
    const element = host;
    if (!element) return;

    const created = new CanvasEngine(registry, () => boardTheme());
    let disposed = false;

    void created.init(element).then(() => {
      if (disposed) {
        created.destroy();
        return;
      }
      engine = created;
      registry.engine = created;
      created.setTool(registry.activeTool);
    });

    // The board is drawn, not styled, so a light/dark switch has to be observed.
    const observer = new MutationObserver(() => {
      refreshBoardTheme();
      engine?.applyTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => {
      disposed = true;
      observer.disconnect();
      registry.engine = null;
      engine?.destroy();
      engine = null;
    };
  });

  /** Board point under the pointer, or the middle of the pane when there is none. */
  function boardPoint(event?: { clientX: number; clientY: number }) {
    const rect = host?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = event ? event.clientX - rect.left : rect.width / 2;
    const y = event ? event.clientY - rect.top : rect.height / 2;
    return registry.screenToWorld(x, y);
  }

  function fit() {
    const rect = host?.getBoundingClientRect();
    const bounds = unionRects(
      canvasState.workstreams.map((workstream) => ({
        x: workstream.x,
        y: workstream.y,
        width: workstream.w ?? 288,
        height: workstream.h ?? 160,
      })),
    );
    if (!rect || !bounds) return;
    registry.setCamera(cameraFitting(bounds, rect.width, rect.height));
  }

  function zoomBy(factor: number) {
    const rect = host?.getBoundingClientRect();
    if (!rect) return;
    registry.setCamera(
      zoomAt(
        rect.width / 2,
        rect.height / 2,
        clampZoom(registry.camera.zoom * factor),
        registry.camera,
      ),
    );
  }

  /** The joined card carries its sources as context; its chat is where it is written. */
  function joinSelection() {
    const id = canvasState.join(selection);
    if (id) canvasState.open(id);
  }

  /** A paste aimed at the composer or any other field is not a paste onto the board. */
  function pasteTargetsBoard(target: EventTarget | null) {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) return true;
    const tag = element.tagName.toLowerCase();
    return tag !== "input" && tag !== "textarea" && !element.isContentEditable;
  }

  async function onPaste(event: ClipboardEvent) {
    const clipboard = event.clipboardData;
    if (!clipboard || !pasteTargetsBoard(event.target)) return;
    const at = boardPoint();
    const claimed = await registry.paste(
      {
        text: clipboard.getData("text/plain") || undefined,
        html: clipboard.getData("text/html") || undefined,
        files: [...clipboard.files],
      },
      at,
    );
    if (claimed) event.preventDefault();
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const workspaceFiles = parseWorkspaceFileRefs(transfer.getData(workspaceFileTransferType));
    await registry.drop(
      {
        files: [...transfer.files],
        text: transfer.getData("text/plain") || undefined,
        uri: transfer.getData("text/uri-list") || undefined,
        ...(workspaceFiles.length > 0 && { workspaceFiles }),
      },
      boardPoint(event),
    );
  }
</script>

<svelte:window onpaste={onPaste} />

<div
  bind:clientWidth={boardWidth}
  bind:clientHeight={boardHeight}
  class="relative h-full w-full overflow-hidden bg-canvas"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={host}
    class="absolute inset-0"
    ondragover={(event) => event.preventDefault()}
    ondrop={onDrop}
  ></div>

  {#if !opened}
    <p
      class="pointer-events-none absolute inset-0 z-raised flex items-center justify-center text-sm text-dim"
    >
      Pick a project to open its board.
    </p>
  {:else if empty}
    <p
      class="pointer-events-none absolute inset-0 z-raised flex items-center justify-center text-sm text-dim"
    >
      Nothing on this board yet — say what to do below and it starts here.
    </p>
  {/if}

  <div class="pointer-events-none absolute top-2 left-2 z-raised flex items-center gap-1.5">
    {#if selection.length >= 2}
      <button
        type="button"
        class="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-violet/40 bg-violet-soft px-2 py-1 text-2xs text-violet"
        onclick={joinSelection}
      >
        <ArrowsMergeIcon size={12} /> Join {selection.length}
      </button>
    {/if}

    {#if selection.length > 0}
      <button
        type="button"
        class="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-line bg-elevated px-2 py-1 text-2xs text-faint hover:text-red"
        aria-label="Remove the selection from the board"
        onclick={() => registry.removeObjects([...selection])}
      >
        <TrashIcon size={12} />
      </button>
    {/if}
  </div>

  {#if canvasState.error}
    <p
      class="absolute top-2 left-1/2 z-raised -translate-x-1/2 rounded-lg border border-red/40 bg-red-soft px-2 py-1 text-2xs text-red"
    >
      {canvasState.error}
    </p>
  {/if}

  <!-- Top right, opposite the board's own tools: the composer owns the bottom edge. -->
  <div class="absolute top-2 right-2 z-raised flex items-center gap-1.5">
    <button
      type="button"
      class="rounded-lg border border-line bg-elevated p-1.5 text-faint hover:text-default"
      aria-label="Fit the board to the pane"
      onclick={fit}
    >
      <CornersOutIcon size={12} />
    </button>
    <button
      type="button"
      class="rounded-lg border border-line bg-elevated px-2 py-1 text-2xs text-faint hover:text-default"
      aria-label="Zoom out"
      onclick={() => zoomBy(1 / 1.2)}>−</button
    >
    <span class="rounded-lg border border-line bg-elevated px-2 py-1 text-2xs text-faint">
      {Math.round(registry.camera.zoom * 100)}%
    </span>
    <button
      type="button"
      class="rounded-lg border border-line bg-elevated px-2 py-1 text-2xs text-faint hover:text-default"
      aria-label="Zoom in"
      onclick={() => zoomBy(1.2)}>+</button
    >
  </div>

  {#if menu}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute inset-0 z-overlay"
      onclick={() => registry.closeMenu()}
      oncontextmenu={(event) => event.preventDefault()}
    >
      <div
        bind:clientWidth={menuWidth}
        bind:clientHeight={menuHeight}
        class="absolute w-52 rounded-lg border border-line bg-elevated py-1 shadow-lg"
        style="left:{menuPosition.left}px; top:{menuPosition.top}px;"
      >
        {#each menu.items as item (item.id)}
          {#if item.kind === "separator"}
            <div class="my-1 h-px bg-line"></div>
          {:else}
            <button
              type="button"
              class="block w-full truncate px-2.5 py-1 text-left text-2xs text-muted hover:bg-hover hover:text-default"
              onclick={() => {
                registry.closeMenu();
                void item.run();
              }}
            >
              {item.label}
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  <!-- The chat composer, floating over the board: what it sends is a workstream. -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 z-raised flex justify-center">
    <div class="pointer-events-auto w-[56rem] max-w-full">
      <Composer pending={boardComposer} />
    </div>
  </div>

  <PromptSheet />
</div>
