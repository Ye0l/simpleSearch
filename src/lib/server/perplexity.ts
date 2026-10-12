import {
	PERPLEXITY_API_KEY,
	PERPLEXITY_COUNTRY,
	PERPLEXITY_MAX_RESULTS,
	PERPLEXITY_MAX_TOKENS_PER_PAGE,
	PERPLEXITY_SEARCH_TYPE
} from '$app/env/private';
import type { ParsedQuery, When } from '#lib/query.ts';
import type { Meter } from '#lib/server/meter.ts';
import type { SearchResult } from '#lib/types.ts';

const SNIPPET_MAX = 320;
/** Perplexity's search_domain_filter limit */
const MAX_DOMAIN_FILTER = 20;

/** Strips markdown syntax only, so `max_results`, `C#` or `a | b` in prose survive. */
function clean(snippet: string) {
	const text = snippet
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/gm, '')
		.replace(/^\s*\|(.*)\|\s*$/gm, (_, row: string) => row.split('|').join(' · '))
		.replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+\.)\s+/gm, '')
		.replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX).trimEnd() + '…' : text;
}

function domain(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}

/** Key for de-duplicating results: ignores scheme, www, hash, trailing slash and tracking params. */
export function urlKey(url: string) {
	try {
		const u = new URL(url);
		for (const p of [...u.searchParams.keys()]) {
			if (/^(utm_|fbclid$|gclid$|ref$)/.test(p)) u.searchParams.delete(p);
		}
		u.searchParams.sort();
		const search = u.searchParams.toString();
		const path = u.pathname.replace(/\/+$/, '');
		return `${u.hostname.replace(/^www\./, '')}${path}${search ? `?${search}` : ''}`.toLowerCase();
	} catch {
		return url;
	}
}

/** Most frequent domains among `results`, capped to the filter limit. */
export function seenDomains(results: SearchResult[]): string[] {
	const counts = new Map<string, number>();
	for (const r of results) {
		const d = domain(r.url);
		if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_DOMAIN_FILTER)
		.map(([d]) => d);
}

const RECENCY: Record<When, string> = {
	'1h': 'hour',
	'1d': 'day',
	'1w': 'week',
	'1m': 'month',
	'1y': 'year'
};

/** 2026-01-31 → 1/31/2026 (the API's date format) */
const apiDate = (iso: string) => {
	const [y, m, d] = iso.split('-').map(Number);
	return `${m}/${d}/${y}`;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

/**
 * Operators the API can't enforce (phrases, exclusions, OR, -site:) are checked here
 * against the raw title + snippet, before the snippet is shortened for display.
 */
function matches(q: ParsedQuery, title: string, snippet: string, url: string) {
	const text = norm(`${title} ${snippet}`);
	const host = domain(url) ?? '';
	return (
		q.phrases.every((p) => text.includes(norm(p))) &&
		!q.exclude.some((e) => text.includes(norm(e))) &&
		(q.anyOf.length === 0 || q.anyOf.some((a) => text.includes(norm(a)))) &&
		!q.excludeSites.some((s) => host === s || host.endsWith(`.${s}`))
	);
}

export interface SearchOptions {
	/** Several queries are sent as one multi-query request (billed once) */
	query: string | string[];
	parsed: ParsedQuery;
	/** Extra domains to exclude, e.g. ones seen in earlier rounds */
	excludeDomains?: string[];
	signal?: AbortSignal;
	/** Charged once the request succeeds */
	meter?: Meter;
}

export async function search(
	fetch: typeof globalThis.fetch,
	{ query, parsed, excludeDomains = [], signal, meter }: SearchOptions
): Promise<SearchResult[]> {
	if (!PERPLEXITY_API_KEY) throw new Error('PERPLEXITY_API_KEY is not set');

	// Allow and deny lists can't be mixed; with site: the -site: check happens in matches().
	const domainFilter = parsed.sites.length
		? parsed.sites.slice(0, MAX_DOMAIN_FILTER)
		: [...new Set([...parsed.excludeSites, ...excludeDomains])]
				.slice(0, MAX_DOMAIN_FILTER)
				.map((d) => `-${d}`);

	const res = await fetch('https://api.perplexity.ai/search', {
		method: 'POST',
		signal,
		headers: {
			Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			query,
			search_type: PERPLEXITY_SEARCH_TYPE,
			max_results: PERPLEXITY_MAX_RESULTS,
			max_tokens_per_page: PERPLEXITY_MAX_TOKENS_PER_PAGE,
			country: PERPLEXITY_COUNTRY,
			search_domain_filter: domainFilter.length ? domainFilter : undefined,
			// Recency and date ranges can't be combined; when: wins.
			search_recency_filter: parsed.when && RECENCY[parsed.when],
			search_after_date_filter: !parsed.when && parsed.after ? apiDate(parsed.after) : undefined,
			search_before_date_filter: !parsed.when && parsed.before ? apiDate(parsed.before) : undefined,
			search_language_filter: parsed.lang ? [parsed.lang] : undefined
		})
	});

	if (!res.ok) {
		console.error('Perplexity search failed', res.status, await res.text());
		throw new Error(`Search provider error (${res.status})`);
	}
	meter?.search();

	const data: { results: (SearchResult & { last_updated?: string | null })[] } = await res.json();

	return data.results
		.filter((r) => matches(parsed, r.title, r.snippet ?? '', r.url))
		.map((r) => ({
			title: r.title,
			url: r.url,
			snippet: clean(r.snippet ?? ''),
			date: r.date ?? r.last_updated ?? null
		}));
}
