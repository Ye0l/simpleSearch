/**
 * Google-style query operators, shared by the advanced-search UI and the server.
 *
 *   "exact phrase"   -word   -"phrase"   a OR b   site:x.com   -site:x.com
 *   when:1h|1d|1w|1m|1y   after:2026-01-31   before:2026-12-31   lang:ko
 */

export type When = '1h' | '1d' | '1w' | '1m' | '1y';

export interface ParsedQuery {
	/** Plain words */
	terms: string[];
	phrases: string[];
	/** Words joined by OR: at least one must match */
	anyOf: string[];
	exclude: string[];
	sites: string[];
	excludeSites: string[];
	when?: When;
	after?: string;
	before?: string;
	lang?: string;
}

export const WHEN_LABELS: Record<When, string> = {
	'1h': '1시간',
	'1d': '1일',
	'1w': '1주',
	'1m': '1개월',
	'1y': '1년'
};

export const LANGUAGES: Record<string, string> = {
	ko: '한국어',
	en: 'English',
	ja: '日本語',
	zh: '中文',
	de: 'Deutsch',
	fr: 'Français',
	es: 'Español'
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Quotes only count when closed; an unterminated quote is treated as plain text.
const TOKEN = /(-?)(?:(site|when|after|before|lang):)?(?:"([^"]*)"|(\S+))/gi;

