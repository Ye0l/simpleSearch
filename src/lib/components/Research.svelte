<script lang="ts">
	import { untrack } from 'svelte';
	import { citedIds, renderMarkdown } from '#lib/markdown.ts';
	import type { Report, ResearchEvent, Source } from '#lib/types.ts';

	// AI search: the process (plan → search → review rounds) on the left, the document being
	// written on the right. Narrow screens switch between the two with tabs.
	let {
		topic,
		reportId,
		onsaved,
		onquota,
		onrerun
	}: {
		topic: string;
		/** Saved report to show; null runs a new AI search on `topic` */
		reportId: number | null;
		onsaved: (id: number) => void;
		onquota: (used: number) => void;
		onrerun: () => void;
	} = $props();

	type Review = Extract<ResearchEvent, { type: 'review' }>;
	interface RoundView {
		round: number;
		queries: string[];
		results: { query: string; sources: Source[] }[];
		review?: Review;
	}

	let goal = $state('');
	let criteria = $state<string[]>([]);
	let rounds = $state<RoundView[]>([]);
	let sources = $state<Record<number, Source>>({});
	let picks = $state<Record<number, string>>({});
	let stage = $state<'plan' | 'search' | 'review' | 'write' | 'done'>('plan');
	let doc = $state('');
	let ms = $state<number | null>(null);
	let createdAt = $state<number | null>(null);
	let failure = $state<string | null>(null);
	let pane = $state<'process' | 'doc'>('process');
	let copied = $state(false);
	/** Report this component just produced, so switching the URL to it doesn't reload it */
	let produced: number | null = null;

	const covered = $derived(new Set(rounds.at(-1)?.review?.covered ?? []));
	const queries = $derived(rounds.flatMap((r) => r.queries));
	const references = $derived(
		citedIds(doc)
			.filter((id) => sources[id])
			.sort((a, b) => a - b)
	);
	const html = $derived(renderMarkdown(doc, (id) => sources[id]?.title));
	const busy = $derived(stage !== 'done' && !failure);
	const current = $derived(rounds.at(-1));

	function reset() {
		goal = '';
		criteria = [];
		rounds = [];
		sources = {};
		picks = {};
		stage = 'plan';
		doc = '';
		ms = null;
		createdAt = null;
		failure = null;
		pane = 'process';
	}

	function apply(event: ResearchEvent) {
		switch (event.type) {
			case 'plan':
				goal = event.goal;
				criteria = event.criteria;
				break;
			case 'searching':
				stage = 'search';
				rounds.push({ round: event.round, queries: event.queries, results: [] });
				break;
			case 'results': {
				const r = rounds.find((x) => x.round === event.round);
				r?.results.push({ query: event.query, sources: event.sources });
				for (const s of event.sources) sources[s.id] = s;
				break;
			}
			case 'reviewing':
				stage = 'review';
				break;
			case 'review': {
				const r = rounds.find((x) => x.round === event.round);
				if (r) r.review = event;
				for (const p of event.picked) picks[p.id] = p.reason;
				break;
			}
			case 'writing':
				stage = 'write';
				pane = 'doc';
				break;
			case 'delta':
				doc += event.text;
				break;
			case 'done':
				stage = 'done';
				ms = event.ms;
				break;
			case 'error':
				throw new Error(event.message);
		}
	}

	async function run(signal: AbortSignal) {
		const res = await fetch(`/api/research?q=${encodeURIComponent(topic)}`, { signal });
		if (res.status === 401) location.reload();
		const quota = res.headers.get('X-Quota-Used');
		if (quota) onquota(Number(quota));
		if (!res.ok || !res.body) {
			const body = await res.json().catch(() => null);
			throw new Error(body?.message ?? `HTTP ${res.status}`);
		}
		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			let nl: number;
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (!line) continue;
				const event: ResearchEvent = JSON.parse(line);
				apply(event);
				if (event.type === 'done') {
					produced = event.id;
					createdAt = Date.now();
					onsaved(event.id);
				}
			}
		}
		if (stage !== 'done') throw new Error('AI 검색이 중간에 끊겼어요');
	}

	async function load(id: number, signal: AbortSignal) {
		const res = await fetch(`/api/reports/${id}`, { signal });
		if (res.status === 401) location.reload();
		if (!res.ok) throw new Error(res.status === 404 ? '리포트를 찾을 수 없어요' : `HTTP ${res.status}`);
		const report: Report = await res.json();
		for (const event of report.events) apply(event);
		stage = 'done';
		createdAt = report.createdAt;
		pane = 'doc';
	}

	$effect(() => {
		const id = reportId;
		topic;
		if (id !== null && id === untrack(() => produced)) return;
		reset();
		const ctrl = new AbortController();
		(id === null ? run(ctrl.signal) : load(id, ctrl.signal)).catch((e: Error) => {
			if (e.name !== 'AbortError') failure = e.message;
		});
		return () => ctrl.abort();
	});

	function host(url: string) {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	async function copy() {
		const refs = references.map((id) => `[${id}] ${sources[id].title} — ${sources[id].url}`);
		const text = `# ${topic}\n\n${doc.trim()}\n\n## 참고 자료\n\n${refs.join('\n')}\n`;
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	function jump(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a.cite');
		if (!a) return;
		e.preventDefault();
		document.getElementById(a.getAttribute('href')!.slice(1))?.scrollIntoView({
			behavior: 'smooth',
			block: 'center'
		});
	}

	const STAGES = {
		plan: '조사 계획 세우는 중',
		search: '검색 중',
		review: '결과 검토 중 · 필요한 자료를 고르고 있어요',
		write: '찾은 내용으로 문서 작성 중',
		done: '완료'
	};
</script>

<div class="research" class:show-doc={pane === 'doc'}>
	<div class="switch" role="tablist">
		<button role="tab" aria-selected={pane === 'process'} onclick={() => (pane = 'process')}>
			과정 {#if busy && stage !== 'write'}<span class="dot"></span>{/if}
		</button>
		<button role="tab" aria-selected={pane === 'doc'} onclick={() => (pane = 'doc')}>
			문서 {#if stage === 'write'}<span class="dot"></span>{/if}
		</button>
	</div>

	<section class="process" aria-label="AI 검색 과정">
		<div class="status" class:done={!busy}>
			{#if failure}
				<span class="fail">실패 · {failure}</span>
			{:else if busy}
				<span class="spinner" aria-hidden="true"></span>
				{STAGES[stage]}{#if stage === 'search' && current}&nbsp;· {current.round}라운드{/if}
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
				완료 · 검색어 {queries.length}개 · 출처 {references.length}개{#if ms}&nbsp;· {(ms / 1000).toFixed(1)}초{/if}
			{/if}
		</div>

		{#if goal}
			<article class="card plan">
				<h3>조사 계획</h3>
				<p class="goal">{goal}</p>
				<ul class="criteria">
					{#each criteria as c, i}
						<li class:ok={covered.has(i)}>
							<span class="check" aria-hidden="true">
								<svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8" /></svg>
							</span>
							{c}
						</li>
					{/each}
				</ul>
			</article>
		{:else if !failure}
			<article class="card"><span class="sk"></span><span class="sk short"></span></article>
		{/if}

		{#each rounds as r (r.round)}
			<article class="card round">
				<h3>라운드 {r.round}</h3>
				{#each r.queries as query}
					{@const found = r.results.find((x) => x.query === query)}
					<div class="query">
						<div class="qhead">
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg
							>
							<b>{query}</b>
							{#if found}<span class="count">{found.sources.length}개</span>
							{:else}<span class="spinner small" aria-label="검색 중"></span>{/if}
						</div>
						{#if found}
							<ol class="sources">
								{#each found.sources as s (s.id)}
									<li class:picked={picks[s.id] !== undefined} class:dim={!!r.review && picks[s.id] === undefined}>
										<span class="sid">{s.id}</span>
										<img
											src="https://icons.duckduckgo.com/ip3/{host(s.url)}.ico"
											alt=""
											width="14"
											height="14"
											loading="lazy"
											onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
										/>
										<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
										{#if picks[s.id] !== undefined}
											<span class="reason">{picks[s.id]}</span>
										{/if}
									</li>
								{/each}
							</ol>
						{/if}
					</div>
				{/each}

				{#if r.review}
					<div class="review">
						<div class="verdict" class:enough={r.review.enough}>
							{r.review.picked.length}개 선택 ·
							{#if r.review.enough}
								필요한 내용을 다 찾았어요
							{:else if r.review.next.length}
								부족한 점: {r.review.missing || '추가 자료 필요'}
							{:else}
								찾은 자료로 정리할게요
							{/if}
						</div>
						{#if r.review.notes.length}
							<ul class="notes">
								{#each r.review.notes as note}
									<li>{@html renderMarkdown(note, (id) => sources[id]?.title).replace(/^<p>|<\/p>$/g, '')}</li>
								{/each}
							</ul>
						{/if}
					</div>
				{:else if stage === 'review' && r === current}
					<div class="review pending">
						<span class="spinner small" aria-hidden="true"></span> AI가 결과를 읽고 고르는 중
					</div>
				{/if}
			</article>
		{/each}

		{#if stage === 'write' || stage === 'done'}
			<article class="card writing">
				{#if stage === 'write'}
					<span class="spinner small" aria-hidden="true"></span> 고른 자료 {Object.keys(picks).length}개로 문서를 쓰는 중
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg> 문서 작성 완료
				{/if}
			</article>
		{/if}
	</section>

	<section class="doc" aria-label="AI 검색 문서">
		<header>
			<span class="label">AI 검색</span>
			<h2>{topic}</h2>
			<div class="actions">
				{#if stage === 'done'}
					<button onclick={copy}>{copied ? '복사됨' : '마크다운 복사'}</button>
				{/if}
				<button onclick={onrerun} disabled={busy}>다시 조사</button>
			</div>
		</header>

		{#if doc}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="body" class:typing={stage === 'write'} onclick={jump}>{@html html}</div>
		{:else if failure}
			<p class="empty">문서를 만들지 못했어요. 다시 조사해 보세요.</p>
		{:else}
			<div class="empty">
				<span class="sk"></span><span class="sk"></span><span class="sk short"></span>
				<p>자료를 모으고 검토가 끝나면 여기에 문서를 작성해요.</p>
			</div>
		{/if}

		{#if stage === 'done' && references.length}
			<h3 class="refs-title">참고 자료</h3>
			<ol class="refs">
				{#each references as id}
					<li id="src-{id}">
						<span class="sid">{id}</span>
						<div>
							<a href={sources[id].url} target="_blank" rel="noopener noreferrer">{sources[id].title}</a>
							<small>{host(sources[id].url)}{sources[id].date ? ` · ${sources[id].date}` : ''}</small>
						</div>
					</li>
				{/each}
			</ol>
			<h3 class="refs-title">사용한 검색어</h3>
			<div class="used">
				{#each queries as query}
					<a href="/?q={encodeURIComponent(query)}">{query}</a>
				{/each}
			</div>
			{#if createdAt}
				<p class="stamp">{new Date(createdAt).toLocaleString('ko-KR')}</p>
			{/if}
		{/if}
	</section>
</div>

<style>
	.research {
		--gap: 24px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
		gap: var(--gap);
		max-width: 1440px;
		margin: 0 auto;
		padding: 16px 24px 80px;
	}

	.switch {
		display: none;
	}

	/* ---------- process ---------- */
	.process {
		display: grid;
		align-content: start;
		gap: 12px;
		min-width: 0;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		font-size: 13.5px;
		color: var(--text-2);
	}
	.status svg,
	.writing svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--sage);
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.fail {
		color: var(--rose);
	}

	.card {
		display: grid;
		gap: 10px;
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow-xs);
		animation: rise 0.3s var(--ease) both;
	}
	.card h3 {
		margin: 0;
		font-size: 12.5px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-3);
	}
	.goal {
		margin: 0;
		font-size: 14.5px;
	}
	.criteria {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 13.5px;
		color: var(--text-2);
	}
	.criteria li {
		display: flex;
		gap: 8px;
		transition: color 0.2s;
	}
	.check {
		display: grid;
		place-items: center;
		flex: none;
		width: 18px;
		height: 18px;
		margin-top: 1px;
		border: 1px solid var(--border);
		border-radius: 5px;
		transition:
			background-color 0.2s,
			border-color 0.2s;
	}
	.check svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: var(--accent-fg);
		stroke-width: 2.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0;
	}
	.criteria li.ok {
		color: var(--text);
	}
	.criteria li.ok .check {
		border-color: var(--accent);
		background: var(--accent);
	}
	.criteria li.ok .check svg {
		opacity: 1;
	}

	.query {
		display: grid;
		gap: 6px;
	}
	.qhead {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: 14px;
	}
	.qhead svg {
		flex: none;
		width: 15px;
		height: 15px;
		fill: none;
		stroke: var(--accent);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.qhead b {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.count {
		flex: none;
		margin-left: auto;
		font-size: 12px;
		color: var(--text-3);
	}

	.sources {
		display: grid;
		gap: 2px;
		margin: 0 0 4px;
		padding: 0;
		list-style: none;
	}
	.sources li {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: center;
		column-gap: 8px;
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 13px;
		transition:
			opacity 0.3s,
			background-color 0.3s;
		animation: rise 0.25s var(--ease) both;
	}
	.sources li.picked {
		background: var(--accent-soft);
	}
	.sources li.dim {
		opacity: 0.45;
	}
	.sources a {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.sources a:hover {
		text-decoration: underline;
	}
	.sources img {
		border-radius: 3px;
	}
	.reason {
		grid-column: 3;
		font-size: 12px;
		color: var(--accent-strong);
	}
	.sid {
		display: grid;
		place-items: center;
		min-width: 20px;
		height: 18px;
		padding: 0 4px;
		border-radius: 5px;
		background: var(--surface-2);
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-2);
	}
	.picked .sid {
		background: var(--accent);
		color: var(--accent-fg);
	}

	.review {
		display: grid;
		gap: 8px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
		font-size: 13.5px;
	}
	.review.pending {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-2);
	}
	.verdict {
		font-weight: 600;
		color: var(--text-2);
	}
	.verdict.enough {
		color: var(--sage);
	}
	.notes {
		display: grid;
		gap: 4px;
		margin: 0;
		padding-left: 18px;
		color: var(--text-2);
	}

	.writing {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		color: var(--text-2);
	}

	/* ---------- document ---------- */
	.doc {
		position: sticky;
		top: 88px;
		align-self: start;
		max-height: calc(100dvh - 104px);
		overflow-y: auto;
		overscroll-behavior: contain;
		min-width: 0;
		padding: 22px 28px 28px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow-xs);
	}
	.doc header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: 4px 12px;
		margin-bottom: 18px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}
	.label {
		grid-column: 1 / -1;
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
	}
	.doc h2 {
		margin: 0;
		font-size: 22px;
		line-height: 1.3;
		letter-spacing: -0.01em;
	}
	.actions {
		display: flex;
		gap: 6px;
	}
	.actions button {
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		box-shadow: var(--shadow-xs);
		font-size: 13px;
		color: var(--text-2);
		cursor: pointer;
		white-space: nowrap;
	}
	.actions button:hover:not(:disabled) {
		background: var(--surface-2);
		color: var(--text);
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.body {
		font-size: 15.5px;
		line-height: 1.75;
		overflow-wrap: anywhere;
	}
	.body :global(p) {
		margin: 0 0 14px;
	}
	.body :global(h3),
	.body :global(h4) {
		margin: 26px 0 10px;
		font-size: 17px;
		line-height: 1.4;
	}
	.body :global(h4) {
		font-size: 15.5px;
	}
	.body :global(ul),
	.body :global(ol) {
		margin: 0 0 14px;
		padding-left: 22px;
	}
	.body :global(li) {
		margin: 4px 0;
	}
	.body :global(blockquote) {
		margin: 0 0 14px;
		padding: 2px 14px;
		border-left: 3px solid var(--border);
		color: var(--text-2);
	}
	.body :global(code) {
		padding: 1px 5px;
		border-radius: 5px;
		background: var(--surface-2);
		font: 0.88em ui-monospace, monospace;
	}
	.body :global(a:not(.cite)) {
		color: var(--accent-strong);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.body.typing::after {
		content: '';
		display: inline-block;
		width: 8px;
		height: 1.1em;
		margin-left: 2px;
		vertical-align: text-bottom;
		background: var(--accent);
		animation: blink 1s steps(2) infinite;
	}
	:global(.research a.cite) {
		display: inline-grid;
		place-items: center;
		min-width: 17px;
		height: 17px;
		margin: 0 1px;
		padding: 0 3px;
		border-radius: 5px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 10.5px;
		font-weight: 600;
		line-height: 1;
		vertical-align: 2px;
		text-decoration: none;
	}
	:global(.research a.cite:hover) {
		background: var(--accent);
		color: var(--accent-fg);
	}

	.empty {
		display: grid;
		gap: 10px;
		margin: 0;
		color: var(--text-3);
		font-size: 14px;
	}
	.empty p {
		margin: 6px 0 0;
	}

	.refs-title {
		margin: 28px 0 10px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
		font-size: 14px;
		font-weight: 600;
	}
	.refs {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.refs li {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 4px 6px;
		margin: 0 -6px;
		border-radius: 6px;
		font-size: 14px;
		scroll-margin: 80px;
	}
	.refs li:target {
		background: var(--accent-soft);
	}
	.refs div {
		display: grid;
		min-width: 0;
	}
	.refs a {
		overflow-wrap: anywhere;
		color: var(--text);
	}
	.refs a:hover {
		text-decoration: underline;
	}
	.refs small {
		font-size: 12px;
		color: var(--text-3);
	}
	.used {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.used a {
		padding: 3px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 13px;
		color: var(--text-2);
	}
	.used a:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.stamp {
		margin: 18px 0 0;
		font-size: 12px;
		color: var(--text-3);
	}

	/* ---------- shared bits ---------- */
	.spinner {
		flex: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid var(--accent-soft);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	.spinner.small {
		width: 13px;
		height: 13px;
	}
	.sk {
		display: block;
		height: 12px;
		border-radius: 6px;
		background: var(--surface-2);
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
	.sk.short {
		width: 60%;
	}

	/* Narrower than a full-screen desktop: one pane at a time, switched with tabs. */
	@media (max-width: 1100px) {
		.research {
			grid-template-columns: minmax(0, 1fr);
			max-width: 760px;
			padding-top: 8px;
		}
		.switch {
			position: sticky;
			top: 74px;
			z-index: 5;
			display: flex;
			gap: 4px;
			padding: 3px;
			border-radius: 10px;
			background: var(--surface-2);
		}
		.switch button {
			flex: 1;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 6px;
			height: 34px;
			border: 0;
			border-radius: 8px;
			background: transparent;
			font-size: 14px;
			color: var(--text-2);
			cursor: pointer;
		}
		.switch button[aria-selected='true'] {
			background: var(--surface);
			color: var(--text);
			font-weight: 600;
			box-shadow: var(--shadow-xs);
		}
		.dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--accent);
			animation: pulse 1.2s infinite;
		}
		.doc {
			position: static;
			max-height: none;
			overflow: visible;
		}
		.research:not(.show-doc) .doc,
		.research.show-doc .process {
			display: none;
		}
	}
	@media (max-width: 600px) {
		.research {
			padding: 6px 12px 60px;
		}
		.switch {
			top: 108px;
		}
		.doc {
			padding: 18px 16px 22px;
		}
		.doc header {
			grid-template-columns: minmax(0, 1fr);
		}
		.doc h2 {
			font-size: 19px;
		}
		.body {
			font-size: 15px;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.5;
		}
	}
	@keyframes blink {
		to {
			opacity: 0;
		}
	}
</style>
