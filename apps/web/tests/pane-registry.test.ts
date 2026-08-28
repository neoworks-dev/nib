import { beforeEach, describe, expect, test } from 'bun:test';
import type { Component } from 'svelte';
import type { PaneKind, PaneLayout, PaneProps } from '@nib-ui/ui-contracts';
import { frameChrome, listLeaves } from '../src/lib/client/layout/frames';
import { PaneAttachments } from '../src/lib/client/registries/attachments';
import { ReactivePaneRegistry, rootPaneId } from '../src/lib/client/registries/panes.svelte';

const component = {} as Component<PaneProps>;

let panes: ReactivePaneRegistry;
let attachments: PaneAttachments;

function register(id: string, kind: PaneKind, title = id) {
	return panes.register({ id, kind, title, component });
}

function leavesOf(instanceId: string): string[] {
	const frame = panes.frameOf(instanceId);
	return frame ? listLeaves(frame.root) : [];
}

beforeEach(() => {
	panes = new ReactivePaneRegistry();
	attachments = new PaneAttachments(panes);
	panes.setBounds({ width: 1200, height: 800 });
	register(rootPaneId, 'canvas', 'Canvas');
	register('git', 'git', 'Git');
	register('files.viewer', 'editor', 'Editor');
	register('chat', 'chat', 'Chat');
});

describe('opening', () => {
	test('an instance gets a frame of its own, and the pane counts as open', () => {
		const instanceId = panes.open('git');

		expect(panes.isOpen('git')).toBe(true);
		expect(panes.isInstanceOpen(instanceId)).toBe(true);
		expect(panes.frames).toHaveLength(1);
		expect(leavesOf(instanceId)).toEqual([instanceId]);
	});

	test('opening again without params reuses the newest instance', () => {
		const first = panes.open('git');

		expect(panes.open('git')).toBe(first);
		expect(panes.instances('git')).toHaveLength(1);
		expect(panes.frames).toHaveLength(1);
	});

	test('params of their own make a second instance of the same pane', () => {
		const first = panes.open('chat', { sessionId: 's1' });
		const second = panes.open('chat', { sessionId: 's2' });

		expect(second).not.toBe(first);
		expect(panes.instances('chat')).toHaveLength(2);
		expect(panes.frames).toHaveLength(2);
	});

	test('the same params reach the instance that already has them', () => {
		const first = panes.open('chat', { sessionId: 's1' });
		panes.open('chat', { sessionId: 's2' });

		expect(panes.open('chat', { sessionId: 's1' })).toBe(first);
		expect(panes.instances('chat')).toHaveLength(2);
	});

	test('a further instance is explicit, never guessed from a repeated call', () => {
		const first = panes.open('chat', { sessionId: 's1' });
		const second = panes.openInstance('chat', { sessionId: 's1' });

		expect(second).not.toBe(first);
		expect(panes.instances('chat')).toHaveLength(2);
	});

	test('the root pane is the shell itself and never becomes a window', () => {
		expect(panes.open(rootPaneId)).toBe(rootPaneId);
		expect(panes.frames).toHaveLength(0);
		expect(panes.isOpen(rootPaneId)).toBe(true);
	});

	test('a new frame is raised and focused', () => {
		panes.open('git');
		const editor = panes.open('files.viewer');

		expect(panes.focusedInstanceId).toBe(editor);
		expect(panes.frames.at(-1)?.frameId).toBe(panes.frameOf(editor)?.frameId);

		panes.focusInstance(panes.instances('git')[0]!.instanceId);
		expect(panes.frames.at(-1)?.frameId).toBe(panes.frameOf(panes.instances('git')[0]!.instanceId)?.frameId);
	});

	test('focus follows the instance that was attached, and survives its neighbour closing', () => {
		const chat = panes.open('chat', { sessionId: 's1' });
		const editor = panes.open('files.viewer');
		panes.attach(editor, chat, 'right');

		expect(panes.focusedInstanceId).toBe(editor);

		panes.closeInstance(editor);
		expect(panes.focusedInstanceId).toBe(chat);
	});
});

