<script lang="ts">
  import { Composer, type PendingComposer } from "@nib-ui/plugin-chat";
  import {
    type PaneProps,
    parseWorkspaceFileRefs,
    type Point,
    workspaceFileTransferType,
  } from "@nib-ui/ui-contracts";
  import CornersOutIcon from "phosphor-svelte/lib/CornersOutIcon";
  import { onMount, untrack } from "svelte";
  import { CanvasEngine } from "./engine/CanvasEngine";
  import { cameraFitting, clampZoom, zoomAt } from "./engine/utils/camera";
  import { unionRects } from "./engine/utils/geometry";
  import FolderRenameField from "./FolderRenameField.svelte";
  import SpawnPrompt from "./SpawnPrompt.svelte";
  import StickyOverlay from "./StickyOverlay.svelte";
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

  const menu = $derived(registry.menu);
  const prompt = $derived(registry.prompt);
  const renaming = $derived(registry.renaming);
  const boardBackground = `#${boardTheme().background.toString(16).padStart(6, "0")}`;
  /** Anything a plugin placed counts: a board of images is not an empty board. */
  const empty = $derived(canvasState.objects.length === 0);
  /** No project entered yet: the board is not empty, there is no board. */
  const opened = $derived(canvasState.board.cwd.length > 0);

  /**
   * Something the user has to be told about: a board error, or a vault that would
   * not read. A board that draws nothing because its transport was never wired is
   * indistinguishable from an empty project, and that is worth saying out loud.
   */
  const status = $derived.by((): string | null => {
    if (canvasState.error) return canvasState.error;
    const vault = canvasState.vault;
    if (vault.error) return `Vault: ${vault.error}`;
    if (vault.doc && !vault.doc.writable)
      return `Vault: ${vault.doc.reason ?? "cannot be created here"}`;
    return null;
  });

  /** The trail from the project to here, root first. Empty until a project is open. */
  const crumbs = $derived(canvasState.vault.breadcrumb);

  /** The last segment of a directory path, and the project's own name for the root. */
  function crumbLabel(dir: string): string {
    if (dir.length === 0) return projectName();
    const slash = dir.lastIndexOf("/");
    return slash === -1 ? dir : dir.slice(slash + 1);
  }

  function projectName(): string {
    const cwd = canvasState.board.cwd.replace(/\/+$/, "");
    const slash = cwd.lastIndexOf("/");
    return slash === -1 ? cwd : cwd.slice(slash + 1);
  }

  /**
   * The board's own composer, docked at the foot of the pane. It is the one a
   * session gets, driven by a target with no session behind it: the picks are
   * held on the board, and sending is what puts a workstream on it. Keyed by
   * directory so a draft survives the pane being closed and belongs to the
   * project it was written for.
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
        await canvasState.startWorkstream(text, inView());
      },
      target: {
        cwd: registry.cwd,
        boardDirectory: registry.boardDirectory,
        sources: [],
        // Read on send: the board may have panned since the composer rendered.
        get at() {
          return inView();
        },
      },
    };
  });

  /**
   * Where something the board's composer makes goes: centred on what the pane is
   * looking at, not dropped at its top-left corner, so it lands in view above
   * the composer.
   */
  function inView(): Point {
    const at = boardPoint();
    return { x: at.x - CARD_WIDTH / 2, y: at.y - CARD_MIN_HEIGHT };
  }

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
    // Read here rather than in the handlers: a `DataTransfer` is only readable
    // during the event, and a handler that awaits anything is already too late.
    const data: Record<string, string> = {};
    for (const type of transfer.types) {
      if (type === "Files") continue;
      const value = transfer.getData(type);
      if (value.length > 0) data[type] = value;
    }

    await registry.drop(
      {
        files: [...transfer.files],
        text: transfer.getData("text/plain") || undefined,
        uri: transfer.getData("text/uri-list") || undefined,
        ...(workspaceFiles.length > 0 && { workspaceFiles }),
        data,
      },
      boardPoint(event),
    );
  }
</script>

<svelte:window onpaste={onPaste} />

<!--
  The board paints its own background in Pixi, and the pane matches it so there
  is no dark flash in the frames before the renderer has initialised. The table
  is light grey whatever the app's theme is; dark mode is a separate question.
