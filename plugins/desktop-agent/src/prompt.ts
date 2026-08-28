import type { DetectedRegion } from '@nib-ui/ui-contracts';
import { describeRegion } from './regions';

/**
 * What a capture says when it reaches a harness. The picture travels as an attachment,
 * so this is only the part a model cannot see: which application it is looking at, and
 * where the elements in it are.
 */

export interface DesktopPromptInput {
	/** From the routing rule, where one matched. The portable half of a rule. */
	promptPrefix?: string | null;
	/** What the user typed. */
	text: string;
	/** How the application named itself; omitted when nothing could identify it. */
	applicationName?: string | null;
	regions: readonly DetectedRegion[];
	/** How many regions to name before the list is cut short. */
	limit?: number;
}

export const DEFAULT_REGION_LIMIT = 40;

/**
 * Regions are listed in reading order rather than detection order — top to bottom, then
 * left to right — because a model reading a list of coordinates has no other way to tell
 * what is near what.
 */
export function sortForReading(regions: readonly DetectedRegion[]): DetectedRegion[] {
	return [...regions].sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x);
}

/**
 * Sensitive regions are named but never described: the point of marking a password field
 * is that its contents do not travel, and its position is what makes the rest of the
 * layout make sense.
 */
function regionLines(regions: readonly DetectedRegion[], limit: number): string[] {
	const sorted = sortForReading(regions);
	const shown = sorted.slice(0, limit);
	const lines = shown.map((region) => `- ${region.sensitive ? 'redacted field' : describeRegion(region)}`);
	// Said out loud rather than silently truncated: a list that stops without saying so
	// reads as a complete one.
	if (sorted.length > shown.length) lines.push(`- …and ${sorted.length - shown.length} more`);
	return lines;
}

export function composeDesktopPrompt(input: DesktopPromptInput): string {
	const sections: string[] = [];

	const prefix = input.promptPrefix?.trim();
	if (prefix) sections.push(prefix);

	const name = input.applicationName?.trim();
	sections.push(
		name
			? `This is a screenshot of ${name}, attached below.`
			: 'This is a screenshot of the desktop, attached below.',
	);

	const text = input.text.trim();
	if (text) sections.push(text);

	if (input.regions.length > 0) {
		const lines = regionLines(input.regions, input.limit ?? DEFAULT_REGION_LIMIT);
		sections.push(
			`Elements detected in the screenshot, as \`name — x,y w×h\` in image pixels:\n${lines.join('\n')}`,
		);
	}

	return sections.join('\n\n');
}
