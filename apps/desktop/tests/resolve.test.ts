import { describe, expect, test } from 'bun:test';
import { resolveSidecar, SIDECAR_NAME, SIDECAR_OVERRIDE_VARIABLE } from '../src/main/desktop-agent/resolve';

/** Stands in for the filesystem: these paths hold an executable, nothing else does. */
function present(...paths: string[]): (candidate: string) => boolean {
	const set = new Set(paths);
	return (candidate) => set.has(candidate);
}

describe('the override', () => {
	test('is used when it points at an executable', () => {
		const resolution = resolveSidecar({ [SIDECAR_OVERRIDE_VARIABLE]: '/opt/nib/overlay' }, present('/opt/nib/overlay'));
		expect(resolution).toEqual({ executable: '/opt/nib/overlay', detail: null });
	});

	test('is reported rather than ignored when it does not resolve', () => {
		const resolution = resolveSidecar(
			{ [SIDECAR_OVERRIDE_VARIABLE]: '/opt/nib/overlay', PATH: '/usr/bin' },
			present(`/usr/bin/${SIDECAR_NAME}`),
		);
		// Falling back to $PATH here would silently run a different binary than the one
		// the variable named.
		expect(resolution.executable).toBeNull();
		expect(resolution.detail).toContain('/opt/nib/overlay');
	});

	test('an empty override is not an override', () => {
		const resolution = resolveSidecar(
			{ [SIDECAR_OVERRIDE_VARIABLE]: '', PATH: '/usr/bin' },
			present(`/usr/bin/${SIDECAR_NAME}`),
		);
		expect(resolution.executable).toBe(`/usr/bin/${SIDECAR_NAME}`);
	});
});

describe('the PATH scan', () => {
	test('takes the first directory that has the binary', () => {
		const resolution = resolveSidecar(
			{ PATH: '/usr/bin:/home/me/.local/bin' },
			present(`/usr/bin/${SIDECAR_NAME}`, `/home/me/.local/bin/${SIDECAR_NAME}`),
		);
		expect(resolution.executable).toBe(`/usr/bin/${SIDECAR_NAME}`);
	});

	test('steps over a directory that does not have it', () => {
		const resolution = resolveSidecar({ PATH: '/usr/bin:/home/me/.local/bin' }, present(`/home/me/.local/bin/${SIDECAR_NAME}`));
		expect(resolution.executable).toBe(`/home/me/.local/bin/${SIDECAR_NAME}`);
	});

	test('skips the empty entries a trailing colon leaves behind', () => {
		const probed: string[] = [];
		resolveSidecar({ PATH: '/usr/bin::' }, (candidate) => {
			probed.push(candidate);
			return false;
		});
		expect(probed).toEqual([`/usr/bin/${SIDECAR_NAME}`]);
	});

	test.each([
		['no PATH at all', {}],
		['an empty PATH', { PATH: '' }],
	])('says how to build it when there is %s', (_name, env) => {
		const resolution = resolveSidecar(env, () => false);
		expect(resolution.executable).toBeNull();
		expect(resolution.detail).toContain('task build:overlay');
	});
});
