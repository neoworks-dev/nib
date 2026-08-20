const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;

/** Chat-sidebar ages: `now`, `4m`, `2h`, `3d`, `5w`. */
export function formatRelativeTime(timestamp: number, now: number): string {
	const elapsed = Math.max(0, now - timestamp);
	if (elapsed < minute) return 'now';
	if (elapsed < hour) return `${Math.floor(elapsed / minute)}m`;
	if (elapsed < day) return `${Math.floor(elapsed / hour)}h`;
	if (elapsed < week) return `${Math.floor(elapsed / day)}d`;
	return `${Math.floor(elapsed / week)}w`;
}
