import { error } from '@sveltejs/kit';
import { addCost, saveReport, startSearch } from '#lib/server/db.ts';
import { Meter } from '#lib/server/meter.ts';
import { research } from '#lib/server/research.ts';
import type { ResearchEvent } from '#lib/types.ts';
import type { RequestHandler } from './$types';

/**
 * Streams an AI search as NDJSON ResearchEvents and saves it as a report when done.
 * Its estimated API cost is charged to today's budget, like a normal search.
 */
export const GET: RequestHandler = ({ url, fetch, locals, request }) => {
	const topic = url.searchParams.get('q')?.trim();
	if (!topic) error(400, '주제를 입력하세요');

	const user = locals.user!;
	if (!startSearch(user.id, user.dailyBudget)) error(429, '오늘 사용 한도를 다 썼어요. 자정에 초기화돼요');
	const meter = new Meter();

	const signal = request.signal;
	const started = performance.now();
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const log: ResearchEvent[] = [];
			const send = (event: ResearchEvent) => {
				// Saved reports keep the document as one delta.
				const last = log.at(-1);
				if (event.type === 'delta' && last?.type === 'delta') last.text += event.text;
				else log.push(event.type === 'delta' ? { ...event } : event);
				if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
			};
			try {
				await research(fetch, topic, send, signal, meter);
				const id = saveReport(locals.clientId, topic, log);
				send({ type: 'done', id, ms: Math.round(performance.now() - started) });
			} catch (e) {
				if (!signal.aborted) {
					console.error('AI search failed', e);
					send({ type: 'error', message: (e as Error).message });
				}
			} finally {
				addCost(user.id, meter.micros);
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
			'X-Accel-Buffering': 'no'
		}
	});
};
