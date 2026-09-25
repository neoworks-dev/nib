import type { Plugin } from "@nib-ui/kernel";
import type { CanvasMenuItem, Point } from "@nib-ui/ui-contracts";
import ArrowsMergeIcon from "phosphor-svelte/lib/ArrowsMergeIcon";
import ArrowsOutIcon from "phosphor-svelte/lib/ArrowsOutIcon";
import ChatCenteredDotsIcon from "phosphor-svelte/lib/ChatCenteredDotsIcon";
import ClipboardTextIcon from "phosphor-svelte/lib/ClipboardTextIcon";
import EyeIcon from "phosphor-svelte/lib/EyeIcon";
import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
import FolderPlusIcon from "phosphor-svelte/lib/FolderPlusIcon";
import GraphIcon from "phosphor-svelte/lib/GraphIcon";
import GridFourIcon from "phosphor-svelte/lib/GridFourIcon";
import LinkBreakIcon from "phosphor-svelte/lib/LinkBreakIcon";
import NotePencilIcon from "phosphor-svelte/lib/NotePencilIcon";
import PlayIcon from "phosphor-svelte/lib/PlayIcon";
import StackIcon from "phosphor-svelte/lib/StackIcon";
import TrashIcon from "phosphor-svelte/lib/TrashIcon";
import CanvasPane from "./CanvasPane.svelte";
import ChatPane from "./ChatPane.svelte";
import { chatPaneId } from "./chat-pane";
import { SelectTool } from "./engine/tools/SelectTool";
import { TextTextureCache } from "./engine/utils/textTexture";
import LinksPane from "./LinksPane.svelte";
import { sheetPaneId, sheetPaneLabel } from "./sheet-pane";
import SheetPane from "./SheetPane.svelte";
import TrashPane from "./TrashPane.svelte";
import { deleteFromVault, joinSelection, pasteFromClipboard } from "./board-actions";
import { backdropMenuItems, type BoardMenuIcons, boardMenuItems } from "./menu";
import { diagramKind } from "./objects/DiagramRenderer";
import { fileKind } from "./objects/FileRenderer";
import { folderKind } from "./objects/FolderRenderer";
import { sheetKind } from "./objects/SheetRenderer";
import { stickyKind } from "./objects/StickyRenderer";
import { transcriptKind } from "./objects/TranscriptRenderer";
import { visualKind } from "./objects/VisualRenderer";
import { webclipKind } from "./objects/WebclipRenderer";
import { canvasState } from "./state.svelte";
import { urlBody } from "./card-kind";
import { boardTheme } from "./theme";
import { isWorkstream } from "./workstream";

const paneId = "canvas";
const linksPaneId = "canvas.links";
const trashPaneId = "canvas.trash";

/** The menu is built where there is no bundler, so its icons are handed to it. */
const MENU_ICONS: BoardMenuIcons = {
  dissolve: ArrowsOutIcon,
  collapse: StackIcon,
  arrange: GridFourIcon,
  join: ArrowsMergeIcon,
  group: FolderPlusIcon,
  preview: EyeIcon,
  enter: FolderOpenIcon,
  open: ChatCenteredDotsIcon,
  start: PlayIcon,
  unlink: LinkBreakIcon,
  trash: TrashIcon,
  note: NotePencilIcon,
  paste: ClipboardTextIcon,
};

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

/** The same, for pages: opening a webclip is what puts the browser pane on screen. */
const browserLinkPlugin: Plugin = {
  name: "canvas:browser-link",
  inject: ["browser"],
  apply(ctx) {
    canvasState.browser = ctx.require("browser");
    ctx.effect(() => () => {
      canvasState.browser = null;
    });
  },
};

