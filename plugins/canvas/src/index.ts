import type { Plugin } from "@nib-ui/kernel";
import type { CanvasMenuItem } from "@nib-ui/ui-contracts";
import ChatCenteredDotsIcon from "phosphor-svelte/lib/ChatCenteredDotsIcon";
import GraphIcon from "phosphor-svelte/lib/GraphIcon";
import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
import CanvasPane from "./CanvasPane.svelte";
import ChatPane from "./ChatPane.svelte";
import { chatPaneId } from "./chat-pane";
import { SelectTool } from "./engine/tools/SelectTool";
import { TextTextureCache } from "./engine/utils/textTexture";
import LinksPane from "./LinksPane.svelte";
import SearchPane from "./SearchPane.svelte";
import { folderKind } from "./objects/FolderRenderer";
import { sheetKind } from "./objects/SheetRenderer";
import { stickyKind } from "./objects/StickyRenderer";
import { visualKind } from "./objects/VisualRenderer";
import { webclipKind } from "./objects/WebclipRenderer";
import { canvasState } from "./state.svelte";
import { boardTheme } from "./theme";
import { isWorkstream } from "./workstream";

const paneId = "canvas";
const linksPaneId = "canvas.links";
const searchPaneId = "canvas.search";

/** The five kinds the vault contributes. Everything else was put there by a plugin. */
const VAULT_CARD_KINDS = new Set(["folder", "sticky", "sheet", "visual", "webclip"]);

function isVaultCard(kind: string): boolean {
  return VAULT_CARD_KINDS.has(kind);
}

/**
 * Deleting reaches the filesystem and is the one board action with no undo, so it
 * asks first. A card's id is its vault path, which is what the route addresses.
 */
function deleteFromVault(path: string, isTopic: boolean): void {
  const what = isTopic ? `"${path}" and everything inside it` : `"${path}"`;
  if (!globalThis.confirm(`Delete ${what} from the vault? This cannot be undone.`)) return;
  void canvasState.vault.deleteEntry(path);
}

/** Optional coupling: a written file opens in the editor only while one is loaded. */
const viewerLinkPlugin: Plugin = {
  name: "canvas:viewer-link",
  inject: ["fileViewer"],
  apply(ctx) {
    canvasState.fileViewer = ctx.require("fileViewer");
    ctx.effect(() => () => {
      canvasState.fileViewer = null;
    });
  },
};

