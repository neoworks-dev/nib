import { countedNoun, stepPhrase, type StepDescriptor } from '@nib-ui/ui-contracts';

/**
 * What an edge says. Reading a file, searching and running a command are how the
 * agent got from one node to the next, so they belong on the line between them
 * rather than inside either card.
 */
export function summariseSteps(steps: StepDescriptor[]): string {
	const counts = new Map<string, number>();
	for (const step of steps) counts.set(step.noun, (counts.get(step.noun) ?? 0) + 1);
	return [...counts].map(([noun, count]) => countedNoun(count, noun)).join(' · ');
}

/** The same work spelled out, for the hover that expands an edge. */
export function stepLines(steps: StepDescriptor[], limit = 10): string[] {
	const lines = steps.slice(0, limit).map(stepPhrase);
	if (steps.length > limit) lines.push(`+${steps.length - limit} more`);
	return lines;
}