-->
<div
  bind:clientWidth={boardWidth}
  bind:clientHeight={boardHeight}
  class="relative h-full w-full overflow-hidden"
  style:background-color={boardBackground}
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
  {:else if empty && canvasState.vault.loading}
    <p
      class="pointer-events-none absolute inset-0 z-raised flex items-center justify-center text-sm text-dim"
    >
      Reading the vault…
    </p>
  {:else if empty}
    <p
      class="pointer-events-none absolute inset-0 z-raised flex items-center justify-center text-sm text-dim"
    >
      Nothing on this board yet — say what to do below.
    </p>
  {/if}

  {#if opened && crumbs.length > 1}
    <nav
      class="absolute top-2 left-1/2 z-raised flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-elevated px-2 py-1 text-2xs"
      aria-label="Where this board is in the project"
    >
      {#each crumbs as dir, index (dir)}
        {#if index > 0}
          <span class="text-faint">/</span>
        {/if}
        {#if index === crumbs.length - 1}
          <span class="text-muted">{crumbLabel(dir)}</span>
        {:else}
          <button
            type="button"
            class="text-faint hover:text-default"
            onclick={() => canvasState.vault.goTo(dir)}
          >
            {crumbLabel(dir)}
          </button>
        {/if}
      {/each}
    </nav>
  {/if}

  {#if status}
    <p
      class="absolute bottom-40 left-1/2 z-raised max-w-[32rem] -translate-x-1/2 rounded-lg border border-red/40 bg-red-soft px-2 py-1 text-2xs text-red"
    >
      {status}
    </p>
  {/if}

  <!-- Top right, opposite the shell's own bar in the bottom-right corner. -->
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
      <!--
        The dark pill the selection bars used to be. The menu replaced them, so it
        keeps their look: the board is a light table, and the actions read as one
        object floating over it rather than as a panel cut out of the chrome.
      -->
      <div
        bind:clientWidth={menuWidth}
        bind:clientHeight={menuHeight}
        class="absolute w-56 rounded-xl bg-neutral-900 p-1 shadow-lg"
        style:left="{menuPosition.left}px"
        style:top="{menuPosition.top}px"
        role="menu"
        aria-label="What can be done with the selection"
      >
        {#each menu.items as item (item.id)}
          {#if item.kind === "separator"}
            <div class="my-1 h-px bg-white/10"></div>
          {:else if item.kind === "swatches"}
            <div class="flex items-center gap-0.5 px-1 py-1">
              {#each item.swatches as swatch (swatch.id)}
                <button
                  type="button"
                  class="flex size-7 items-center justify-center rounded-lg hover:bg-white/10"
                  aria-label={swatch.label}
                  title={swatch.label}
                  onclick={() => {
                    registry.closeMenu();
                    item.run(swatch.id);
                  }}
                >
                  <span
                    class="size-4 rounded-full ring-1 ring-white/25"
                    style:background-color={swatch.css}
                  ></span>
                </button>
              {/each}
            </div>
          {:else}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-2xs text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
              class:hover:text-red-400={item.danger}
              onclick={() => {
                registry.closeMenu();
                void item.run();
              }}
            >
              {#if item.icon}
                <item.icon size={15} />
              {/if}
              <span class="truncate">{item.label}</span>
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  {#if prompt}
    <SpawnPrompt {prompt} paneWidth={boardWidth} paneHeight={boardHeight} />
  {/if}

  {#if renaming}
    {#key renaming}
      <FolderRenameField rename={renaming} />
    {/key}
  {/if}

  <!--
    The board's input, docked at the foot of the pane: the table has one place to
    say what to do, and it is in the same spot whatever is selected. The wrapper
    only places and lifts it — the composer draws its own box.
  -->
  {#if opened}
    <div class="pointer-events-none absolute inset-x-0 bottom-0 z-raised flex justify-center">
      <div class="pointer-events-auto w-[46rem] max-w-full drop-shadow-xl">
        <Composer pending={boardComposer} />
      </div>
    </div>
  {/if}

  <StickyOverlay />
</div>
