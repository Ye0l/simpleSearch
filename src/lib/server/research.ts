import { AI_GATEWAY_API_KEY, RESEARCH_MODEL, RESEARCH_PROVIDERS } from '$app/env/private';
import { search, urlKey } from '#lib/server/perplexity.ts';
import {
	PLAN_SCHEMA,
	PLAN_SYSTEM,
	REVIEW_SCHEMA,
	REVIEW_SYSTEM,
	WRITE_SYSTEM
} from '#lib/server/prompts.ts';
import { parseQuery } from '#lib/query.ts';
import type { Meter } from '#lib/server/meter.ts';
import type { ResearchEvent, Source } from '#lib/types.ts';

type Fetch = typeof globalThis.fetch;
type Message = { role: 'system' | 'user'; content: string };

const MAX_ROUNDS = 3;
const QUERIES_PER_ROUND = 3;
/** Results per query handed to the reviewer */
const PER_QUERY = 8;
const JSON_TIMEOUT_MS = 45_000;
const WRITE_TIMEOUT_MS = 180_000;

function request(fetch: Fetch, body: object, signal: AbortSignal, timeout: number) {
	return fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
		method: 'POST',
		signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
		headers: {
			Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: RESEARCH_MODEL,
			reasoning: { enabled: false },
			...(RESEARCH_PROVIDERS.length && {
				providerOptions: { gateway: { only: RESEARCH_PROVIDERS } }
			}),
			...body
		})
	});
}

async function chatJSON<T>(
	fetch: Fetch,
	name: string,
	schema: object,
	messages: Message[],
	signal: AbortSignal,
	meter: Meter
): Promise<T> {
	const res = await request(
		fetch,
		{
			messages,
			response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
			max_tokens: 4000
		},
		signal,
		JSON_TIMEOUT_MS
	);
	if (!res.ok) throw new Error(`AI 요청 실패 (${res.status})`);
	const data = await res.json();
	await meter.chat(RESEARCH_MODEL, data.usage);
	const content: string = data.choices?.[0]?.message?.content ?? '';
	return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

/** Streams the completion's text deltas (OpenAI-style SSE). */
async function* chatStream(fetch: Fetch, messages: Message[], signal: AbortSignal, meter: Meter) {
	const res = await request(
		fetch,
		{ messages, stream: true, stream_options: { include_usage: true }, max_tokens: 6000 },
		signal,
		WRITE_TIMEOUT_MS
	);
	if (!res.ok || !res.body) throw new Error(`AI 요청 실패 (${res.status})`);
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		let nl: number;
		while ((nl = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line.startsWith('data:')) continue;
			const payload = line.slice(5).trim();
			if (payload === '[DONE]') return;
			const chunk = JSON.parse(payload);
			if (chunk.usage) await meter.chat(RESEARCH_MODEL, chunk.usage);
			const text = chunk.choices?.[0]?.delta?.content;
			if (text) yield text as string;
		}
	}
}

const strings = (list: unknown, limit: number) =>
	(Array.isArray(list) ? list : [])
		.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
		.map((s) => s.trim())
		.slice(0, limit);

const sourceLine = (s: Source) =>
	`[${s.id}] ${s.title}\n${s.url}${s.date ? ` (${s.date})` : ''}\n${s.snippet}`;

/**
 * Plans queries, then searches and reviews for up to MAX_ROUNDS until the reviewer judges
 * the criteria covered, then streams a cited Markdown document. Every step goes out
 * through `send`. Throws on failures that leave nothing to write from.
 */
