import type { Disposer } from "@nib-ui/kernel";
import { canvasState } from "@nib-ui/plugin-canvas";
import { assetUrl, fitSize, type MediaObject } from "@nib-ui/plugin-canvas-media";
import {
  type ApplicationIdentity,
  type CanvasRegistry,
  type CaptureRequest,
  type DesktopAgentBridge,
  type DesktopAgentService,
  type DesktopCapabilities,
  type DetectedRegion,
  describeCapabilities,
  desktopBridge,
  type SessionsService,
  type SidecarState,
} from "@nib-ui/ui-contracts";
import { loadRoutingConfig, saveRoutingConfig } from "./config";
import { detectInAsset } from "./detect-client";
import {
  type DesktopRegionsObject,
  parseDesktopRegions,
  REGIONS_KIND,
  regionsFor,
} from "./objects";
import { composeDesktopPrompt } from "./prompt";
import { REGIONS_LAYER_ID, RegionsLayer } from "./RegionsLayer";
import { clipToImage, imageToLayout, layoutToImage, mergeRegions } from "./regions";
import { emptyRoutingConfig, type RoutingConfig, resolveRouting } from "./routing";

/** A capture waiting for the user to say yes. Held rather than resolved so the pane can ask. */
interface PendingCapture {
  request: CaptureRequest;
  settle: (allowed: boolean) => void;
}

let counter = 0;

function createId(prefix: string): string {
  counter += 1;
  return `${prefix}:${Date.now().toString(36)}:${counter.toString(36)}`;
}

/**
 * What the renderer knows about the desktop, and everything it can do with it.
 *
 * Nothing here is an agent loop. A capture becomes a `media` object on the board that is
 * open, and sending one starts an ordinary session through `HarnessRegistry` — the same
 * pipeline a typed prompt goes through.
 *
 * Every capability comes through the preload bridge, which is absent in a plain browser and
 * in an Electron build whose main process has no desktop-agent module: one nullish check,
 * one disabled state.
 */
class DesktopState implements DesktopAgentService {
  capabilities = $state<DesktopCapabilities | null>(null);
  sidecar = $state<SidecarState>({ status: "stopped" });
  busy = $state(false);
  error = $state<string | null>(null);
  /** Something that happened and is worth saying, but is not a failure. */
  notice = $state<string | null>(null);
  /** What has focus on the desktop right now, for the routing readout. */
  focused = $state<ApplicationIdentity | null>(null);
  routing = $state<RoutingConfig>(emptyRoutingConfig);
  pending = $state<PendingCapture | null>(null);
  /** Capture id the overlay is currently drawing, so the pane can offer to stop. */
  overlaid = $state<string | null>(null);
  /** Epoch millis the arming window closes at; zero while disarmed. */
  private armedUntil = $state(0);
  private now = $state(0);

  private bridge: DesktopAgentBridge | null = null;
  private canvas: CanvasRegistry | null = null;
  private sessions: SessionsService | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  get available(): boolean {
    return this.bridge !== null;
  }

  get armed(): boolean {
    return this.armedUntil > this.now;
  }

  /** Seconds left in the arming window, for the pane to count down. */
  get armedSeconds(): number {
    return Math.max(0, Math.ceil((this.armedUntil - this.now) / 1000));
  }

  /**
   * With no project open there is no board to place a capture on and no `cwd` for a
   * session to run in. That is the app's ordinary "open a project first" state, not an
   * error path.
   */
  get canCapture(): boolean {
    return this.captureBlocker === null;
  }

  /** Why a capture cannot be taken, or null when it can. See `overlayBlocker`. */
  get captureBlocker(): string | null {
    if (!this.bridge)
      return "Desktop control needs the desktop app; a browser has no access to the screen.";
    if (this.sidecar.status !== "ready") {
      return this.sidecar.detail ?? "The nib-overlay sidecar is not running. Start it below.";
    }
    if (this.capabilities?.capture === "unavailable") {
      return "Nothing on this machine can take a screenshot: neither the desktop portal nor grim answered.";
    }
    if (!this.canvas || this.canvas.cwd.length === 0) {
      return "Open a project first: a capture goes on that project’s board.";
    }
    return null;
  }

  /** True once a capture is on the board and can be pointed at on the screen. */
  canOverlay(objectId: string): boolean {
    return this.overlayBlocker(objectId) === null;
  }

