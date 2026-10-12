import { usedToday } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user && {
		id: locals.user.id,
		limit: locals.user.dailyLimit,
		used: usedToday(locals.user.id)
	}
});
