import type {
  ApplicationIdentity,
  CaptureRequest,
  CaptureResult,
  DesktopAgentBridge,
  DesktopCapabilities,
  DetectedRegion,
  OverlaySpec,
  PointerSample,
  SidecarState,
} from "@nib-ui/ui-contracts/desktop-agent";
import { contextBridge, ipcRenderer } from "electron";
import { desktopAgentChannels } from "../main/desktop-agent/channels";

/**
 * Subscribes to a pushed channel and hands back the unsubscribe. The Electron event
 * object never crosses the bridge: the renderer gets the payload alone.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const desktopAgent: DesktopAgentBridge = {
  capabilities: () =>
    ipcRenderer.invoke(desktopAgentChannels.capabilities) as Promise<DesktopCapabilities>,
  start: () => ipcRenderer.invoke(desktopAgentChannels.start) as Promise<DesktopCapabilities>,
  stop: () => ipcRenderer.invoke(desktopAgentChannels.stop) as Promise<void>,
  capture: (request: CaptureRequest) =>
    ipcRenderer.invoke(desktopAgentChannels.capture, request) as Promise<CaptureResult | null>,
  focusedApplication: () =>
    ipcRenderer.invoke(
      desktopAgentChannels.focusedApplication,
    ) as Promise<ApplicationIdentity | null>,
  accessibleRegions: () =>
    ipcRenderer.invoke(desktopAgentChannels.accessibleRegions) as Promise<DetectedRegion[]>,
  showOverlay: (spec: OverlaySpec) =>
    ipcRenderer.invoke(desktopAgentChannels.showOverlay, spec) as Promise<boolean>,
  hideOverlay: () => ipcRenderer.invoke(desktopAgentChannels.hideOverlay) as Promise<void>,
  watchFocus: () => ipcRenderer.invoke(desktopAgentChannels.watchFocus) as Promise<void>,
  onPointer: (listener) => subscribe<PointerSample>(desktopAgentChannels.pointerEvent, listener),
  onFocus: (listener) => subscribe<ApplicationIdentity>(desktopAgentChannels.focusEvent, listener),
  onSidecarState: (listener) =>
    subscribe<SidecarState>(desktopAgentChannels.sidecarStateEvent, listener),
};

// The renderer is served over HTTP and talks to the SvelteKit API directly, so the
// bridge only carries what the browser cannot do: native dialogs, shell identity, and
// the desktop agent, every method of which is one `invoke` or one `on`.
contextBridge.exposeInMainWorld("nibDesktop", {
  platform: process.platform,
  version: process.versions.electron,
  pickDirectory: (startIn?: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pickDirectory", startIn),
  desktopAgent,
});
