import { AI_GATEWAY_API_KEY, AI_MODEL } from '$app/env/private';
import type { Meter } from '#lib/server/meter.ts';
import type { Expansion } from '#lib/types.ts';
import { EXPANSION_SCHEMA, EXPANSION_SYSTEM } from './prompts.ts';

const TIMEOUT_MS = 5000;

function clean(list: unknown, exclude: string[], limit: number): string[] {
	if (!Array.isArray(list)) return [];
	const seen = new Set(exclude.map((s) => s.toLowerCase()));
	const out: string[] = [];
	for (const item of list) {
		if (typeof item !== 'string') continue;
		const s = item.trim();
		if (!s || seen.has(s.toLowerCase())) continue;
		seen.add(s.toLowerCase());
		out.push(s);
		if (out.length === limit) break;
	}
	return out;
}

/** Generates query variants + related searches. Never throws: returns empty lists on failure. */
export async function expand(
	fetch: typeof globalThis.fetch,
	query: string,
	meter: Meter
): Promise<Expansion> {
	const empty: Expansion = { variants: [], related: [] };
	if (!AI_GATEWAY_API_KEY) return empty;

	try {
		const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
			method: 'POST',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: {
				Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: AI_MODEL,
				messages: [
					{ role: 'system', content: EXPANSION_SYSTEM },
					{ role: 'user', content: query }
				],
				response_format: {
					type: 'json_schema',
					json_schema: { name: 'expansion', strict: true, schema: EXPANSION_SCHEMA }
				},
				reasoning: { enabled: false },
				max_tokens: 400
			})
		});
		if (!res.ok) {
			console.error('Query expansion failed', res.status, await res.text());
			return empty;
		}
		const data = await res.json();
		await meter.chat(AI_MODEL, data.usage);
		const content: string = data.choices?.[0]?.message?.content ?? '';
		const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
		const variants = clean(parsed.variants, [query], 2);
		return { variants, related: clean(parsed.related, [query, ...variants], 6) };
	} catch (e) {
		console.error('Query expansion failed', e);
		return empty;
	}
}