describe('re-keying an open instance', () => {
	test('the instance keeps its place and its frame, and answers to the new params', () => {
		const chat = panes.open('chat', { sessionId: 's1' });
		const frameId = panes.frameOf(chat)?.frameId;
		panes.reparam(chat, { sessionId: 's2' });

		expect(panes.instance(chat)?.params).toEqual({ sessionId: 's2' });
		expect(panes.frameOf(chat)?.frameId).toBe(frameId);
		expect(panes.instances('chat')).toHaveLength(1);
	});

	test('opening on the new params reaches it, and on the old ones does not', () => {
		const chat = panes.open('chat', { sessionId: 's1' });
		panes.reparam(chat, { sessionId: 's2' });

		expect(panes.open('chat', { sessionId: 's2' })).toBe(chat);
		expect(panes.open('chat', { sessionId: 's1' })).not.toBe(chat);
	});

	test('what a neighbour reads off it is re-keyed too', () => {
		const chat = panes.open('chat', { sessionId: 's1' });
		const editor = panes.open('files.viewer');
		panes.attach(editor, chat, 'right');
		panes.reparam(chat, { sessionId: 's2' });

		expect(attachments.find(editor, 'chat')?.params).toEqual({ sessionId: 's2' });
	});

	test('dropping the params leaves the instance keyed to nothing in particular', () => {
		const chat = panes.open('chat', { sessionId: 's1' });
		panes.reparam(chat);

		expect(panes.instance(chat)?.params).toBeUndefined();
	});

	test('an instance that is not open is not re-keyed into existence', () => {
		panes.reparam('pane-nowhere', { sessionId: 's1' });

		expect(panes.instances()).toHaveLength(0);
	});
});

describe('closing', () => {
	test('closing the last instance takes its frame with it', () => {
		const instanceId = panes.open('git');
		panes.closeInstance(instanceId);

		expect(panes.frames).toHaveLength(0);
		expect(panes.isOpen('git')).toBe(false);
		expect(panes.focusedInstanceId).toBeNull();
	});

	test('closing by pane id closes every instance of it', () => {
		panes.open('chat', { sessionId: 's1' });
		panes.open('chat', { sessionId: 's2' });
		panes.close('chat');

		expect(panes.instances('chat')).toHaveLength(0);
		expect(panes.frames).toHaveLength(0);
	});

	test('a shared frame survives one of its panes closing', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'right');
		panes.closeInstance(git);

		expect(panes.frames).toHaveLength(1);
		expect(leavesOf(editor)).toEqual([editor]);
	});

	test('toggling opens then closes the pane', () => {
		panes.toggle('git');
		expect(panes.isOpen('git')).toBe(true);
		panes.toggle('git');
		expect(panes.isOpen('git')).toBe(false);
	});

	test('unregistering a pane closes what it had open', () => {
		const dispose = register('scratch', 'terminal');
		panes.open('scratch');
		dispose();

		expect(panes.list().some((entry) => entry.id === 'scratch')).toBe(false);
		expect(panes.frames).toHaveLength(0);
	});
});

describe('attachments', () => {
	test('a pane on its own has no siblings', () => {
		const git = panes.open('git');

		expect(attachments.siblings(git)).toEqual([]);
		expect(attachments.siblings('nobody')).toEqual([]);
	});

	test('attaching brings both panes into one frame', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'right');

		expect(panes.frames).toHaveLength(1);
		expect(leavesOf(git)).toEqual([git, editor]);
		expect(attachments.siblings(git).map((entry) => entry.instanceId)).toEqual([editor]);
	});

	test('a sibling is described by what it is, not by which plugin it is', () => {
		const git = panes.open('git');
		const chat = panes.open('chat', { sessionId: 's1' });
		attachments.attach(chat, git, 'bottom');

		expect(attachments.find(git, 'chat')).toEqual({
			instanceId: chat,
			paneId: 'chat',
			kind: 'chat',
			title: 'Chat',
			params: { sessionId: 's1' },
		});
		expect(attachments.find(git, 'browser')).toBeUndefined();
	});

	test('detaching gives the pane a frame of its own again', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'right');
		attachments.detach(editor);

		expect(panes.frames).toHaveLength(2);
		expect(attachments.siblings(editor)).toEqual([]);
		expect(attachments.siblings(git)).toEqual([]);
	});

	test('detaching a pane that is already alone leaves the layout as it was', () => {
		const git = panes.open('git');
		const frames = panes.frames;
		attachments.detach(git);

		expect(panes.frames).toEqual(frames);
	});

	test('attaching across frames empties the frame the pane came from', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		const chat = panes.open('chat');
		attachments.attach(editor, git, 'right');
		attachments.attach(chat, editor, 'bottom');

		expect(panes.frames).toHaveLength(1);
		expect(leavesOf(git)).toEqual([git, editor, chat]);
	});

	test('a pane can be moved to another edge of the frame it is already in', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'right');
		panes.attachToFrame(editor, panes.frameOf(git)!.frameId, 'left');

		expect(panes.frames).toHaveLength(1);
		expect(leavesOf(git)).toEqual([editor, git]);
	});
});