export const canvasPlugin: Plugin = {
  name: "canvas",
  inject: ["panes", "commands", "sessions", "transport", "renderers", "slots"],
  apply(ctx) {
    const panes = ctx.require("panes");
    const registry = canvasState.registry;
    const sessions = ctx.require("sessions");
    canvasState.sessions = sessions;
    canvasState.panes = panes;
    const transport = ctx.require("transport");
    canvasState.board.transport = transport;
    // The vault is read over the same transport: without this the board has
    // nothing to draw from disk and silently shows only authored cards.
    canvasState.vault.transport = transport;
    canvasState.vault.sessions = sessions;

    ctx.effect(() => ctx.provide("canvas", registry));

    // A picture or a file in the vault travels with the task started from it.
    // The file is copied into the asset store only when that happens, so a
    // board of pictures costs nothing until one of them is asked about.
    ctx.effect(() =>
      registry.registerContextProvider({
        order: 5,
        contextFor: (object) => {
          if (object.kind !== "visual" && object.kind !== "file") return null;
          const path = typeof object["path"] === "string" ? object["path"] : null;
          if (path === null) return null;
          const name = typeof object["name"] === "string" ? object["name"] : path;
          return {
            label: name,
            resolveAttachments: () => canvasState.vault.attachmentsFor(path, name),
          };
        },
      }),
    );

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
    registry.onDropOnto = (ids, toId) => {
      canvasState.vault.releaseFromStacks(ids);
      // Settled after the move, not beside it: whether a card keeps the placement
      // the drag lent it depends on where its file ended up.
      void canvasState.vault.moveInto(ids, toId).then(() => canvasState.vault.settleDrag(ids));
    };

    // Picking a card up out of an opened folder or a spread pile puts the rest of
    // it back, so the drag can see the board it is crossing.
    registry.onBeginDrag = (ids) => canvasState.vault.beginDrag(ids);

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
      registry.onBeginDrag = null;
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

    /**
     * A url on its own becomes a webclip: a markdown file holding that url,
     * placed where it landed, with a capture asked for behind it. Ahead of the
     * links plugin's bookmark card, which is the other thing a pasted url could
     * be — on this board a page is a card of the page, not a card about it.
     */
    const writeClip = async (text: string | undefined, at: Point): Promise<boolean> => {
      const url = text === undefined ? null : urlBody(text);
      if (url === null) return false;
      return (await canvasState.vault.createWebclip(url, at)) !== null;
    };
    ctx.effect(() =>
      registry.registerPasteHandler({
        order: -5,
        handle: (payload, at) => writeClip(payload.text, at),
      }),
    );
    ctx.effect(() =>
      registry.registerDropHandler({
        order: -5,
        handle: (payload, at) => writeClip(payload.uri ?? payload.text, at),
      }),
    );

    const textures = new TextTextureCache();
    // The overlay reads the whole file rather than the clipped body a card draws,
    // and every edit goes back through the vault: the file is the note (PLAN §2).
    canvasState.editor.fileUrl = (path) => canvasState.vault.fileUrl(path);
    canvasState.editor.save = (path, text) => canvasState.vault.writeText(path, text);
    // The editor is optional — its plugin may not be loaded — so the vault asks
    // rather than assumes, and falls back to handing the file to the browser.
    canvasState.vault.openNote = (cwd, path) => {
      const viewer = canvasState.fileViewer;
      if (!viewer) return false;
      void viewer.openVaultFile(cwd, path);
      return true;
    };

    // A file that has left the vault takes every window onto it with it. Deleting a
    // note used to leave its pane open on a body that no longer had a file behind
    // it, and the editor would have written that body back on its next save.
    canvasState.vault.onPathsGone = (paths) => {
      for (const path of paths) {
        canvasState.editor.discard(path);
        canvasState.fileViewer?.closeVaultFile(path);
        for (const instance of panes.instances(sheetPaneId)) {
          if (instance.params?.["path"] === path) panes.closeInstance(instance.instanceId);
        }
      }
    };
    ctx.effect(() => () => {
      canvasState.vault.onPathsGone = null;
    });

    // Nothing on the board is authored. Every kind is a vault entry plus its
    // placement, and which kind an entry gets is read off its own content.
    ctx.effect(() =>
      registry.registerKind(
        folderKind({
          theme: boardTheme,
          textures,
          // What is in the folder stands out of it, so the card reads the bytes
          // of the picture inside it the same way that picture's card does.
          fileUrl: (path) => canvasState.vault.fileUrl(path),
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
          edit: (sticky) => canvasState.openSticky(sticky.path),
          toggleTask: (sticky, line) => void canvasState.vault.toggleTask(sticky.path, line),
          openLink: (sticky, target) => canvasState.followLink(sticky.path, target),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        sheetKind({
          theme: boardTheme,
          textures,
          // A sheet opens on the board rather than in the file viewer: it is a
          // page, and a page is read in a pane docked beside the board it is on.
          open: (sheet) => canvasState.openSheet(sheet.path),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        diagramKind({
          theme: boardTheme,
          textures,
          // The source, in the note editor: a diagram is changed by writing it,
          // and the file behind the card is the only place that happens.
          open: (diagram) => canvasState.openSheet(diagram.path),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        fileKind({
          theme: boardTheme,
          textures,
          // Not the sheet editor: a file the board cannot read is not a note, and
          // a prose editor over its bytes would offer to rewrite them as markdown.
          open: (file) => canvasState.vault.openFile(file),
        }),
      ),
    );
    ctx.effect(() =>
      registry.registerKind(
        transcriptKind({
          theme: boardTheme,
          textures,
          summary: (sessionId) => canvasState.sessionSummary(sessionId),
          // The chat itself, in a pane: a transcript is a conversation, and the
          // file it is stored in is of no use to anybody in a text viewer.
          open: (transcript) => canvasState.openTranscript(transcript.sessionId),
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
          textures,
          capture: (url) => canvasState.vault.capture(url),
          cancel: (clip) => void canvasState.vault.deleteEntry(clip.path),
          open: (clip) => {
            if (canvasState.browser) {
              canvasState.browser.open(clip.url);
              return;
            }
            globalThis.open(clip.url, "_blank", "noopener,noreferrer");
          },
        }),
      ),
    );
    ctx.effect(() => registry.registerTool(new SelectTool()));

    ctx.effect(() =>
      registry.registerContextMenu({
        items: (target, at): CanvasMenuItem[] => {
          // Empty board space: what can be made at this point, rather than what
          // can be done to a card. Starting a workstream is not here — the
          // composer is docked at the foot of the pane.
          if (!target) {
            return backdropMenuItems(at, MENU_ICONS, {
              writeNote: (point) => void canvasState.createSticky(point),
              paste: (point) => void pasteFromClipboard(point),
            });
          }
          return boardMenuItems(target, at, {
            selection: registry.selection,
            objects: canvasState.objects,
            icons: MENU_ICONS,
            stackOf: (id) => canvasState.vault.stackOf(id),
            canUnlink: (id) => canvasState.vault.canUnlink(id),
            carries: (object) => registry.contextFor(object) !== null,
            actions: {
              dissolveStack: (stack) => canvasState.vault.dissolveStack(stack),
              collapse: () => canvasState.collapseSelection(),
              arrange: () => canvasState.arrangeSelection(),
              join: joinSelection,
              group: (ids) => void canvasState.vault.groupIntoTopic(ids),
              paint: (ids, color) => {
                for (const id of ids) void canvasState.vault.setColor(id, color);
              },
              preview: (id) => canvasState.vault.togglePreview(id),
              enter: (id) => canvasState.vault.enter(id),
              open: (id) => canvasState.open(id),
              startWorkstream: (ids, point) => void canvasState.assetCard(ids, point),
              unlink: (ids) => registry.removeObjects(ids),
              erase: (ids) => {
                for (const id of ids) deleteFromVault(id);
              },
              remove: (ids) => registry.removeObjects(ids),
            },
          });
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
    // A note is read and written beside the board rather than over it: one pane
    // per note, and the board it belongs to stays on screen next to it. The pane
    // is the page, so its bar stays out of the way until the pointer is over it,
    // and it is named after the note rather than after the pane.
    ctx.effect(() =>
      panes.register({
        id: sheetPaneId,
        kind: "editor",
        title: "Note",
        icon: NotePencilIcon,
        chrome: "quiet",
        label: sheetPaneLabel,
        component: SheetPane,
      }),
    );

    // What a delete goes to instead of nowhere. It is a pane rather than a dialog
    // because putting something back is browsing, not answering a question.
    ctx.effect(() =>
      panes.register({
        id: trashPaneId,
        kind: "trash",
        title: "Recycling bin",
        icon: TrashIcon,
        component: TrashPane,
      }),
    );

    const commands = ctx.require("commands");
    ctx.effect(() =>
      commands.register({
        id: "canvas.vault.trash",
        title: "Open the recycling bin",
        run: () => panes.toggle(trashPaneId),
      }),
    );
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
    // The vault is what the palette searches first. There is no search pane: the
    // corpus is the snapshot the board already holds, so a keystroke costs a
    // filter, and a result is opened on the board rather than listed beside it.
    ctx.effect(() =>
      commands.registerSearch({
        group: "Vault",
        order: 0,
        search: (query) =>
          canvasState.vault.search(query).map((item) => ({
            id: item.path,
            title: item.title ?? item.name,
            detail: item.path,
            open: () => {
              if (item.kind === "topic") {
                canvasState.vault.enter(item.path);
                return;
              }
              canvasState.vault.reveal(item.path);
              canvasState.registry.select([item.path]);
            },
          })),
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
        id: "canvas.arrange.grid",
        title: "Arrange into a grid",
        when: () => canvasState.registry.selection.length >= 2,
        run: () => canvasState.arrangeSelection(),
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
    ctx.use(browserLinkPlugin);
  },
};

export {
  type BoardObject,
  type BoardView,
  type BoardViewInput,
  boardView,
  DIAGRAM_SIZE,
  type DiagramObject,
  FILE_SIZE,
  type FileObject,
  FOLDER_SIZE,
  type FolderObject,
  MIN_CARD_SIZE,
  parseDiagram,
  parseFile,
  parseFolder,
  parseSheet,
  parseSticky,
  parseTranscript,
  parseVisual,
  parseWebclip,
  PREVIEW_BANDS,
  PREVIEW_WIDTH,
  previewObjects,
  SHEET_SIZE,
  type SheetObject,
  STICKY_SIZE,
  type StickyObject,
  TRANSCRIPT_SIZE,
  type TranscriptObject,
  VISUAL_SIZE,
  type VisualObject,
  WEBCLIP_SIZE,
  type WebclipObject,
} from "./board-view";
export {
  bodyLineCount,
  type CardKind,
  cardKindFor,
  diagramSource,
  extensionOf,
  headingTitle,
  isDiagramPath,
  isImagePath,
  isMarkdownPath,
  isTranscriptPath,
  isVideoPath,
  mermaidBody,
  sessionIdOf,
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
  SHEET_TYPE,
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
