import type { FileViewerService } from '@nib-ui/ui-contracts';

/** Set while a file viewer is loaded; file names become clickable only then. */
class DiffState {
	viewer = $state<FileViewerService | null>(null);
}

export const diffState = new DiffState();
