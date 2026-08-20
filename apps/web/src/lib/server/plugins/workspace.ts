import type { Plugin } from '@nib-ui/kernel';
import { isDirectory, listDirectories, searchFiles } from '../workspace-probe';
import type { WorkspaceService } from '../services';

const workspace: WorkspaceService = {
	listDirectories: (path) => listDirectories(path),
	searchFiles: (cwd, query, limit) => searchFiles(cwd, query, limit),
	isDirectory,
};

export const workspacePlugin: Plugin = {
	name: 'workspace',
	apply(ctx) {
		ctx.provide('workspace', workspace);
	},
};
