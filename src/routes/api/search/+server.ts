import { error } from '@sveltejs/kit';
import { consumeSearch, saveSearch } from '#lib/server/db.ts';
import { expand } from '#lib/server/expand.ts';
import { search, seenDomains, urlKey } from '#lib/server/perplexity.ts';
import { byScore, scoreResults } from '#lib/server/score.ts';
import { thumbnails } from '#lib/server/thumbnail.ts';
import { hostOf } from '#lib/filter.ts';
import { parseQuery, semanticQuery } from '#lib/query.ts';
import type { Round, SearchEvent, SearchResult } from '#lib/types.ts';
import type { RequestHandler } from './$types';

const ROUNDS = 3;

/**
 * Streams NDJSON SearchEvents. Round 1 searches the raw query while the LLM expands it
 * in parallel; rounds 2–3 run sequentially on the variants, excluding domains already
 * seen. Duplicate URLs are dropped here. Each round is scored (decision model + reranker)
 * before it is sent; scoring overlaps with the next round's search.
 * Thumbnails are fetched alongside and follow their round as a separate event.
 */
export const GET: RequestHandler = ({ url, fetch, locals, request }) => {
	const q = url.searchParams.get('q')?.trim();
	if (!q) error(400, 'Missing query');

	const parsed = parseQuery(q);
	const semantic = semanticQuery(parsed);
	if (!semantic) error(400, '검색어를 입력하세요');

	// One search (all rounds) counts once against the daily limit.
	const user = locals.user!;
	const used = consumeSearch(user.id, user.dailyLimit);
	if (used === null) error(429, `오늘 검색 한도(${user.dailyLimit}회)를 다 썼어요`);

	// Phrases stay in the query text (the API boosts them); OR becomes a multi-query.
	const base = [...parsed.terms, ...parsed.phrases.map((p) => `"${p}"`)].join(' ');
	const firstQuery = parsed.anyOf.length
		? parsed.anyOf.slice(0, 5).map((a) => `${base} ${a}`.trim())
		: base;
	const withPhrases = (variant: string) =>
		[variant, ...parsed.phrases.filter((p) => !variant.includes(p)).map((p) => `"${p}"`)].join(' ');

	const signal = request.signal;
	const started = performance.now();
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: SearchEvent) => {
				if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
			};

			const all: SearchResult[] = [];
			const rounds: Round[] = [];
			const seen = new Set<string>();
			const add = (results: SearchResult[]) => {
				// Same URL, or the same title on the same site (one article under several paths).
				const fresh = results.filter((r) => {
					const keys = [urlKey(r.url), `${hostOf(r.url)}|${r.title.trim().toLowerCase()}`];
					if (keys.some((k) => seen.has(k))) return false;
					keys.forEach((k) => seen.add(k));
					return true;
				});
				all.push(...fresh);
				return fresh;
			};
			// Keeps events in order while scoring runs in the background.
			let outbox = Promise.resolve();
			const queue = (event: () => Promise<SearchEvent>) => {
				outbox = outbox.then(async () => send(await event()));
			};
			const pendingImages: Promise<void>[] = [];

			const runRound = async (round: number, sent: string | string[], exclude: string[]) => {
				const results = add(
					await search(fetch, { query: sent, parsed, excludeDomains: exclude, signal })
				);
				results.forEach((r) => (r.round = round));
				const query = Array.isArray(sent) ? sent.join(' | ') : sent;
				rounds.push({ query, count: results.length });
				const scoring = scoreResults(fetch, semantic, results);
				const images = thumbnails(results, signal);
				queue(async () => {
					await scoring;
					return { type: 'results', round, query, results };
				});
				const queued = outbox;
				pendingImages.push(
					Promise.all([images, queued]).then(([found]) => {
						if (Object.keys(found).length === 0) return;
						for (const r of results) r.image = found[r.url];
						send({ type: 'images', images: found });
					})
				);
			};

			try {
				const expansion = expand(fetch, semantic);

				await runRound(1, firstQuery, []);

				const { variants, related } = await expansion;
				queue(async () => ({ type: 'expansion', variants, related }));

				// Without variants (no key / LLM failure), fall back to the raw query.
				// A failed later round keeps what we already have.
				try {
					for (let round = 2; round <= ROUNDS; round++) {
						const variant = variants[round - 2];
						// With site: the allowlist already narrows domains, so only URLs are de-duplicated.
						await runRound(
							round,
							variant ? withPhrases(variant) : firstQuery,
							parsed.sites.length ? [] : seenDomains(all)
						);
					}
				} catch (e) {
					if (signal.aborted) throw e;
					console.error('Search round failed', e);
				}

				await outbox;
				await Promise.all(pendingImages);
				const id = saveSearch(locals.clientId, q, all.sort(byScore), { variants, related }, rounds);
				send({ type: 'done', id, ms: Math.round(performance.now() - started) });
			} catch (e) {
				if (!signal.aborted) send({ type: 'error', message: (e as Error).message });
			} finally {
				try {
					controller.close();
				} catch {}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Accel-Buffering': 'no',
			'X-Quota-Used': String(used)
		}
	});
};
