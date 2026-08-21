import { isAbsolute, resolve } from 'node:path';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { sessionCwd } from '$lib/server/session-cwd';

const maxBytes = 1_000_000;

/** Reads one file from the session's workspace; paths outside it are refused. */
export const GET: RequestHandler = async ({ params, url }) => {
	const cwd = sessionCwd(params.id!);
	if (!cwd) error(404, `unknown session "${params.id}"`);

	const requested = url.searchParams.get('path');
	if (!requested) error(400, 'path is required');

	const absolute = isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested);
	if (absolute !== cwd && !absolute.startsWith(`${cwd}/`)) error(403, 'path is outside the workspace');

	const file = Bun.file(absolute);
	if (!(await file.exists())) error(404, `no such file "${requested}"`);
	if (file.size > maxBytes) error(413, `file is larger than ${maxBytes} bytes`);

	return json({ path: absolute.slice(cwd.length + 1), size: file.size, text: await file.text() });
};
