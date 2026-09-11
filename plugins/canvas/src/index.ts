import type { Plugin } from "@nib-ui/kernel";
import type { CanvasMenuItem } from "@nib-ui/ui-contracts";
import ChatCenteredDotsIcon from "phosphor-svelte/lib/ChatCenteredDotsIcon";
import GraphIcon from "phosphor-svelte/lib/GraphIcon";
import CanvasPane from "./CanvasPane.svelte";
import ChatPane from "./ChatPane.svelte";
import { chatPaneId } from "./chat-pane";
import { SelectTool } from "./engine/tools/SelectTool";
import { TextTextureCache } from "./engine/utils/textTexture";
import { edgeKind } from "./objects/EdgeRenderer";
import { workstreamKind } from "./objects/WorkstreamRenderer";
import { canvasState } from "./state.svelte";
import { boardTheme } from "./theme";
import { isWorkstream } from "./workstream";

const paneId = "canvas";

/** The chat pane's own side question: the workstream it is showing branches. */
function askSideQuestion(): void {
  const workstreamId = canvasState.focusedChatWorkstreamId;
  if (workstreamId) canvasState.branchCard(workstreamId);
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
    canvasState.board.transport = ctx.require("transport");

    ctx.effect(() => ctx.provide("canvas", registry));

    // Opening a card opens the chat pane for its conversation, or reaches the one
    // that workstream already has.
    registry.onActivate = (object) => {
      if (isWorkstream(object)) canvasState.open(object.id);
    };

    // Dragged onto another card it is just a link; dragged onto empty board it
    // puts a workstream there, linked to the one it came from and open for its
    // first prompt — the source carries over when that prompt starts it.
    registry.onConnect = (fromId, toId, at) => {
      if (toId) {
        canvasState.connect(fromId, toId, "link");
        return;
      }
      // A picture or a model has no thread to branch: what it starts is a task
      // carrying it, which is what the connector off one of them means.
      const source = canvasState.board.find(fromId);
      if (source && !isWorkstream(source)) {
        canvasState.assetCard([fromId], at);
        return;
      }
      canvasState.branchCard(fromId, at);
    };

    // A right-button drag off the selection: a fork of one task, a join of
    // several, or a link when it lands on a card that already exists.
    registry.onSpawn = (sourceIds, toId, at) => canvasState.spawnFrom(sourceIds, toId, at);

    // Entering a project and reaching one of its workstreams are what the project
    // list asks for; it holds the `canvas` service and knows nothing beyond it.
    registry.onOpenBoard = (cwd) => canvasState.openProject(cwd);
    registry.onOpenWorkstream = (workstreamId) => canvasState.open(workstreamId);
    ctx.effect(() => () => {
      registry.onActivate = null;
      registry.onConnect = null;
      registry.onSpawn = null;
      registry.onOpenBoard = null;
      registry.onOpenWorkstream = null;
    });

    const textures = new TextTextureCache();
    ctx.effect(() =>
      registry.registerKind(
        workstreamKind({
          textures,
          theme: boardTheme,
          view: (sessionId) => canvasState.sessions?.view(sessionId) ?? null,
          annotations: () => canvasState.stagedAnnotations(),
          annotationCount: () => canvasState.annotations.length,
          launchModel: (workstream) => canvasState.settingsFor(workstream).model,
          unpinAnnotation: (annotationId) => canvasState.unpinAnnotation(annotationId),
          respondToPermission: (sessionId, allow) =>
            canvasState.respondToFirstPermission(sessionId, allow),
          openFile: (sessionId, path) => canvasState.openFile(sessionId, path),
        }),
      ),
    );
    ctx.effect(() => registry.registerKind(edgeKind({ theme: boardTheme })));
    ctx.effect(() => registry.registerTool(new SelectTool()));

    ctx.effect(() =>
      registry.registerContextMenu({
        items: (target, at): CanvasMenuItem[] => {
          if (!target) {
            return [
              {
                kind: "action",
                id: "canvas.newWorkstream",
                label: "New workstream here",
                run: () => canvasState.openSheet("workstream", null, at),
              },
            ];
          }
          if (target.kind === "edge") {
            return [
              {
                kind: "action",
                id: "canvas.deleteEdge",
                label: "Delete link",
                run: () => registry.removeObjects([target.id]),
              },
            ];
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
            {
              kind: "action",
              id: "canvas.branch",
              label: "Ask a side question",
              run: () => canvasState.branchCard(target.id, at),
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
        id: "canvas.chat.branch",
        title: "Ask a side question from this chat",
        keybinding: "⌘/Ctrl+Shift+B",
        when: () => canvasState.focusedChatWorkstreamId !== null,
        run: () => askSideQuestion(),
      }),
    );
    // The palette's own binding is the only other one on this modifier pair, and
    // the board's shortcuts never take shift.
    ctx.effect(() => {
      const onKeydown = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "b")
          return;
        if (canvasState.focusedChatWorkstreamId === null) return;
        event.preventDefault();
        askSideQuestion();
      };
      window.addEventListener("keydown", onKeydown);
      return () => window.removeEventListener("keydown", onKeydown);
    });

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

export { BoardStore } from "./board.svelte";
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
export {
  type ConnectableRenderer,
  type ConnectPort,
  drawPorts,
  isConnectable,
  portAnchor,
  portAtPoint,
  portCenter,
  portOpacity,
  portReach,
} from "./engine/ports";
export {
  cornerHandlePoints,
  drawCornerHandles,
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
export { planSpawn, type SpawnPlan } from "./spawn";
export { canvasState } from "./state.svelte";
export { stepLines, summariseSteps } from "./steps";
export { type BoardTheme, boardTheme, statusColor, statusWord, themeRevision } from "./theme";
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
