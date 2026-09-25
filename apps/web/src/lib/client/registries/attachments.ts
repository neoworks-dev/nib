import type { AttachmentsService, PaneAttachment, PaneEdge, PaneKind } from "@nib-ui/ui-contracts";
import { listLeaves } from "../layout/tree";
import type { ReactivePaneRegistry } from "./panes.svelte";

/**
 * What a pane is sitting next to, over the pane registry. Every read goes
 * straight to registry state, so a `$derived` in a pane re-runs when the layout
 * moves under it; there is nothing to subscribe to.
 */
export class PaneAttachments implements AttachmentsService {
  constructor(private readonly panes: ReactivePaneRegistry) {}

  siblings(instanceId: string): PaneAttachment[] {
    const dock = this.panes.dockOf(instanceId);
    if (!dock) return [];
    return listLeaves(dock.root)
      .filter((leaf) => leaf !== instanceId)
      .map((leaf) => this.panes.attachment(leaf))
      .filter((attachment): attachment is PaneAttachment => attachment !== undefined);
  }

  find(instanceId: string, kind: PaneKind): PaneAttachment | undefined {
    return this.siblings(instanceId).find((attachment) => attachment.kind === kind);
  }

  attach(instanceId: string, targetInstanceId: string, edge: PaneEdge): void {
    this.panes.attach(instanceId, targetInstanceId, edge);
  }

  detach(instanceId: string): void {
    this.panes.detach(instanceId);
  }
}
