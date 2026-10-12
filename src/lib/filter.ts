import type { SearchResult } from '#lib/types.ts';

/** Client-side filter over the results already fetched. No API calls. */
export interface ResultFilter {
	include: string[];
	exclude: string[];
	hiddenDomains: string[];
	hiddenRounds: number[];
	minScore: number;
	age: Age;
}

export type Age = 'all' | '1w' | '1m' | '1y';

export const AGE_LABELS: Record<Age, string> = {
	all: '전체',
	'1w': '1주 이내',
	'1m': '1개월 이내',
	'1y': '1년 이내'
};

const AGE_DAYS: Record<Exclude<Age, 'all'>, number> = { '1w': 7, '1m': 31, '1y': 366 };

export const emptyFilter = (): ResultFilter => ({
	include: [],
	exclude: [],
	hiddenDomains: [],
	hiddenRounds: [],
	minScore: 0,
	age: 'all'
});

export function hostOf(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export function applyFilter(results: SearchResult[], f: ResultFilter): SearchResult[] {
	const include = f.include.map((s) => s.toLowerCase());
	const exclude = f.exclude.map((s) => s.toLowerCase());
	const minDate = f.age === 'all' ? 0 : Date.now() - AGE_DAYS[f.age] * 86_400_000;

	return results.filter((r) => {
		const text = `${r.title} ${r.snippet}`.toLowerCase();
		if (!include.every((s) => text.includes(s))) return false;
		if (exclude.some((s) => text.includes(s))) return false;
		if (f.hiddenDomains.includes(hostOf(r.url))) return false;
		if (r.round && f.hiddenRounds.includes(r.round)) return false;
		if (f.minScore > 0 && (r.score ?? 0) < f.minScore) return false;
		if (minDate) {
			const t = r.date ? Date.parse(r.date) : NaN;
			if (Number.isNaN(t) || t < minDate) return false;
		}
		return true;
	});
}

export function countFilter(f: ResultFilter): number {
	return (
		f.include.length +
		f.exclude.length +
		f.hiddenDomains.length +
		f.hiddenRounds.length +
		(f.minScore > 0 ? 1 : 0) +
		(f.age !== 'all' ? 1 : 0)
	);
}