describe('frame chrome', () => {
	function chromeOf(instanceId: string) {
		return frameChrome(panes.frameOf(instanceId)!.root);
	}

	test('a frame gains its own drag strip when it stops holding a single pane', () => {
		const git = panes.open('git');
		expect(chromeOf(git)).toEqual({ frameBar: false, leafDrag: 'move' });

		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'right');
		expect(chromeOf(git)).toEqual({ frameBar: true, leafDrag: 'detach' });
	});

	test('the pane detached out of a shared frame leaves both frames movable again', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'right');
		attachments.detach(editor);

		expect(chromeOf(git)).toEqual({ frameBar: false, leafDrag: 'move' });
		expect(chromeOf(editor)).toEqual({ frameBar: false, leafDrag: 'move' });
	});

	test('closing back down to one pane takes the strip away again', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		const chat = panes.open('chat');
		attachments.attach(editor, git, 'right');
		attachments.attach(chat, git, 'bottom');
		expect(chromeOf(git).frameBar).toBe(true);

		panes.closeInstance(chat);
		expect(chromeOf(git).frameBar).toBe(true);
		panes.closeInstance(editor);
		expect(chromeOf(git)).toEqual({ frameBar: false, leafDrag: 'move' });
	});

	test('a frame with a strip still moves and still stops at the edge of the area', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'right');
		const frameId = panes.frameOf(git)!.frameId;
		const rect = panes.frame(frameId)!.rect;

		panes.setFrameRect(frameId, { ...rect, x: rect.x + 40, y: rect.y + 40 });
		expect(panes.frame(frameId)!.rect).toMatchObject({ x: rect.x + 40, y: rect.y + 40 });

		panes.setFrameRect(frameId, { ...rect, x: 5000, y: 5000 });
		expect(panes.frame(frameId)!.rect).toMatchObject({ x: 1200 - rect.width, y: 800 - rect.height });
	});
});

describe('layout persistence', () => {
	test('a snapshot round-trips through restore', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		attachments.attach(editor, git, 'bottom');
		const layout = panes.snapshotLayout();

		const reopened = new ReactivePaneRegistry();
		reopened.setBounds({ width: 1200, height: 800 });
		reopened.register({ id: 'git', kind: 'git', title: 'Git', component });
		reopened.register({ id: 'files.viewer', kind: 'editor', title: 'Editor', component });
		reopened.restoreLayout(layout);

		expect(reopened.frames).toHaveLength(1);
		expect(listLeaves(reopened.frames[0]!.root)).toEqual([git, editor]);
		expect(reopened.instances()).toHaveLength(2);
	});

	test('an instance of a pane no build provides is dropped, the rest is kept', () => {
		const git = panes.open('git');
		const editor = panes.open('files.viewer');
		const layout = panes.snapshotLayout();

		const reopened = new ReactivePaneRegistry();
		reopened.register({ id: 'git', kind: 'git', title: 'Git', component });
		reopened.restoreLayout(layout);

		expect(reopened.instances().map((entry) => entry.instanceId)).toEqual([git]);
		expect(reopened.frames).toHaveLength(1);
		expect(reopened.isInstanceOpen(editor)).toBe(false);
	});

	test('a frame off the current bounds is pulled back onto them', () => {
		const instanceId = panes.open('git');
		const layout = panes.snapshotLayout();
		layout.frames[0]!.rect = { x: 5000, y: 4000, width: 600, height: 400 };

		const reopened = new ReactivePaneRegistry();
		reopened.setBounds({ width: 1000, height: 700 });
		reopened.register({ id: 'git', kind: 'git', title: 'Git', component });
		reopened.restoreLayout(layout);

		expect(reopened.frames[0]!.rect).toEqual({ x: 400, y: 300, width: 600, height: 400 });
		expect(reopened.isInstanceOpen(instanceId)).toBe(true);
	});

	test('an empty or missing layout restores to no panes at all', () => {
		panes.open('git');
		panes.restoreLayout(undefined);

		expect(panes.frames).toEqual([]);
		expect(panes.instances()).toEqual([]);

		panes.restoreLayout({ frames: [], instances: [] } as PaneLayout);
		expect(panes.frames).toEqual([]);
	});

	test('a snapshot holds plain values, not live state', () => {
		panes.open('git');
		const layout = panes.snapshotLayout();
		panes.close('git');

		expect(layout.frames).toHaveLength(1);
		expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
	});
});

describe('bounds', () => {
	test('frames follow the area rather than fall off it', () => {
		const instanceId = panes.open('git');
		panes.setFrameRect(panes.frameOf(instanceId)!.frameId, { x: 800, y: 600, width: 380, height: 200 });
		panes.setBounds({ width: 600, height: 500 });

		const rect = panes.frames[0]!.rect;
		expect(rect.x + rect.width).toBeLessThanOrEqual(600);
		expect(rect.y + rect.height).toBeLessThanOrEqual(500);
	});
});
