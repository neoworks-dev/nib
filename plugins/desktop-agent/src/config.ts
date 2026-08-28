import { mergeRoutingConfig, parseRoutingConfig, type RoutingConfig } from './routing';

/**
 * The routing config, over the app's own API rather than through the desktop bridge: it is
 * a file in `~/.config/nib`, and the server already owns that directory. A browser with no
 * desktop bridge can still edit the rules, which is the point of keeping the two apart.
 */
const ROUTE = '/api/desktop-agent/config';

export async function loadRoutingConfig(): Promise<RoutingConfig> {
	try {
		const response = await fetch(ROUTE);
		if (!response.ok) return parseRoutingConfig(null);
		return parseRoutingConfig(await response.json());
	} catch {
		// A config that cannot be read means every application is unknown, and unknown is
		// `ask` — the safe end of the range, so this is a fallback rather than a failure.
		return parseRoutingConfig(null);
	}
}

/**
 * Writes the whole document. The server merges it over what is on disk so a key a newer
 * build wrote survives this one saving, which is why the raw response is re-read rather
 * than the config being assumed to be what was sent.
 */
export async function saveRoutingConfig(config: RoutingConfig): Promise<RoutingConfig> {
	const response = await fetch(ROUTE, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(mergeRoutingConfig({}, config)),
	});
	if (!response.ok) throw new Error(await response.text());
	return parseRoutingConfig(await response.json());
}
