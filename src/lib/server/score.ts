import { AI_GATEWAY_API_KEY, DECISION_MODEL, RERANK_MODEL } from '$app/env/private';
import { RELEVANCE_LEVELS, RELEVANCE_SCALE } from '#lib/server/prompts.ts';
import type { SearchResult } from '#lib/types.ts';

const TIMEOUT_MS = 6000;

const doc = (r: SearchResult) => `${r.title}\n${r.snippet}`;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

async function gateway<T>(fetch: typeof globalThis.fetch, path: string, body: object) {
	const res = await fetch(`https://ai-gateway.vercel.sh${path}`, {
		method: 'POST',
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: {
			Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return (await res.json()) as T;
}

/** Decision model: judges each result's relevance to the query, 0–1. One batch per round. */
async function decide(fetch: typeof globalThis.fetch, query: string, results: SearchResult[]) {
	const input =
		`Search query: ${query}\n\n${RELEVANCE_SCALE}\n\nResults to score:\n\n` +
		results.map((r, i) => `[${i + 1}] ${doc(r)}`).join('\n\n');
	const data = await gateway<{ answers: { name: string; score: number }[] }>(fetch, '/v1/decisions', {
		model: DECISION_MODEL,
		input,
		questions: results.map((_, i) => ({
			type: 'score',
			name: `r${i}`,
			instructions: `How well does result [${i + 1}] satisfy the search query? Score result [${i + 1}] only.`,
			levels: RELEVANCE_LEVELS
		}))
	});
	const max = RELEVANCE_LEVELS.length - 1;
	const scores = new Map(data.answers.map((a) => [a.name, a.score / max]));
	return results.map((_, i) => scores.get(`r${i}`));
}

/** Reranker: scores each document independently, so it is stable across rounds. 0–1. */
async function rerank(fetch: typeof globalThis.fetch, query: string, results: SearchResult[]) {
	if (!RERANK_MODEL) return [];
	const data = await gateway<{ results: { index: number; relevance_score: number }[] }>(
		fetch,
		'/v2/rerank',
		{ model: RERANK_MODEL, query, documents: results.map(doc) }
	);
	const scores: (number | undefined)[] = [];
	for (const r of data.results) scores[r.index] = r.relevance_score;
	return results.map((_, i) => scores[i]);
}

/**
 * Sets `score` (decision model) and, with RERANK_MODEL set, `rerank` on each result in place.
 * If the decision model fails, the rerank score stands in for it. Never throws; leaves results
 * unscored on failure.
 */
export async function scoreResults(
	fetch: typeof globalThis.fetch,
	query: string,
	results: SearchResult[]
) {
	if (!AI_GATEWAY_API_KEY || results.length === 0) return;
	const [decided, reranked] = await Promise.allSettled([
		decide(fetch, query, results),
		rerank(fetch, query, results)
	]);
	if (decided.status === 'rejected') console.error('Decision scoring failed', decided.reason);
	if (reranked.status === 'rejected') console.error('Rerank failed', reranked.reason);
	results.forEach((r, i) => {
		const rr = reranked.status === 'fulfilled' ? reranked.value[i] : undefined;
		const d = decided.status === 'fulfilled' ? decided.value[i] : undefined;
		if (rr !== undefined) r.rerank = round3(rr);
		if (d !== undefined || rr !== undefined) r.score = round3(d ?? rr!);
	});
}

/** Highest score first, rerank breaks ties; unscored results keep their order after scored ones. */
export function byScore(a: SearchResult, b: SearchResult) {
	return (
		(b.score ?? -Infinity) - (a.score ?? -Infinity) ||
		(b.rerank ?? -Infinity) - (a.rerank ?? -Infinity)
	);
}
