import { error, json, type RequestHandler } from '@sveltejs/kit';
import { boards } from '$lib/server/context';

interface ReviewRequest {
	cwd?: unknown;
	workstreamId?: unknown;
	reviewed?: unknown;
}

/**
 * Marks a workstream read. It is a server write rather than a board edit because
 * the project list can mark a workstream in a board no window has open.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { cwd, workstreamId, reviewed } = (await request.json()) as ReviewRequest;
	if (typeof cwd !== 'string' || cwd.length === 0) error(400, 'cwd is required');
	if (typeof workstreamId !== 'string' || workstreamId.length === 0) error(400, 'workstreamId is required');

	try {
		return json(await boards().reviewWorkstream(cwd, workstreamId, reviewed !== false));
	} catch (cause) {
		error(404, cause instanceof Error ? cause.message : 'the workstream is gone');
	}
};
