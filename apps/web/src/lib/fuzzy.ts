export interface FuzzyMatch<T> {
	item: T;
	score: number;
}

/**
 * Subsequence match with positional bonuses: consecutive runs and matches that
 * start a path/word segment rank above scattered hits, so `sesh` beats an
 * incidental s-e-s-h spread across an unrelated path.
 */
export function fuzzyScore(candidate: string, query: string): number | null {
	if (query.length === 0) return 0;
	const haystack = candidate.toLowerCase();
	const needle = query.toLowerCase();

	let score = 0;
	let cursor = 0;
	let previousIndex = -1;
	for (const character of needle) {
		const index = haystack.indexOf(character, cursor);
		if (index < 0) return null;
		score += index === previousIndex + 1 ? 8 : 1;
		if (index === 0 || isBoundary(haystack[index - 1])) score += 6;
		previousIndex = index;
		cursor = index + 1;
	}
	// Shorter candidates that used the same characters are the tighter match.
	return score - Math.floor(candidate.length / 12);
}

/** Scores the tail segment too, so a query typed as a filename matches a long path. */
export function fuzzyScorePath(path: string, query: string): number | null {
	const whole = fuzzyScore(path, query);
	const separator = path.lastIndexOf('/');
	const base = separator < 0 ? null : fuzzyScore(path.slice(separator + 1), query);
	if (whole === null && base === null) return null;
	return Math.max(whole ?? Number.NEGATIVE_INFINITY, base === null ? Number.NEGATIVE_INFINITY : base + 10);
}

export function fuzzyRank<T>(
	items: readonly T[],
	query: string,
	toText: (item: T) => string,
	limit = 20,
): FuzzyMatch<T>[] {
	const matches: FuzzyMatch<T>[] = [];
	for (const item of items) {
		const score = fuzzyScorePath(toText(item), query);
		if (score !== null) matches.push({ item, score });
	}
	matches.sort((left, right) => right.score - left.score);
	return matches.slice(0, limit);
}

function isBoundary(character: string | undefined): boolean {
	return character === undefined || character === '/' || character === '-' || character === '_' || character === '.';
}
