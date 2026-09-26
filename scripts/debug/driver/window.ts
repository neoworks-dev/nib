// The shapes the driver reaches for on the renderer's `window`. Only what is
// used is declared; the app's own types are built for its bundle, not this one.

import type { LayoutNode } from "../snapshot.ts";

export interface ConsoleEntry {
  level: string;
  at: string;
  atMs: number;
  text: string;
}

export interface DebugPaneDefinition {
  id: string;
  kind: string;
  title: string;
}

export interface DebugCanvasObject {
  id: string;
  kind: string;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  [key: string]: unknown;
}

export interface NibWindow {
  __debug_console?: ConsoleEntry[];
  __debug_record?: (level: string, text: string) => void;
  __nib_debug?: {
    panes: {
      definitions: DebugPaneDefinition[];
      openPanes: Array<{ instanceId: string; paneId: string; params?: Record<string, unknown> }>;
      docks: Array<{ edge: string; size: number; root: LayoutNode }>;
      drawer: { size: number; root: LayoutNode } | null;
      sheets: Array<{ sheetId: string; root: LayoutNode }>;
      focusedInstanceId: string | null;
      open(paneId: string): string;
      close(paneId: string): void;
      closeInstance(instanceId: string): void;
    };
    canvas: {
      objects: DebugCanvasObject[];
      vault: { cwd: string };
      registry: {
        camera: { x: number; y: number; zoom: number };
        worldToScreen(x: number, y: number): { x: number; y: number };
      };
    };
  };
}

/** What every renderer-side script says when the app has no debug handle. */
export const MISSING_HANDLE =
  "window.__nib_debug is missing — is this a build from before the debug harness?";
