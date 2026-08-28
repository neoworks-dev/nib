import type { ApplicationIdentity } from '@nib-ui/ui-contracts';

/**
 * Which harness, model and tools a desktop capture is routed to, decided by the
 * application that had focus when it was taken. Stored in
 * `$XDG_CONFIG_HOME/nib/desktop-agent.json`, beside the config the app already writes.
 */

/** `ask` confirms each capture; `allow` skips the dialog while armed; `deny` blocks it. */
export type CapturePolicy = 'allow' | 'ask' | 'deny';

export interface ApplicationMatch {
	/** Compositor `app_id`. A trailing `.` is treated as a prefix, e.g. `org.mozilla.`. */
	appId?: string;
	atspiName?: string;
	desktopEntry?: string;
}

export interface RoutingRule {
	match: ApplicationMatch;
	policy: CapturePolicy;
	harnessId?: string | null;
	model?: string | null;
	/** Prepended to the prompt. The portable half: every adapter honours plain text. */
	promptPrefix?: string;
	/**
	 * Adapter-specific create options, merged into `CreateSessionInput.options`. The
	 * Claude Code adapter spreads these into the SDK, so `mcpServers`, `agents` and
	 * `systemPrompt` reach the model unchanged; an adapter that knows none of these keys
	 * ignores them, which is why `promptPrefix` exists alongside.
	 */
	options?: Record<string, unknown>;
	skill?: string;
}

export interface RoutingDefault {
	policy: CapturePolicy;
	harnessId: string | null;
}

export interface RoutingConfig {
	version: 1;
	default: RoutingDefault;
	applications: RoutingRule[];
}

export const emptyRoutingConfig: RoutingConfig = {
	version: 1,
	default: { policy: 'ask', harnessId: null },
	applications: [],
};

/**
 * Specificity, most specific first. A rule matching on a more precise field outranks one
 * matching on a looser field regardless of where either sits in the list, so adding a
 * broad rule can never shadow a precise one that was already there.
 */
export const MATCH_LEVELS = [
	'desktopEntry',
	'appId',
	'appIdPrefix',
	'atspiName',
	'atspiSubstring',
	'wildcard',
] as const;

export type MatchLevel = (typeof MATCH_LEVELS)[number];

export interface RoutingDecision {
	policy: CapturePolicy;
	harnessId: string | null;
	model: string | null;
	promptPrefix: string | null;
	options: Record<string, unknown>;
	skill: string | null;
	/** Null when nothing matched and the default was used; shown in the settings section. */
	matchedBy: MatchLevel | null;
	rule: RoutingRule | null;
}

function levelOf(match: ApplicationMatch, identity: ApplicationIdentity): MatchLevel | null {
	const appId = identity.appId ?? '';
	const atspiName = (identity.atspiName ?? '').toLowerCase();

	if (match.desktopEntry && identity.desktopEntry && match.desktopEntry === identity.desktopEntry) return 'desktopEntry';
	if (match.appId && appId.length > 0) {
		if (match.appId === appId) return 'appId';
		if (match.appId.endsWith('.') && appId.startsWith(match.appId)) return 'appIdPrefix';
	}
	if (match.atspiName && atspiName.length > 0) {
		const wanted = match.atspiName.toLowerCase();
		if (wanted === atspiName) return 'atspiName';
		if (atspiName.includes(wanted)) return 'atspiSubstring';
	}
	if (match.appId === '*' || match.atspiName === '*' || match.desktopEntry === '*') return 'wildcard';
	return null;
}

/**
 * The rule that governs this application.
 *
 * A `deny` wins outright wherever it matches, however loosely: a rule that says "never
 * capture my password manager" must not be defeated by a more specific `allow` written
 * later, because the failure mode is a screenshot of a vault rather than a missing
 * feature.
 */