  /**
   * Why the overlay cannot be drawn for this capture, or null when it can.
   *
   * Every one of these is a dead end the user cannot see from the outside — a missing
   * binary, a compositor that would not say where the picture came from, a detection that
   * has not been run. A greyed-out button with no reason beside it is the same as a
   * broken one.
   */
  overlayBlocker(objectId: string): string | null {
    if (!this.bridge) return "The overlay needs the desktop app.";
    if (this.capabilities?.overlay === "unavailable") {
      return this.capabilities.notes[0] ?? "This compositor cannot place an overlay.";
    }
    const stored = this.regionsOf(objectId);
    if (!stored) return "This picture was not captured by the desktop agent.";
    if (stored.regions.length === 0)
      return "Run “Find elements” first: there is nothing to point at yet.";
    if (!stored.layout) {
      return "The compositor did not say which part of the screen this picture came from, so it cannot be pointed at.";
    }
    return null;
  }

  attach(canvas: CanvasRegistry, sessions: SessionsService): Disposer {
    this.canvas = canvas;
    this.sessions = sessions;
    this.bridge = desktopBridge()?.desktopAgent ?? null;
    this.now = Date.now();

    void loadRoutingConfig().then((config) => {
      this.routing = config;
    });

    if (!this.bridge) {
      this.capabilities = describeCapabilities({ bridge: false, sidecarResolved: false });
      return () => this.detach();
    }

    const unsubscribeState = this.bridge.onSidecarState((state) => {
      this.sidecar = state;
    });
    const unsubscribeFocus = this.bridge.onFocus((application) => {
      this.focused = application;
    });
    // The arming window has to expire on its own, and a clock nothing advances would
    // leave it open until the next unrelated state change re-read it.
    this.timer = setInterval(() => {
      this.now = Date.now();
    }, 1000);

    // Arming must not survive the app losing focus: the window the user armed for is
    // the one they were looking at.
    const onBlur = () => this.disarm();
    window.addEventListener("blur", onBlur);

    void this.start();

    return () => {
      unsubscribeState();
      unsubscribeFocus();
      window.removeEventListener("blur", onBlur);
      this.detach();
    };
  }

  async start(): Promise<void> {
    if (!this.bridge || this.busy) return;
    this.busy = true;
    try {
      this.capabilities = await this.bridge.start();
      if (this.capabilities.focus !== "unavailable") {
        await this.bridge.watchFocus();
        this.focused = await this.bridge.focusedApplication();
      }
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.bridge || this.busy) return;
    this.busy = true;
    try {
      await this.bridge.stop();
      this.capabilities = await this.bridge.capabilities();
      this.focused = null;
      this.overlaid = null;
    } finally {
      this.busy = false;
    }
  }

  arm(minutes: number): void {
    this.armedUntil = Date.now() + Math.max(1, minutes) * 60_000;
    this.now = Date.now();
  }

  disarm(): void {
    this.armedUntil = 0;
  }

  /** Answers the confirmation the pane is showing. */
  resolvePending(allowed: boolean): void {
    const pending = this.pending;
    this.pending = null;
    pending?.settle(allowed);
  }

  /**
   * Captures, uploads and places the picture on the open board.
   *
   * The confirmation lives here rather than in the pane, so a capture asked for by a
   * command, a context menu or another plugin is gated the same way the button is.
   */
  async capture(request: CaptureRequest): Promise<string | null> {
    const canvas = this.canvas;
    if (!this.bridge || !canvas) return null;
    this.error = null;

    if (canvas.cwd.length === 0) {
      this.error = "Open a project before capturing: a capture goes on the board.";
      return null;
    }

    // Evaluated before the shutter, against what has focus now: a denied application
    // must not be photographed and then discarded.
    const decision = resolveRouting(this.focused, this.routing);
    if (decision.policy === "deny") {
      this.error = `${this.focused?.appId ?? "This application"} is on the deny list, so it is not captured.`;
      return null;
    }

    if (!this.armed && !(await this.confirm(request))) return null;

    this.busy = true;
    try {
      const result = await this.bridge.capture(request);
      if (!result) {
        this.error =
          "The capture did not happen: the desktop refused it, or no capture tool answered.";
        return null;
      }

      const size = fitSize(result.width, result.height, 480);
      const at = canvas.screenToWorld(120, 120);
      const captureId = createId("media");
      canvas.addObject({
        kind: "media",
        id: captureId,
        x: Math.round(at.x),
        y: Math.round(at.y),
        assetId: result.assetId,
        mediaType: "image",
        w: size.width,
        h: size.height,
        name: `desktop-${new Date(result.takenAt || Date.now()).toISOString().slice(0, 19)}.png`,
      } satisfies MediaObject);

      // The identity and the layout box belong to the moment of capture; by send time
      // focus has moved on, and re-querying then would route to the wrong application.
      canvas.addObject({
        kind: REGIONS_KIND,
        id: createId("desktop-regions"),
        captureObjectId: captureId,
        imageWidth: result.width,
        imageHeight: result.height,
        regions: [],
        detectedAt: 0,
        ...(result.application && { application: result.application }),
        ...(result.layout && { layout: result.layout }),
      } satisfies DesktopRegionsObject);

      this.notice =
        result.redacted > 0
          ? `${result.redacted} password field${result.redacted === 1 ? " was" : "s were"} blacked out before the picture was stored.`
          : null;
      canvas.select([captureId]);
      return captureId;
    } finally {
      this.busy = false;
    }
  }

