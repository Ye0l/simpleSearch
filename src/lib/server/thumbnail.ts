import type { SearchResult } from '#lib/types.ts';

const TIMEOUT_MS = 3000;
/** Stop reading after this much HTML if </head> hasn't shown up */
const MAX_HTML = 300_000;
const KEYS = ['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src'];

const attr = (tag: string, name: string) =>
	tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'is'))?.[2];

/** YouTube blocks page fetches, but its thumbnails follow a fixed URL pattern. */
function youtube(url: string) {
	const u = new URL(url);
	const host = u.hostname.replace(/^(www|m)\./, '');
	const id =
		host === 'youtu.be'
			? u.pathname.slice(1)
			: host === 'youtube.com'
				? (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1])
				: undefined;
	return id && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
}

/** Reads the page head and returns its og:image (or twitter:image) as an absolute https URL. */
async function thumbnail(url: string, signal?: AbortSignal): Promise<string | undefined> {
	try {
		const yt = youtube(url);
		if (yt) return yt;
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		const res = await fetch(url, {
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; simpleSearch/0.1)', Accept: 'text/html' }
		});
		if (!res.ok || !res.body || !res.headers.get('content-type')?.includes('html')) {
			await res.body?.cancel();
			return;
		}
		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let html = '';
		while (html.length < MAX_HTML && !/<\/head>/i.test(html)) {
			const { value, done } = await reader.read();
			if (done) break;
			html += value;
		}
		reader.cancel().catch(() => {});

		const found = new Map<string, string>();
		for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
			const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
			const content = attr(tag, 'content');
			if (key && content && KEYS.includes(key) && !found.has(key)) found.set(key, content);
		}
		const raw = KEYS.map((k) => found.get(k)).find(Boolean);
		if (!raw) return;
		// https only, so a page served over https never loads mixed content.
		const image = new URL(raw.replaceAll('&amp;', '&').trim(), res.url);
		return image.protocol === 'https:' ? image.href : undefined;
	} catch {
		return;
	}
}

/** Thumbnails for the results that have one, keyed by result URL. Never throws. */
export async function thumbnails(results: SearchResult[], signal?: AbortSignal) {
	const images = await Promise.all(results.map((r) => thumbnail(r.url, signal)));
	return Object.fromEntries(
		results.flatMap((r, i) => (images[i] ? [[r.url, images[i]] as const] : []))
	) as Record<string, string>;
}
