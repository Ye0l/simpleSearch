import type { Handle } from '@sveltejs/kit/hooks';

// Anonymous per-browser id used to scope search history.
export const handle: Handle = async ({ event, resolve }) => {
	let sid = event.cookies.get('sid');
	if (!sid) {
		sid = crypto.randomUUID();
		event.cookies.set('sid', sid, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});
	}
	event.locals.clientId = sid;
	return resolve(event);
};