  private confirm(request: CaptureRequest): Promise<boolean> {
    return new Promise<boolean>((settle) => {
      this.pending = { request, settle };
    });
  }

  /**
   * Both detectors over one capture. The accessibility tree answers for whatever has
   * focus *now*, which is why detection is worth running while the same window is still
   * up — the pane says so rather than pretending the two are always the same.
   */
  async detect(objectId: string): Promise<DetectedRegion[]> {
    const canvas = this.canvas;
    const media = this.mediaOf(objectId);
    const stored = this.regionsOf(objectId);
    if (!canvas || !media || !stored) return [];

    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const pixel = await detectInAsset(assetUrl(media.assetId));

      let accessible: DetectedRegion[] = [];
      if (this.bridge && stored.layout) {
        const layout = stored.layout;
        accessible = clipToImage(
          (await this.bridge.accessibleRegions()).flatMap((region) => {
            const rect = layoutToImage(layout, stored.imageWidth, stored.imageHeight, region.rect);
            return rect ? [{ ...region, rect }] : [];
          }),
          stored.imageWidth,
          stored.imageHeight,
        );
      }

      const regions = mergeRegions(accessible, pixel);
      canvas.updateObject(stored.id, { regions, detectedAt: Date.now() });
      if (regions.length === 0) {
        this.error =
          "Nothing was found in this capture: no accessibility tree, and no shapes with enough contrast.";
      }
      return regions;
    } finally {
      this.busy = false;
    }
  }

  /** Draws the capture's regions on the desktop itself, where they were found. */
  async showOverlay(objectId: string): Promise<void> {
    const stored = this.regionsOf(objectId);
    if (!this.bridge || !stored?.layout) return;
    const layout = stored.layout;

    const regions = stored.regions.flatMap((region) => {
      const rect = imageToLayout(layout, stored.imageWidth, stored.imageHeight, region.rect);
      // A password field is redacted in the picture; pointing a highlight at it on
      // the screen would put back exactly what the redaction took out.
      if (!rect || region.sensitive) return [];
      return [{ rect, tone: "accent" as const, ...(region.label && { label: region.label }) }];
    });

    const shown = await this.bridge.showOverlay({
      regions,
      ...(this.capabilities?.pointer !== "unavailable" && {
        pointer: { radius: 22, tone: "muted" as const },
      }),
    });
    this.overlaid = shown ? objectId : null;
    if (!shown)
      this.error = "The compositor refused a layer surface, so the overlay cannot be drawn.";
  }

  async hideOverlay(): Promise<void> {
    this.overlaid = null;
    await this.bridge?.hideOverlay();
  }

  /**
   * Routes a capture into an ordinary harness session on the open board.
   *
   * The picture is linked to the new task rather than described in it, so it travels as
   * an attachment the way a dropped image does. Nothing here is a second session store
   * and nothing is a second event channel: the reply arrives on the existing stream.
   */
  async sendToHarness(objectId: string, text: string): Promise<string | null> {
    const canvas = this.canvas;
    const sessions = this.sessions;
    const media = this.mediaOf(objectId);
    const stored = this.regionsOf(objectId);
    if (!canvas || !sessions || !media) return null;
    this.error = null;

    const identity = stored?.application ?? null;
    const decision = resolveRouting(identity, this.routing);
    if (decision.policy === "deny") {
      this.error = `${identity?.appId ?? "This application"} is on the deny list, so nothing was sent.`;
      return null;
    }

    const prompt = composeDesktopPrompt({
      text,
      regions: stored?.regions ?? [],
      ...(decision.promptPrefix && { promptPrefix: decision.promptPrefix }),
      ...(applicationName(identity) && { applicationName: applicationName(identity)! }),
    });

    // The card and its `context` edge are the board's own vocabulary for "this task was
    // started from that object", which is what `canvasState.assetCard` writes.
    const workstreamId = canvasState.assetCard([objectId]);
    if (!workstreamId) {
      this.error = "The capture could not be linked to a task.";
      return null;
    }
    canvas.updateObject(workstreamId, { goal: text.trim() || "Desktop capture" });

    const harnessId = decision.harnessId ?? undefined;
    // `canvas-media` answers what a picture is worth to a task; going around it would
    // mean a second opinion on how an attachment is spelled.
    const attachments = canvas.contextFor(media)?.attachments ?? [];

    this.busy = true;
    try {
      const before = sessions.activeId;
      await sessions.create({
        ...(harnessId ? { harnessId } : { harnessId: sessions.harnesses[0]?.id ?? "" }),
        cwd: canvas.cwd,
        ...(decision.options &&
          Object.keys(decision.options).length > 0 && { options: decision.options }),
      });
      const sessionId = sessions.activeId;
      if (!sessionId || sessionId === before) {
        this.error = sessions.error ?? "The session could not be started.";
        return null;
      }
      canvas.updateObject(workstreamId, { sessionId });
      sessions.watch(sessionId);
      await sessions.sendTo(sessionId, prompt, attachments);
      return sessionId;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Registers the layer that draws regions over their capture, and keeps it in step with
   * the board. An effect rather than a per-frame tick: `canvas.objects` is reactive, so
   * the drawing is recomputed when the board changes and at no other time.
   */
  mountLayer(canvas: CanvasRegistry): Disposer {
    const layer = new RegionsLayer(canvas);
    const unregister = canvas.registerLayer({
      id: REGIONS_LAYER_ID,
      container: layer.container,
      order: 1,
    });
    const stopEffect = $effect.root(() => {
      $effect(() => layer.sync());
    });
    return () => {
      stopEffect();
      unregister();
      layer.destroy();
    };
  }

  async updateRouting(config: RoutingConfig): Promise<void> {
    this.routing = config;
    await saveRoutingConfig(config);
  }

  /** The rule that would apply to whatever has focus, for the settings section to show. */
  get focusedDecision() {
    return resolveRouting(this.focused, this.routing);
  }

  private mediaOf(objectId: string): MediaObject | null {
    const object = this.canvas?.objects.find((entry) => entry.id === objectId);
    if (!object || object.kind !== "media" || typeof object.assetId !== "string") return null;
    return object as MediaObject;
  }

  regionsOf(objectId: string): DesktopRegionsObject | null {
    return this.canvas ? regionsFor(this.canvas.objects, objectId) : null;
  }

  /** Every capture on the open board, newest first, for the pane's picker. */
  get captures(): { id: string; regions: DesktopRegionsObject }[] {
    const objects = this.canvas?.objects ?? [];
    return objects
      .flatMap((object) => {
        const parsed = parseDesktopRegions(object);
        return parsed ? [{ id: parsed.captureObjectId, regions: parsed }] : [];
      })
      .reverse();
  }

  /**
   * Toggling the plugin off has to leave no process behind, so disposal stops the sidecar
   * rather than only dropping the reference to it.
   */
  private detach(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.resolvePending(false);
    this.error = null;
    this.notice = null;
    void this.bridge?.hideOverlay();
    void this.bridge?.stop();
    this.bridge = null;
    this.canvas = null;
    this.sessions = null;
    this.capabilities = null;
    this.focused = null;
    this.overlaid = null;
    this.sidecar = { status: "stopped" };
    this.armedUntil = 0;
    this.busy = false;
  }
}

/** What to call the application in a prompt, in order of how much it means to a person. */
export function applicationName(identity: ApplicationIdentity | null): string | null {
  if (!identity) return null;
  return identity.atspiName ?? identity.appId ?? identity.desktopEntry ?? null;
}

export const desktopState = new DesktopState();