export async function research(
	fetch: Fetch,
	topic: string,
	send: (event: ResearchEvent) => void,
	signal: AbortSignal,
	meter: Meter
) {
	if (!AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY가 설정되지 않았어요');

	const plan = await chatJSON<{ goal: string; criteria: string[]; queries: string[] }>(
		fetch,
		'plan',
		PLAN_SCHEMA,
		[
			{ role: 'system', content: PLAN_SYSTEM },
			{ role: 'user', content: topic }
		],
		signal,
		meter
	);
	const goal = String(plan.goal ?? topic);
	const criteria = strings(plan.criteria, 5);
	let queries = strings(plan.queries, QUERIES_PER_ROUND);
	if (queries.length === 0) queries = [topic];
	send({ type: 'plan', goal, criteria, queries });

	const sources = new Map<number, Source>();
	const seen = new Set<string>();
	const used: string[] = [];
	const picked = new Set<number>();
	const notes: string[] = [];

	for (let round = 1; round <= MAX_ROUNDS && queries.length; round++) {
		send({ type: 'searching', round, queries });
		used.push(...queries);

		const fresh: Source[] = [];
		const settled = await Promise.allSettled(
			queries.map(async (query) => {
				const results = await search(fetch, { query, parsed: parseQuery(query), signal, meter });
				const batch: Source[] = [];
				for (const r of results) {
					if (batch.length === PER_QUERY) break;
					const k = urlKey(r.url);
					if (seen.has(k)) continue;
					seen.add(k);
					const source = { id: seen.size, ...r };
					sources.set(source.id, source);
					batch.push(source);
				}
				fresh.push(...batch);
				send({ type: 'results', round, query, sources: batch });
			})
		);
		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
		const failed = settled.find((s) => s.status === 'rejected');
		if (fresh.length === 0) {
			if (failed && sources.size === 0) throw (failed as PromiseRejectedResult).reason;
			break;
		}

		send({ type: 'reviewing', round });
		const review = await chatJSON<{
			picked: { id: number; reason: string }[];
			notes: string[];
			covered: number[];
			enough: boolean;
			missing: string;
			next: string[];
		}>(
			fetch,
			'review',
			REVIEW_SCHEMA,
			[
				{ role: 'system', content: REVIEW_SYSTEM },
				{
					role: 'user',
					content:
						`Goal: ${goal}\n\nCriteria:\n${criteria.map((c, i) => `${i}. ${c}`).join('\n')}\n\n` +
						`Queries already used: ${used.join(' | ')}\n\n` +
						`Notes so far:\n${notes.length ? notes.join('\n') : '(none)'}\n\n` +
						`New search results:\n\n${fresh.map(sourceLine).join('\n\n')}`
				}
			],
			signal,
			meter
		);

		const newPicks = (Array.isArray(review.picked) ? review.picked : []).filter(
			(p) => sources.has(p.id) && !picked.has(p.id)
		);
		newPicks.forEach((p) => picked.add(p.id));
		const newNotes = strings(review.notes, 20);
		notes.push(...newNotes);
		const last = round === MAX_ROUNDS;
		const next = review.enough || last ? [] : strings(review.next, QUERIES_PER_ROUND);
		send({
			type: 'review',
			round,
			picked: newPicks.map((p) => ({ id: p.id, reason: String(p.reason ?? '') })),
			notes: newNotes,
			covered: (Array.isArray(review.covered) ? review.covered : []).filter(
				(i) => Number.isInteger(i) && i >= 0 && i < criteria.length
			),
			enough: !!review.enough,
			missing: review.enough ? '' : String(review.missing ?? ''),
			next
		});
		queries = next.filter((q) => !used.includes(q));
	}

	// Picks plus anything the notes cite; without either, everything found.
	for (const note of notes) {
		for (const [, id] of note.matchAll(/\[(\d+)\]/g)) if (sources.has(+id)) picked.add(+id);
	}
	const cited = [...(picked.size ? picked : sources.keys())]
		.sort((a, b) => a - b)
		.map((id) => sources.get(id)!);
	if (cited.length === 0) throw new Error('쓸 만한 검색 결과를 찾지 못했어요');

	send({ type: 'writing' });
	const stream = chatStream(
		fetch,
		[
			{ role: 'system', content: WRITE_SYSTEM },
			{
				role: 'user',
				content:
					`Topic: ${topic}\nGoal: ${goal}\n\nCriteria:\n${criteria.map((c) => `- ${c}`).join('\n')}\n\n` +
					`Notes:\n${notes.join('\n') || '(none)'}\n\nSources:\n\n${cited.map(sourceLine).join('\n\n')}`
			}
		],
		signal,
		meter
	);
	for await (const text of stream) send({ type: 'delta', text });
}
