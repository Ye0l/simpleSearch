import { json, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, hashToken } from '#lib/server/auth.ts';
import { accountBySession } from '#lib/server/db.ts';

const isPublic = (path: string) => path === '/login' || path.startsWith('/api/auth/');

// Everything except the login page requires an account.
export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const account = token ? accountBySession(hashToken(token)) : null;
	const path = event.url.pathname;

	if (account) {
		event.locals.user = { id: account.id, dailyLimit: account.dailyLimit };
		event.locals.clientId = account.id;
		if (path === '/login') redirect(303, '/');
	} else if (!isPublic(path)) {
		// The client reloads on 401, so the page request below explains why.
		if (path.startsWith('/api/')) {
			return json({ message: '로그인이 필요해요' }, { status: 401 });
		}
		// A cookie that matches no session was replaced by a login elsewhere.
		if (token) event.cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, token ? '/login?reason=taken' : '/login');
	}
	return resolve(event);
};
