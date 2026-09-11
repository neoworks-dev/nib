import type { FileViewerService } from "@nib-ui/ui-contracts";

/** The plugin hands the viewer service to its component, which slots cannot pass. */
class FileBrowserState {
  viewer = $state<FileViewerService | null>(null);
}

export const fileBrowserState = new FileBrowserState();
