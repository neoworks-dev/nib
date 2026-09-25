import type { CanvasRegistry, FileViewerService } from "@nib-ui/ui-contracts";

/**
 * The plugin hands its services to the pane, which slots cannot pass. The project
 * on screen is the board's, so the explorer follows the canvas rather than keeping
 * a directory of its own that could disagree with it.
 */
class ProjectExplorerState {
  canvas = $state<CanvasRegistry | null>(null);
  viewer = $state<FileViewerService | null>(null);

  get cwd(): string {
    return this.canvas?.cwd ?? "";
  }

  reset(): void {
    this.canvas = null;
    this.viewer = null;
  }
}

export const projectExplorerState = new ProjectExplorerState();
