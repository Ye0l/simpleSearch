import { SESSION_COOKIE } from '#lib/server/auth.ts';
import { setSession } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, cookies }) => {
	if (locals.user) setSession(locals.user.id, null);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return new Response(null, { status: 204 });
};
