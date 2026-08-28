import type { SessionView } from '@nib-ui/protocol';
import { handoverSeed, HANDOVER_BUDGET } from './transcript';

/** What switching harness would do, worked out before anything is created. */
export interface HarnessSwitchPlan {
	fromSessionId: string;
	fromHarnessId: string | null;
	toHarnessId: string;
	/** The new session runs where the old one ran; a switch never moves the work. */
	cwd: string;
	/** First prompt of the new session: the old transcript, replayed as text. */
	seed: string;
	/** Turns being replayed and what they cost as prompt, for the confirmation. */
	turns: number;
	characters: number;
}

/**
 * Two harnesses share nothing but the working directory, so a switch is a new
 * session seeded with the old transcript rather than a setting on this one. It is
 * refused when there is nothing to move to or nowhere to run: the same harness,
 * an empty id, or a session whose directory the client never learned.
 */
export function planHarnessSwitch(
	session: SessionView,
	toHarnessId: string,
	budget = HANDOVER_BUDGET,
): HarnessSwitchPlan | null {
	if (toHarnessId.length === 0 || toHarnessId === session.harnessId) return null;
	const cwd = session.cwd;
	if (!cwd || cwd.length === 0) return null;

	const seed = handoverSeed(session, budget);
	return {
		fromSessionId: session.sessionId,
		fromHarnessId: session.harnessId,
		toHarnessId,
		cwd,
		seed,
		turns: session.messages.filter((message) => message.blocks.length > 0).length,
		characters: seed.length,
	};
}

export interface HarnessSwitchConfirmation {
	title: string;
	body: string;
	confirmLabel: string;
	cancelLabel: string;
}

/**
 * The user is paying for this: the dialog says outright that the whole
 * conversation is re-sent as text and charged again, in the words a bill would
 * use, not in a hint.
 */
export function describeHarnessSwitch(plan: HarnessSwitchPlan, toName: string): HarnessSwitchConfirmation {
	return {
		title: `Switch this conversation to ${toName}?`,
		body: [
			`${toName} has not seen any of this conversation and cannot be given it any other way.`,
			`Switching starts a new task on ${toName} in the same directory and replays the entire transcript into its first prompt as plain text — ${countOf(plan.turns, 'turn')}, ${plan.characters.toLocaleString('en-US')} characters. You are charged input tokens for every one of them, and the new harness may answer differently from the old one.`,
			'This task is left exactly as it is and stays in the task list.',
		].join('\n\n'),
		confirmLabel: `Replay and switch to ${toName}`,
		cancelLabel: 'Keep this harness',
	};
}

function countOf(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