export const canvasPlugin: Plugin = {
  name: "canvas",
  inject: ["panes", "commands", "sessions", "transport", "renderers", "slots"],
  apply(ctx) {
    const panes = ctx.require("panes");
    const registry = canvasState.registry;
    canvasState.sessions = ctx.require("sessions");
    canvasState.panes = panes;
    const transport = ctx.require("transport");
    canvasState.board.transport = transport;
    // The vault is read over the same transport: without this the board has
    // nothing to draw from disk and silently shows only authored cards.
    canvasState.vault.transport = transport;

    ctx.effect(() => ctx.provide("canvas", registry));

    // Opening a card opens the chat pane for its conversation, or reaches the one
    // that workstream already has.
    registry.onActivate = (object) => {
      if (isWorkstream(object)) canvasState.open(object.id);
    };

    // A double click on empty board space writes a blank note into this board's
    // directory and opens it: the vault is the truth, so a sticky is a file on
    // disk before it is a card.
    registry.onCreateAt = (at) => void canvasState.createSticky(at);
    // Clicking away puts a previewed folder back and re-piles a spread stack.
    registry.onClearFocus = () => canvasState.vault.closePreview();
    // A card in a folded pile is the pile before it is itself, so the click
    // spreads the stack rather than reaching the card's own gesture.
    registry.onInterceptActivate = (id) => canvasState.spreadStackAt(id);
    // What the board draws at full strength; everything else falls to the dim.
    registry.focusSource = () => canvasState.vault.focus;

    // A card released on a topic is a real `mv` into that directory; on empty
    // board space it is a `mv` into the board's own (PLAN §5). Anything that is
    // not a vault card is left where the drag put it.
    registry.onDropOnto = (ids, toId) => void canvasState.vault.moveInto(ids, toId);

    // Entering a project and reaching one of its workstreams are what the project
    // list asks for; it holds the `canvas` service and knows nothing beyond it.
    registry.onOpenBoard = (cwd) => canvasState.openProject(cwd);
    registry.onOpenWorkstream = (workstreamId) => canvasState.open(workstreamId);
    ctx.effect(() => () => {
      registry.onActivate = null;
      registry.onCreateAt = null;
      registry.onInterceptActivate = null;
      registry.onClearFocus = null;
      registry.focusSource = null;
      registry.onDropOnto = null;
      registry.onOpenBoard = null;
      registry.onOpenWorkstream = null;
    });

    // Ahead of every other handler: a file dropped or pasted onto a board becomes
    // a file in that topic's directory (PLAN §7), not a blob in the asset store.
    // Only files are claimed, so a pasted url still reaches the links plugin.
    const writeFiles = (files: File[], at: { x: number; y: number }): Promise<boolean> => {
      if (files.length === 0) return Promise.resolve(false);
      return canvasState.vault.writeFiles(files, at).then((written) => written.length > 0);
    };
    ctx.effect(() =>
      registry.registerPasteHandler({
        order: -10,
        handle: (payload, at) => writeFiles(payload.files, at),
      }),
    );
    ctx.effect(() =>
      registry.registerDropHandler({
        order: -10,
        handle: (payload, at) => writeFiles(payload.files, at),
      }),
    );

    const textures = new TextTextureCache();
    // The overlay reads the whole file rather than the clipped body a card draws.
    canvasState.editor.fileUrl = (path) => canvasState.vault.fileUrl(path);
    // The editor is optional — its plugin may not be loaded — so the vault asks
    // rather than assumes, and falls back to handing the file to the browser.
    canvasState.vault.openNote = (cwd, path) => {
      const viewer = canvasState.fileViewer;
      if (!viewer) return false;
      void viewer.openVaultFile(cwd, path);
      return true;
    };

    // Nothing on the board is authored. Every kind is a vault entry plus its
    // placement, and which kind an entry gets is read off its own content.
    ctx.effect(() =>
      registry.registerKind(
        folderKind({
          theme: boardTheme,
          textures,
          preview: (folder) => canvasState.vault.togglePreview(folder),
          enter: (folder) => canvasState.vault.enter(folder),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        stickyKind({
          theme: boardTheme,
          textures,
          edit: (sticky) => canvasState.vault.openFile(sticky),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        sheetKind({
          theme: boardTheme,
          textures,
          // A sheet opens on the board rather than in the file viewer: it is a
          // page, and reading one is what the full-screen editor is for.
          open: (sheet) => canvasState.openEditor(sheet.path),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        visualKind({
          theme: boardTheme,
          fileUrl: (path) => canvasState.vault.fileUrl(path),
          open: (visual) => canvasState.vault.openFile(visual),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        webclipKind({
          theme: boardTheme,
          captureUrl: (url) => canvasState.vault.captureUrl(url),
          cancel: (clip) => void canvasState.vault.deleteEntry(clip.path),
          open: (clip) => void globalThis.open(clip.url, "_blank", "noopener,noreferrer"),
        }),
      ),
    );
    ctx.effect(() => registry.registerTool(new SelectTool()));

    ctx.effect(() =>
      registry.registerContextMenu({
        items: (target, at): CanvasMenuItem[] => {
          if (!target) {
            const items: CanvasMenuItem[] = [];
            // Inside a topic, the way back out is worth as much as the way in.
            if (canvasState.vault.canGoUp) {
              items.push({
                kind: "action",
                id: "canvas.vault.up",
                label: "Leave this topic",
                run: () => canvasState.vault.up(),
              });
              items.push({
                kind: "action",
                id: "canvas.vault.root",
                label: "Back to the project",
                run: () => canvasState.vault.toRoot(),
              });
            }
            return items;
          }
          // A card the vault put there: it stands for a file or a directory, so
          // the menu is about that, not about a task carrying it.
          if (isVaultCard(target.kind)) {
            const folder = target.kind === "folder";
            const items: CanvasMenuItem[] = [];

            // Piling and unpiling are about the arrangement, so they come first
            // and nothing below them touches the filesystem.
            const stack = canvasState.vault.stackOf(target.id);
            if (stack !== null) {
              items.push({
                kind: "action",
                id: "canvas.stack.dissolve",
                label: "Take this stack apart",
                run: () => canvasState.vault.dissolveStack(stack),
              });
              items.push({ kind: "separator", id: "canvas.stackSep" });
            } else if (registry.selection.length >= 2 && registry.selection.includes(target.id)) {
              items.push({
                kind: "action",
                id: "canvas.stack.collapse",
                label: `Collapse ${registry.selection.length} into a stack`,
                run: () => canvasState.collapseSelection(),
              });
              items.push({ kind: "separator", id: "canvas.stackSep" });
            }

            if (folder) {
              items.push({
                kind: "action",
                id: "canvas.vault.preview",
                label: "Show what is inside",
                run: () => canvasState.vault.togglePreview(target.id),
              });
              items.push({
                kind: "action",
                id: "canvas.vault.enter",
                label: "Open this topic",
                run: () => canvasState.vault.enter(target.id),
              });
            }
            items.push({ kind: "separator", id: "canvas.vaultLinkSep" });
            // Unlinking leaves the file alone, so it is offered only where there is
            // a placement to drop; an item in this board's own directory is here
            // because it is in the directory, and taking it off means deleting it.
            if (canvasState.vault.canUnlink(target.id)) {
              items.push({
                kind: "action",
                id: "canvas.vault.unlink",
                label: "Unlink from this board",
                run: () => registry.removeObjects([target.id]),
              });
            }
            items.push({
              kind: "action",
              id: "canvas.vault.delete",
              label: folder ? "Delete this topic" : "Delete this file",
              run: () => deleteFromVault(target.id, folder),
            });
            return items;
          }

          // Anything else on the board — a picture, a model, a bookmark — is
          // worth a task of its own, and travels to it as a file.
          if (!isWorkstream(target)) {
            const items: CanvasMenuItem[] = [];
            if (registry.contextFor(target)) {
              items.push({
                kind: "action",
                id: "canvas.startFromObject",
                label: "Start a workstream from this",
                run: () => void canvasState.assetCard([target.id], at),
              });
              items.push({ kind: "separator", id: "canvas.objectSep" });
            }
            items.push({
              kind: "action",
              id: "canvas.deleteObject",
              label: "Remove from board",
              run: () => registry.removeObjects([target.id]),
            });
            return items;
          }
          return [
            {
              kind: "action",
              id: "canvas.open",
              label: "Open transcript",
              run: () => canvasState.open(target.id),
            },
            { kind: "separator", id: "canvas.sep" },
            {
              kind: "action",
              id: "canvas.delete",
              label: "Remove from board",
              run: () => registry.removeObjects([target.id]),
            },
          ];
        },
      }),
    );

    // The board is the shell's root view: every other pane floats over it.
    ctx.effect(() =>
      panes.register({
        id: paneId,
        kind: "canvas",
        title: "Canvas",
        icon: GraphIcon,
        component: CanvasPane,
      }),
    );
    // The transcript is a pane of the board's, not a package of its own: the
    // annotations it stages, the goal its first prompt launches and the card it
    // belongs to are all board state.
    ctx.effect(() =>
      panes.register({
        id: chatPaneId,
        kind: "chat",
        title: "Chat",
        icon: ChatCenteredDotsIcon,
        component: ChatPane,
      }),
    );
    // The derived graph read as a list. A board draws only the links whose two
    // ends are on it, and this is where the rest of them are.
    ctx.effect(() =>
      panes.register({
        id: linksPaneId,
        kind: "links",
        title: "Links",
        icon: GraphIcon,
        component: LinksPane,
      }),
    );
    ctx.effect(() =>
      panes.register({
        id: searchPaneId,
        kind: "search",
        title: "Search",
        icon: MagnifyingGlassIcon,
        component: SearchPane,
      }),
    );

    const commands = ctx.require("commands");
    ctx.effect(() =>
      commands.register({
        id: "canvas.chat",
        title: "Open the chat pane",
        // Not a toggle: closing the pane by id would take every open conversation
        // with it, and a chat pane is closed one at a time from its own title bar.
        run: () => {
          panes.open(chatPaneId);
        },
      }),
    );
    ctx.effect(() =>
      commands.register({
        id: "canvas.vault.up",
        title: "Leave this topic",
        when: () => canvasState.vault.canGoUp,
        run: () => canvasState.vault.up(),
      }),
    );
    ctx.effect(() =>
      commands.register({
        id: "canvas.vault.refresh",
        title: "Re-read the vault from disk",
        run: () => void canvasState.vault.refresh(),
      }),
    );
    ctx.effect(() =>
      commands.register({
        id: "canvas.vault.links",
        title: "Show what this links to",
        run: () => panes.toggle(linksPaneId),
      }),
    );
    ctx.effect(() =>
      commands.register({
        id: "canvas.vault.search",
        title: "Search the vault",
        run: () => panes.toggle(searchPaneId),
      }),
    );
    ctx.effect(() =>
      commands.register({
        id: "canvas.stack.collapse",
        title: "Collapse into a stack",
        keybinding: "\u2318/Ctrl+G",
        when: () => canvasState.registry.selection.length >= 2,
        run: () => canvasState.collapseSelection(),
      }),
    );
    ctx.effect(() =>
      commands.register({
        id: "canvas.stack.dissolve",
        title: "Take this stack apart",
        keybinding: "\u2318/Ctrl+Shift+G",
        when: () => canvasState.registry.selection.length > 0,
        run: () => canvasState.dissolveSelection(),
      }),
    );

    // A conversation handed to another harness continues in a new session, so the
    // card that stood for it moves with the work.
    ctx.effect(() =>
      ctx.on("session/replaced", (previousSessionId, nextSessionId) =>
        canvasState.replaceSession(previousSessionId, nextSessionId),
      ),
    );

    ctx.effect(() => () => {
      textures.clear();
      canvasState.reset();
    });
    ctx.use(viewerLinkPlugin);
  },
};

export {
  type BoardObject,
  type BoardView,
  type BoardViewInput,
  boardView,
  FOLDER_SIZE,
  type FolderObject,
  MIN_CARD_SIZE,
  parseFolder,
  parseSheet,
  parseSticky,
  parseVisual,
  parseWebclip,
  PREVIEW_WIDTH,
  previewObjects,
  SHEET_SIZE,
  type SheetObject,
  STICKY_SIZE,
  type StickyObject,
  VISUAL_SIZE,
  type VisualObject,
  WEBCLIP_SIZE,
  type WebclipObject,
} from "./board-view";
export {
  bodyLineCount,
  type CardKind,
  cardKindFor,
  extensionOf,
  isImagePath,
  isMarkdownPath,
  isVideoPath,
  STICKY_MAX_LINES,
  urlBody,
} from "./card-kind";
export { BoardStore } from "./board.svelte";
export { VaultStore } from "./vault.svelte";
export { addObject, rebaseObjects, removeObjects, updateObject, withCascade } from "./board-ops";
export {
  type ChatPaneParams,
  type ChatPaneTarget,
  chatPaneId,
  paramsForWorkstream,
} from "./chat-pane";
export {
  branchSeed,
  type DigestEntry,
  digestOf,
  joinLabel,
  joinSeed,
  referenceSeed,
} from "./digest";
// The renderer toolkit satellite plugins build on. They compose against the
// package, never `plugins/canvas/src/engine/*`, so the engine stays private.
export { ObjectRenderer } from "./engine/ObjectRenderer";
export { CardRenderer } from "./objects/CardRenderer";
export {
  cornerHandlePoints,
  drawCornerHandles,
  drawEdgeHandles,
  edgeHandleAt,
  edgeHandlePoints,
  HANDLE_CURSORS,
  isPressable,
  isResizable,
  type PressableRenderer,
  type ResizableRenderer,
  type ResizeAnchor,
  type ResizeHandle,
  resizedRect,
  resizeHandleAt,
} from "./engine/resize";
export { applyShadow, createShadowSprite, type ShadowSpec } from "./engine/utils/shadow";
export { pointInRect, rectFromCorners, rectsIntersect, unionRects } from "./engine/utils/geometry";
export {
  bakeRuns,
  measureRuns,
  resolutionForZoom,
  type TextRun,
  TextTextureCache,
} from "./engine/utils/textTexture";
export { exchangeId, toExchanges } from "./exchanges";
export {
  type LegacyDoc,
  legacyStorageKey,
  type MigratedBoard,
  migrateDocs,
  parseLegacyDocs,
} from "./migrate";
export type { Exchange, TracedStep } from "./model";
export { canvasState } from "./state.svelte";
export { stepLines, summariseSteps } from "./steps";
export {
  type BoardTheme,
  boardTheme,
  CARD_RADIUS,
  CARD_SHADOW,
  CARD_SHADOW_RAISED,
  CARD_TYPE,
  DIMMED_ALPHA,
  MARQUEE,
  refreshBoardTheme,
  SELECTION,
  SHARP_RADIUS,
  statusColor,
  statusWord,
  themeRevision,
} from "./theme";
export {
  type AnnotationObject,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  CARD_WIDTH,
  type EdgeDirection,
  type EdgeObject,
  edgeEndpoints,
  freeSlot,
  isEdge,
  isWorkstream,
  parseEdge,
  parseWorkstream,
  type WorkstreamObject,
  type WorkstreamStatus,
  type WorkstreamView,
  workstreamAt,
  workstreamView,
} from "./workstream";
