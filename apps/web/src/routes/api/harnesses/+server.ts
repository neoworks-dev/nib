import { json, type RequestHandler } from '@sveltejs/kit';
import { harnesses } from '$lib/server/context';

export const GET: RequestHandler = () => json({ harnesses: harnesses().list() });
