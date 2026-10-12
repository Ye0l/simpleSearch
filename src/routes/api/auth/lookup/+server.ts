import { error, json } from '@sveltejs/kit';
import { normalizeId } from '#lib/server/auth.ts';
import { getAccount } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** First login step: tells the form whether to ask for a password or create one. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const account = getAccount(normalizeId(body?.id));
	if (!account) error(404, '등록되지 않은 아이디예요');
	return json({ next: account.passwordHash ? 'password' : 'create' });
};
