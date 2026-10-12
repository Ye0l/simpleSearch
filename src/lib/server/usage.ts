import { spentToday } from '#lib/server/db.ts';
import { UNLIMITED } from '#lib/server/schema.ts';

/** What the client sees of the budget: today's share used, never the amounts. */
export interface Usage {
	/** 0–100, or null without a limit */
	percent: number | null;
}

export function usageOf(user: { id: string; dailyBudget: number }): Usage {
	if (user.dailyBudget === UNLIMITED) return { percent: null };
	if (user.dailyBudget <= 0) return { percent: 100 };
	return { percent: Math.min(100, (spentToday(user.id) / user.dailyBudget) * 100) };
}
