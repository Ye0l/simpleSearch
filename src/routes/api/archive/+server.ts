import { error, json } from '@sveltejs/kit';
import { archiveResult, archiveSearch, listArchive } from '#lib/server/db.ts';
import type { SearchResult } from '#lib/types.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json(listArchive(locals.clientId));

const isUrl = (u: unknown, protocols = ['http:', 'https:']) => {
	try {
		return typeof u === 'string' && protocols.includes(new URL(u).protocol);
	} catch {
		return false;
	}
};
const text = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');

/**
 * `{ searchId }` archives a stored results page; `{ query, result }` archives one result.
 * Responds with the new archive id.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.searchId === 'number') {
		const id = archiveSearch(locals.clientId, body.searchId);
		if (id === null) error(404, 'Search not found');
		return json({ id }, { status: 201 });
	}
	const r = body?.result;
	// Only http(s) links are stored: they are rendered as hrefs and image sources.
	if (!isUrl(r?.url)) error(400, 'Invalid result');
	const result: SearchResult = {
		title: text(r.title, 500),
		url: r.url,
		snippet: text(r.snippet, 1000),
		date: typeof r.date === 'string' ? r.date : null,
		score: typeof r.score === 'number' ? r.score : undefined,
		image: isUrl(r.image, ['https:']) ? r.image : undefined
	};
	return json({ id: archiveResult(locals.clientId, text(body.query, 500), result) }, { status: 201 });
};
