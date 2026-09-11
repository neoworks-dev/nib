import type { DesktopAgentBridge } from "./desktop-agent";

/** The Electron shell injects this bridge; in a plain browser it is absent. */
export interface DesktopBridge {
  platform: string;
  version: string;
  pickDirectory(startIn?: string): Promise<string | null>;
  /**
   * Absent in a build whose main process has no desktop-agent module. Optional
   * rather than always present, so a browser and a build without it are the same
   * nullish check rather than two states to handle.
   */
  desktopAgent?: DesktopAgentBridge;
}

declare global {
  interface Window {
    nibDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | null {
  return typeof window === "undefined" ? null : (window.nibDesktop ?? null);
}
