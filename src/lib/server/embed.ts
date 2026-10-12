import { AI_GATEWAY_API_KEY, EMBEDDING_MODEL } from '$app/env/private';
import type { SearchResult } from '#lib/types.ts';

const TIMEOUT_MS = 4000;

/** Embeds texts via AI Gateway. Never throws: returns null on failure or without a key. */
export async function embed(
	fetch: typeof globalThis.fetch,
	texts: string[]
): Promise<number[][] | null> {
	if (!AI_GATEWAY_API_KEY || texts.length === 0) return null;
	try {
		const res = await fetch('https://ai-gateway.vercel.sh/v1/embeddings', {
			method: 'POST',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: {
				Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts })
		});
		if (!res.ok) {
			console.error('Embedding failed', res.status, await res.text());
			return null;
		}
		const data: { data: { index: number; embedding: number[] }[] } = await res.json();
		return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
	} catch (e) {
		console.error('Embedding failed', e);
		return null;
	}
}

function cosine(a: number[], b: number[]) {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return dot / Math.sqrt(na * nb);
}

/** Sets `score` on each result in place. Leaves results unscored if embedding fails. */
export async function scoreResults(
	fetch: typeof globalThis.fetch,
	queryVec: Promise<number[] | null>,
	results: SearchResult[]
) {
	const [q, docs] = await Promise.all([
		queryVec,
		embed(
			fetch,
			results.map((r) => `${r.title}\n${r.snippet}`)
		)
	]);
	if (!q || !docs) return;
	results.forEach((r, i) => (r.score = Math.round(cosine(q, docs[i]) * 1000) / 1000));
}

/** Highest score first; unscored results keep their order after scored ones. */
export function byScore(a: SearchResult, b: SearchResult) {
	return (b.score ?? -Infinity) - (a.score ?? -Infinity);
}