export function parseQuery(input: string): ParsedQuery {
	const q: ParsedQuery = {
		terms: [],
		phrases: [],
		anyOf: [],
		exclude: [],
		sites: [],
		excludeSites: []
	};
	const words: { text: string; quoted: boolean }[] = [];

	for (const m of input.matchAll(TOKEN)) {
		const [, neg, op, quoted, bare] = m;
		const value = (quoted ?? bare?.replace(/^"+/, '') ?? '').trim();
		if (!value && quoted === undefined) continue;

		switch (op?.toLowerCase()) {
			case 'site':
				if (value) (neg ? q.excludeSites : q.sites).push(value.toLowerCase());
				continue;
			case 'when':
				if (value in WHEN_LABELS) q.when = value as When;
				continue;
			case 'after':
			case 'before':
				if (DATE.test(value)) q[op.toLowerCase() as 'after' | 'before'] = value;
				continue;
			case 'lang':
				if (value) q.lang = value.toLowerCase();
				continue;
		}
		if (!value || value === '-') continue;
		if (neg) q.exclude.push(value);
		else words.push({ text: value, quoted: quoted !== undefined });
	}

	// OR/AND are operators only between two words. Words chained with OR form the
	// anyOf group; everything else is a term or phrase.
	const isOp = (i: number, op: string) =>
		!words[i].quoted && words[i].text === op && i > 0 && i < words.length - 1;
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		if (isOp(i, 'OR') || isOp(i, 'AND')) continue;
		const chained = (i + 1 < words.length && isOp(i + 1, 'OR')) || (i > 0 && isOp(i - 1, 'OR'));
		if (chained) q.anyOf.push(w.text);
		else (w.quoted ? q.phrases : q.terms).push(w.text);
	}
	return q;
}

const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

export function stringifyQuery(q: ParsedQuery): string {
	return [
		...q.terms,
		...q.phrases.map((p) => `"${p}"`),
		q.anyOf.map(quote).join(' OR '),
		...q.exclude.map((e) => `-${quote(e)}`),
		...q.sites.map((s) => `site:${s}`),
		...q.excludeSites.map((s) => `-site:${s}`),
		q.when && `when:${q.when}`,
		q.after && `after:${q.after}`,
		q.before && `before:${q.before}`,
		q.lang && `lang:${q.lang}`
	]
		.filter(Boolean)
		.join(' ');
}

/** Query without operators — what the LLM and scoring models see. */
export function semanticQuery(q: ParsedQuery): string {
	return [...q.terms, ...q.phrases, ...q.anyOf].join(' ');
}

/** Number of advanced options in use (for the toolbar badge). */
export function countOperators(q: ParsedQuery): number {
	return (
		q.phrases.length +
		(q.anyOf.length ? 1 : 0) +
		q.exclude.length +
		q.sites.length +
		q.excludeSites.length +
		(q.when ? 1 : 0) +
		(q.after || q.before ? 1 : 0) +
		(q.lang ? 1 : 0)
	);
}

export type TokenKind = 'text' | 'space' | 'op' | 'phrase' | 'exclude' | 'or';

const DISPLAY_TOKEN = /(\s+)|(-?(?:site|when|after|before|lang):(?:"[^"]*"?|\S*))|(-?"[^"]*"?)|(\S+)/gi;

/** Splits input for highlighting; only well-formed operators get a non-text kind. */
export function tokenizeQuery(input: string): { text: string; kind: TokenKind }[] {
	const out: { text: string; kind: TokenKind }[] = [];
	const words = [...input.matchAll(DISPLAY_TOKEN)];
	words.forEach((m, i) => {
		const [text, space, op, quoted, bare] = m;
		let kind: TokenKind = 'text';
		if (space) kind = 'space';
		else if (op) {
			const p = parseQuery(op);
			const valid =
				p.sites.length + p.excludeSites.length > 0 || p.when || p.after || p.before || p.lang;
			if (valid) kind = op.startsWith('-') ? 'exclude' : 'op';
		} else if (quoted) {
			const closed = quoted.length > (quoted.startsWith('-') ? 3 : 2) && quoted.endsWith('"');
			if (closed) kind = quoted.startsWith('-') ? 'exclude' : 'phrase';
		} else if (bare) {
			const hasPrev = words.slice(0, i).some((w) => !w[1]);
			const hasNext = words.slice(i + 1).some((w) => !w[1]);
			if ((bare === 'OR' || bare === 'AND') && hasPrev && hasNext) kind = 'or';
			else if (bare.length > 1 && bare.startsWith('-')) kind = 'exclude';
		}
		out.push({ text, kind });
	});
	return out;
}

const fmt = (iso: string) => iso.replaceAll('-', '.');

/** What each operator turns into: a Perplexity API parameter or our own post-filter. */
export function describeQuery(q: ParsedQuery): { label: string; via: string; api: boolean }[] {
	const items: { label: string; via: string; api: boolean }[] = [];
	if (q.when) items.push({ label: `최근 ${WHEN_LABELS[q.when]}`, via: 'search_recency_filter', api: true });
	if (q.after || q.before) {
		const label = `${q.after ? fmt(q.after) : ''} ~ ${q.before ? fmt(q.before) : ''}`.trim();
		items.push(
			q.when
				? { label, via: 'when: 우선으로 무시', api: false }
				: { label, via: 'search_after/before_date_filter', api: true }
		);
	}
	if (q.lang) items.push({ label: LANGUAGES[q.lang] ?? q.lang, via: 'search_language_filter', api: true });
	if (q.sites.length) items.push({ label: q.sites.join(', '), via: 'search_domain_filter (허용)', api: true });
	if (q.excludeSites.length) {
		items.push({
			label: `제외 ${q.excludeSites.join(', ')}`,
			via: q.sites.length ? '결과 후처리' : 'search_domain_filter (제외)',
			api: !q.sites.length
		});
	}
	if (q.phrases.length) {
		items.push({ label: q.phrases.map((p) => `"${p}"`).join(' '), via: '쿼리 가중 + 결과 검증', api: true });
	}
	if (q.anyOf.length) {
		items.push({
			label: q.anyOf.join(' | '),
			via: `multi-query ${Math.min(q.anyOf.length, 5)}개`,
			api: true
		});
	}
	if (q.exclude.length) {
		items.push({ label: q.exclude.map((e) => `-${e}`).join(' '), via: '결과 후처리', api: false });
	}
	return items;
}