export function resolveRouting(identity: ApplicationIdentity | null, config: RoutingConfig): RoutingDecision {
	const fallback: RoutingDecision = {
		policy: config.default.policy,
		harnessId: config.default.harnessId,
		model: null,
		promptPrefix: null,
		options: {},
		skill: null,
		matchedBy: null,
		rule: null,
	};
	if (!identity) return fallback;

	let best: { rule: RoutingRule; level: MatchLevel } | null = null;
	for (const rule of config.applications) {
		const level = levelOf(rule.match, identity);
		if (!level) continue;
		if (rule.policy === 'deny') {
			best = { rule, level };
			break;
		}
		if (!best || MATCH_LEVELS.indexOf(level) < MATCH_LEVELS.indexOf(best.level)) best = { rule, level };
	}
	if (!best) return fallback;

	const { rule, level } = best;
	return {
		policy: rule.policy,
		harnessId: rule.harnessId ?? config.default.harnessId,
		model: rule.model ?? null,
		promptPrefix: rule.promptPrefix ?? null,
		options: rule.options ?? {},
		skill: rule.skill ?? null,
		matchedBy: level,
		rule,
	};
}

const POLICIES = new Set<CapturePolicy>(['allow', 'ask', 'deny']);

function parsePolicy(raw: unknown, fallback: CapturePolicy): CapturePolicy {
	return typeof raw === 'string' && POLICIES.has(raw as CapturePolicy) ? (raw as CapturePolicy) : fallback;
}

function parseMatch(raw: unknown): ApplicationMatch | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Record<string, unknown>;
	const match: ApplicationMatch = {
		...(typeof candidate.appId === 'string' && candidate.appId.length > 0 && { appId: candidate.appId }),
		...(typeof candidate.atspiName === 'string' && candidate.atspiName.length > 0 && { atspiName: candidate.atspiName }),
		...(typeof candidate.desktopEntry === 'string' &&
			candidate.desktopEntry.length > 0 && { desktopEntry: candidate.desktopEntry }),
	};
	// A rule that matches on nothing would match everything the moment a field was
	// misspelled, which is the one mistake that must not silently widen a policy.
	return Object.keys(match).length > 0 ? match : null;
}

/**
 * Defensive load — the file is hand-editable. A malformed rule is dropped rather than
 * defaulted, because a rule the user cannot see is worse than one that is missing.
 */
export function parseRoutingConfig(raw: unknown): RoutingConfig {
	if (!raw || typeof raw !== 'object') return emptyRoutingConfig;
	const candidate = raw as Record<string, unknown>;

	const fallback = candidate.default;
	const defaults: RoutingDefault = {
		policy: 'ask',
		harnessId: null,
	};
	if (fallback && typeof fallback === 'object') {
		const entry = fallback as Record<string, unknown>;
		defaults.policy = parsePolicy(entry.policy, 'ask');
		defaults.harnessId = typeof entry.harnessId === 'string' ? entry.harnessId : null;
	}

	const applications: RoutingRule[] = [];
	const rules = Array.isArray(candidate.applications) ? candidate.applications : [];
	for (const entry of rules) {
		if (!entry || typeof entry !== 'object') continue;
		const rule = entry as Record<string, unknown>;
		const match = parseMatch(rule.match);
		if (!match) continue;
		applications.push({
			match,
			policy: parsePolicy(rule.policy, 'ask'),
			...(typeof rule.harnessId === 'string' && { harnessId: rule.harnessId }),
			...(typeof rule.model === 'string' && { model: rule.model }),
			...(typeof rule.promptPrefix === 'string' && { promptPrefix: rule.promptPrefix }),
			...(rule.options && typeof rule.options === 'object' && !Array.isArray(rule.options)
				? { options: rule.options as Record<string, unknown> }
				: {}),
			...(typeof rule.skill === 'string' && { skill: rule.skill }),
		});
	}

	return { version: 1, default: defaults, applications };
}

/**
 * Serialises without dropping keys a newer build wrote. The same discipline
 * `mergeUserConfig` uses: an older build must not eat a field it does not understand.
 */
export function mergeRoutingConfig(raw: unknown, next: RoutingConfig): Record<string, unknown> {
	const existing = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return { ...existing, version: 1, default: next.default, applications: next.applications };
}
