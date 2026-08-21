import type { Plugin } from '@nib-ui/kernel';
import { commit, diff, log, stage, status, unstage } from '../git-cli';
import type { GitService } from '../services';

const git: GitService = { status, diff, stage, unstage, commit, log };

export const gitPlugin: Plugin = {
	name: 'git',
	apply(ctx) {
		ctx.provide('git', git);
	},
};
