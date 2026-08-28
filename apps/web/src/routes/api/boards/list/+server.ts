import { json, type RequestHandler } from '@sveltejs/kit';
import { boards } from '$lib/server/context';

/** The project list: every board on disk with the workstreams it holds. */
export const GET: RequestHandler = async () => json({ boards: await boards().list() });
