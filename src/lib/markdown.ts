/**
 * Minimal Markdown → HTML for AI search documents: headings, lists, blockquotes, bold,
 * italics, inline code, http(s) links and [n] citations. All text is HTML-escaped first,
 * so model output can never inject markup.
 */

const escape = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Source ids cited as [n] or [n, m], in order of first appearance. */
export function citedIds(md: string): number[] {
	const ids = new Set<number>();
	for (const [, list] of md.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g)) {
		for (const id of list.split(',')) ids.add(Number(id));
	}
	return [...ids];
}

function inline(text: string, title: (id: number) => string | undefined) {
	return escape(text)
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
		.replace(
			/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
			'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
		)
		.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, list: string) => {
			const links = list.split(',').map((raw) => {
				const id = Number(raw);
				const t = title(id);
				if (!t) return '';
				return `<a class="cite" href="#src-${id}" title="${t}">${id}</a>`;
			});
			return links.some(Boolean) ? links.join('') : match;
		});
}

export function renderMarkdown(md: string, title: (id: number) => string | undefined): string {
	const out: string[] = [];
	let list: 'ul' | 'ol' | null = null;
	let para: string[] = [];
	const flush = () => {
		if (para.length) out.push(`<p>${inline(para.join(' '), safeTitle)}</p>`);
		para = [];
	};
	const closeList = () => {
		if (list) out.push(`</${list}>`);
		list = null;
	};
	// Titles are escaped once here, since they end up inside an attribute.
	const safeTitle = (id: number) => {
		const t = title(id);
		return t === undefined ? undefined : escape(t);
	};

	for (const raw of md.split('\n')) {
		const line = raw.trimEnd();
		const heading = /^(#{1,4})\s+(.*)$/.exec(line);
		const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
		const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		const quote = /^>\s?(.*)$/.exec(line);

		if (!line.trim()) {
			flush();
			closeList();
		} else if (heading) {
			flush();
			closeList();
			const level = Math.min(4, heading[1].length + 1);
			out.push(`<h${level}>${inline(heading[2], safeTitle)}</h${level}>`);
		} else if (bullet || ordered) {
			flush();
			const kind = bullet ? 'ul' : 'ol';
			if (list !== kind) {
				closeList();
				out.push(`<${kind}>`);
				list = kind;
			}
			out.push(`<li>${inline((bullet ?? ordered)![1], safeTitle)}</li>`);
		} else if (quote) {
			flush();
			closeList();
			out.push(`<blockquote>${inline(quote[1], safeTitle)}</blockquote>`);
		} else {
			closeList();
			para.push(line.trim());
		}
	}
	flush();
	closeList();
	return out.join('\n');
}
