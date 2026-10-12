<script lang="ts">
	import { flip } from 'svelte/animate';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type {
		CachedSearch,
		HistoryItem,
		Round,
		SearchEvent,
		SearchResult
	} from '#lib/types.ts';
	import Panel from '#lib/components/Panel.svelte';
	import AdvancedSearch from '#lib/components/AdvancedSearch.svelte';
	import Filters from '#lib/components/Filters.svelte';
	import { countOperators, describeQuery, parseQuery, tokenizeQuery } from '#lib/query.ts';
	import { applyFilter, countFilter, emptyFilter, type ResultFilter } from '#lib/filter.ts';

	const ROUNDS = 3;

	interface View {
		id?: number;
		results: SearchResult[];
		/** Query and new-result count for each completed round */
		rounds: Round[];
		related: string[];
		ms?: number;
		/** Set when showing a stored search from history */
		cachedAt?: number;
		done: boolean;
		/** Error after some results already arrived */
		partialError?: string;
	}

	const q = $derived(page.url.searchParams.get('q')?.trim() ?? '');
	const historyId = $derived(Number(page.url.searchParams.get('h')) || null);
	const key = $derived(historyId ? `h:${historyId}` : `q:${q}`);

	let input = $derived(q);
	let inputEl: HTMLInputElement;
	let mirrorEl = $state<HTMLDivElement>();

	const tokens = $derived(tokenizeQuery(input));
	const parsedInput = $derived(parseQuery(input));
	const operatorCount = $derived(countOperators(parsedInput));

	let advancedOpen = $state(false);
	let filterOpen = $state(false);
	let filter = $state<ResultFilter>(emptyFilter());
	const filterCount = $derived(countFilter(filter));

	function syncScroll() {
		if (mirrorEl) mirrorEl.scrollLeft = inputEl.scrollLeft;
	}

	let view = $state<View | null>(null);
	let loading = $state(false);
	let failure = $state<string | null>(null);

	let history = $state<HistoryItem[]>([]);
	let open = $state(false);
	let active = $state(-1);
	/** API parameters the typed operators will map to, shown while editing before searching */
	const pendingApi = $derived(open && input.trim() !== q ? describeQuery(parsedInput) : []);

	const suggestions = $derived.by(() => {
		const needle = input.trim().toLowerCase();
		return history
			.filter((h) => !needle || h.query.toLowerCase().includes(needle))
			.slice(0, 8);
	});

	const visible = $derived(view ? applyFilter(view.results, filter) : []);

	const memo = new Map<string, View>();
	/** Stagger index within the batch a result arrived in */
	const stagger = new Map<string, number>();

	/** Highest similarity first; unscored results keep arrival order. */
	function rank(results: SearchResult[]) {
		return [...results].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
	}

	async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
		const res = await fetch(url, init);
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			throw new Error(body?.message ?? `HTTP ${res.status}`);
		}
		return res.json();
	}

	/** Reads the NDJSON stream from /api/search, updating `view` as rounds arrive. */
	async function streamSearch(query: string, k: string, signal: AbortSignal) {
		const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
		if (!res.ok || !res.body) {
			const body = await res.json().catch(() => null);
			throw new Error(body?.message ?? `HTTP ${res.status}`);
		}

		const handle = (event: SearchEvent) => {
			switch (event.type) {
				case 'results':
					if (!view) {
						view = { results: [], rounds: [], related: [], done: false };
						loading = false;
					}
					event.results.forEach((r, i) => stagger.set(r.url, i));
					view.results = rank([...view.results, ...event.results]);
					view.rounds.push({ query: event.query, count: event.results.length });
					break;
				case 'expansion':
					if (view) view.related = event.related;
					break;
				case 'done':
					if (view) {
						view.id = event.id;
						view.ms = event.ms;
					}
					break;
				case 'error':
					if (view) view.partialError = event.message;
					else throw new Error(event.message);
			}
		};

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
				if (line) handle(JSON.parse(line));
			}
		}

		if (!view) throw new Error('No results received');
		view.done = true;
		if (!view.partialError) memo.set(k, $state.snapshot(view));
	}

	$effect(() => {
		const k = key;
		const query = q;
		const hid = historyId;
		failure = null;
		view = null;
		filter = emptyFilter();
		if (!query) {
			loading = false;
			return;
		}
		const hit = memo.get(k);
		if (hit) {
			view = hit;
			loading = false;
			return;
		}

		const ctrl = new AbortController();
		loading = true;
		const request = hid
			? getJSON<CachedSearch>(`/api/history/${hid}`, { signal: ctrl.signal }).then((d) => {
					view = {
						id: d.id,
						results: d.results,
						rounds: d.rounds,
						related: d.related,
						cachedAt: d.createdAt,
						done: true
					};
					memo.set(k, $state.snapshot(view));
				})
			: streamSearch(query, k, ctrl.signal);

		request
			.catch((e: Error) => {
				if (e.name !== 'AbortError') failure = e.message;
			})
			.finally(() => {
				if (!ctrl.signal.aborted) loading = false;
			});
		return () => ctrl.abort();
	});

	function research() {
		memo.delete(`q:${q}`);
		goto(`/?q=${encodeURIComponent(q)}`);
	}

	function runSearch() {
		const next = input.trim();
		if (!next) return;
		inputEl.blur();
		advancedOpen = false;
		if (next !== q || historyId) goto(`/?q=${encodeURIComponent(next)}`);
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		runSearch();
	}

	async function removeHistory(item: HistoryItem) {
		history = history.filter((h) => h.id !== item.id);
		memo.delete(`h:${item.id}`);
		active = -1;
		await fetch(`/api/history/${item.id}`, { method: 'DELETE' });
	}

	async function clearAllHistory() {
		history = [];
		for (const k of memo.keys()) if (k.startsWith('h:')) memo.delete(k);
		await fetch('/api/history', { method: 'DELETE' });
	}

	function pick(item: HistoryItem) {
		input = item.query;
		inputEl.blur();
		goto(`/?q=${encodeURIComponent(item.query)}&h=${item.id}`);
	}

	async function onFocus() {
		open = true;
		active = -1;
		try {
			history = await getJSON<HistoryItem[]>('/api/history');
		} catch {}
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (!open || suggestions.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % suggestions.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = active <= 0 ? suggestions.length - 1 : active - 1;
		} else if (e.key === 'Enter' && active >= 0) {
			e.preventDefault();
			pick(suggestions[active]);
		}
	}

	function toggleTheme() {
		const root = document.documentElement;
		const current =
			root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
		const next = current === 'dark' ? 'light' : 'dark';
		root.dataset.theme = next;
		try {
			localStorage.setItem('theme', next);
		} catch {}
	}

	function onKeydown(e: KeyboardEvent) {
		const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
		if (e.key === '/' && !typing) {
			e.preventDefault();
			inputEl.focus();
			inputEl.select();
		} else if (e.key === 'Escape' && e.target === inputEl) {
			inputEl.blur();
		}
	}

	function host(url: string) {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	function crumbs(url: string) {
		try {
			const u = new URL(url);
			return u.pathname.split('/').filter(Boolean).slice(0, 3).map(decodeURIComponent);
		} catch {
			return [];
		}
	}

	function formatDate(d: string | null) {
		if (!d) return '';
		const t = new Date(d);
		if (Number.isNaN(t.getTime())) return '';
		return t.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function ago(ts: number) {
		const s = (Date.now() - ts) / 1000;
		if (s < 60) return '방금';
		if (s < 3600) return `${Math.floor(s / 60)}분 전`;
		if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
		if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
		return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head>
	<title>{q ? `${q} – simpleSearch` : 'simpleSearch'}</title>
</svelte:head>

<div class="app" class:active={!!q}>
	<header>
		<a class="brand" href="/" aria-label="simpleSearch 홈">
			<span class="mark" aria-hidden="true"></span>
			<span class="word">simple<b>Search</b></span>
		</a>

		<form class="search" role="search" onsubmit={submit}>
			<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="11" cy="11" r="6.5" />
				<path d="m16 16 4 4" />
			</svg>
			<div class="field">
				<div class="mirror" aria-hidden="true" bind:this={mirrorEl}>
					{#each tokens as t}<span class="tk-{t.kind}">{t.text}</span>{/each}
				</div>
				<!-- svelte-ignore a11y_autofocus -->
				<input
				bind:this={inputEl}
				bind:value={input}
				onfocus={onFocus}
				onblur={() => (open = false)}
				oninput={() => {
					active = -1;
					syncScroll();
				}}
				onscroll={syncScroll}
				onkeyup={syncScroll}
				onclick={syncScroll}
				onkeydown={onInputKeydown}
				type="search"
				name="q"
				placeholder="무엇이든 검색"
				autocomplete="off"
				spellcheck="false"
				autofocus={!q}
				aria-label="검색어"
				role="combobox"
				aria-expanded={open && suggestions.length > 0}
				aria-controls="history"
				aria-activedescendant={active >= 0 ? `history-${active}` : undefined}
			/>
			</div>
			{#if loading || (view && !view.done)}
				<span class="spinner" aria-label="검색 중"></span>
			{:else}
				<kbd>/</kbd>
			{/if}

			{#if pendingApi.length > 0 || (open && suggestions.length > 0)}
				<div class="below">
				{#if pendingApi.length > 0}
					<div class="apihint" aria-live="polite">
						<span class="ah-title">검색 시 적용</span>
						{#each pendingApi as item}
							<span class="ah-item" class:post={!item.api}>
								<b>{item.label}</b>
								<code>{item.via}</code>
							</span>
						{/each}
					</div>
				{/if}
				{#if open && suggestions.length > 0}
				<ul class="history" id="history" role="listbox" aria-label="최근 검색">
					{#each suggestions as item, i (item.id)}
						<li
							id="history-{i}"
							role="option"
							aria-selected={i === active}
							class:active={i === active}
							onmousedown={(e) => {
								e.preventDefault();
								pick(item);
							}}
							onmouseenter={() => (active = i)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<circle cx="12" cy="12" r="8.5" />
								<path d="M12 7.5V12l3 2" />
							</svg>
							<span class="hq">{item.query}</span>
							<span class="hmeta">{ago(item.createdAt)}</span>
							<button
								class="hdel"
								aria-label="'{item.query}' 기록 삭제"
								title="기록 삭제"
								onmousedown={(e) => {
									e.preventDefault();
									e.stopPropagation();
									removeHistory(item);
								}}
							>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
							</button>
						</li>
					{/each}
					{#if !input.trim()}
						<li class="hfoot" role="presentation">
							<button
								onmousedown={(e) => {
									e.preventDefault();
									clearAllHistory();
								}}
							>
								기록 전체 삭제
							</button>
						</li>
					{/if}
				</ul>
				{/if}
				</div>
			{/if}
		</form>

		{#if !q}
			<button
				class="adv-link"
				class:on={advancedOpen || operatorCount > 0}
				onclick={() => (advancedOpen = !advancedOpen)}
			>
				고급 검색{#if operatorCount}&nbsp;· {operatorCount}{/if}
			</button>
		{/if}

		<button class="theme" onclick={toggleTheme} aria-label="테마 전환" title="테마 전환">
			<svg class="sun" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r="4" />
				<path
					d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
				/>
			</svg>
			<svg class="moon" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
			</svg>
		</button>
	</header>

	{#snippet advancedPanel()}
		<Panel bind:open={advancedOpen} title="고급 검색">
			<AdvancedSearch bind:value={input} />
			{#snippet footer()}
				<button class="btn" onclick={() => (input = parsedInput.terms.join(' '))}>초기화</button>
				<button class="btn primary" onclick={runSearch} disabled={!input.trim()}>검색</button>
			{/snippet}
		</Panel>
	{/snippet}

	{#if !q}
		<div class="home-panel">{@render advancedPanel()}</div>
	{/if}

	{#if q}
		<main>
			<div class="tools">
				<button
					class="tool"
					class:on={advancedOpen}
					aria-expanded={advancedOpen}
					onclick={() => {
						advancedOpen = !advancedOpen;
						filterOpen = false;
					}}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle
							cx="10"
							cy="17"
							r="2"
						/>
					</svg>
					고급 검색
					{#if operatorCount}<span class="badge">{operatorCount}</span>{/if}
				</button>
				<button
					class="tool"
					class:on={filterOpen}
					aria-expanded={filterOpen}
					disabled={!view}
					onclick={() => {
						filterOpen = !filterOpen;
						advancedOpen = false;
					}}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16l-6 7v5l-4 2v-7z" /></svg>
					필터
					{#if filterCount}<span class="badge">{filterCount}</span>{/if}
				</button>
				{#if filterCount && view}
					<span class="tools-meta">{visible.length} / {view.results.length}개</span>
					<button class="tool link" onclick={() => (filter = emptyFilter())}>필터 해제</button>
				{/if}
			</div>

			{@render advancedPanel()}
			{#if view}
				<Panel bind:open={filterOpen} title="필터 · {visible.length} / {view.results.length}개">
					<Filters bind:filter results={view.results} rounds={view.rounds} />
					{#snippet footer()}
						<button class="btn" onclick={() => (filter = emptyFilter())} disabled={!filterCount}
							>초기화</button
						>
						<button class="btn primary" onclick={() => (filterOpen = false)}>완료</button>
					{/snippet}
				</Panel>
			{/if}

			{#if failure}
				<div class="notice">
					<strong>검색에 실패했어요.</strong>
					<span>{failure}</span>
				</div>
			{:else if !view}
				<ol class="results" aria-busy="true">
					{#each { length: 5 } as _, i}
						<li class="skeleton" style:--i={i}>
							<span class="sk sk-host"></span>
							<span class="sk sk-title"></span>
							<span class="sk sk-line"></span>
							<span class="sk sk-line short"></span>
						</li>
					{/each}
				</ol>
			{:else}
				{#if view.cachedAt}
					<div class="cached">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="12" cy="12" r="8.5" />
							<path d="M12 7.5V12l3 2" />
						</svg>
						<span><b>캐시된 결과</b> · {ago(view.cachedAt)} 검색 · {view.results.length}개</span>
						<button onclick={research}>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
							</svg>
							재검색
						</button>
					</div>
				{:else}
					<p class="meta">
						결과 {view.results.length}개{#if view.ms !== undefined}&nbsp;· {(view.ms / 1000).toFixed(
								2
							)}초{/if}
					</p>
				{/if}

				{#if view.rounds.length > 0}
					<ol class="rounds" aria-label="실제 검색한 쿼리">
						{#each view.rounds as r, i}
							<li title={i > 0 ? '앞 결과의 도메인을 제외하고 검색' : '원 검색어'}>
								<span class="n">{i + 1}</span>
								{#if i === 0}
									<span class="rq">{r.query}</span>
								{:else}
									<a class="rq" href="/?q={encodeURIComponent(r.query)}">{r.query}</a>
								{/if}
								<span class="rc">+{r.count}</span>
							</li>
						{/each}
						{#if !view.done}
							{#each { length: ROUNDS - view.rounds.length } as _, i}
								<li class="pending">
									<span class="n">{view.rounds.length + i + 1}</span>
									<span class="sk sk-round"></span>
								</li>
							{/each}
						{/if}
					</ol>
				{/if}

				{#if view.results.length === 0 && view.done}
					<div class="notice">
						<strong>결과가 없어요.</strong>
						<span>다른 검색어로 시도해 보세요.</span>
					</div>
				{:else if visible.length === 0 && view.results.length > 0}
					<div class="notice">
						<strong>필터 조건에 맞는 결과가 없어요.</strong>
						<span>
							{view.results.length}개 중 0개 ·
							<button class="link" onclick={() => (filter = emptyFilter())}>필터 해제</button>
						</span>
					</div>
				{:else}
					<ol class="results">
						{#each visible as r (r.url)}
							<li class="result" style:--i={stagger.get(r.url) ?? 0} animate:flip={{ duration: 320 }}>
								<a href={r.url} target="_blank" rel="noopener noreferrer">
									<div class="source">
										<img
											src="https://icons.duckduckgo.com/ip3/{host(r.url)}.ico"
											alt=""
											width="16"
											height="16"
											loading="lazy"
											onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
										/>
										<span class="host">{host(r.url)}</span>
										{#each crumbs(r.url) as c}
											<span class="crumb">› {c}</span>
										{/each}
										{#if r.score !== undefined}
											<span
												class="score"
												class:high={r.score >= 0.6}
												title="검색어와의 임베딩 유사도 (cosine)"
												style:--s={Math.max(0, Math.min(1, r.score))}
											>
												{r.score.toFixed(2)}
											</span>
										{/if}
									</div>
									<h2>{r.title}</h2>
								</a>
								{#if r.snippet || r.date}
									<p class="snippet">
										{#if formatDate(r.date)}<time>{formatDate(r.date)}</time>{/if}
										{r.snippet}
									</p>
								{/if}
							</li>
						{/each}
					</ol>
				{/if}

				{#if !view.done}
					<div class="progress">
						<span class="spinner small" aria-hidden="true"></span>
						추가 결과 찾는 중 · {view.rounds.length}/{ROUNDS}
					</div>
				{:else if view.partialError}
					<div class="progress">일부 검색이 실패했어요 · {view.partialError}</div>
				{/if}

				{#if view.related.length > 0}
					<section class="related" aria-label="관련 검색어">
						<h3>관련 검색어</h3>
						<div class="chips">
							{#each view.related as rq}
								<a href="/?q={encodeURIComponent(rq)}">
									<svg viewBox="0 0 24 24" aria-hidden="true">
										<circle cx="11" cy="11" r="6.5" />
										<path d="m16 16 4 4" />
									</svg>
									{rq}
								</a>
							{/each}
						</div>
					</section>
				{/if}
			{/if}
		</main>
	{/if}
</div>

<style>
	.app {
		--rail: 168px;
		min-height: 100dvh;
	}

	/* ---------- header / hero ---------- */
	header {
		display: grid;
		grid-template-columns: 1fr;
		justify-items: center;
		gap: 28px;
		padding: calc(32dvh - 60px) 20px 40px;
	}

	.active header {
		position: sticky;
		top: 0;
		z-index: 10;
		grid-template-columns: var(--rail) minmax(0, 640px) 1fr;
		align-items: center;
		justify-items: stretch;
		gap: 24px;
		padding: 14px 24px;
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		backdrop-filter: saturate(1.4) blur(14px);
		-webkit-backdrop-filter: saturate(1.4) blur(14px);
		border-bottom: 1px solid var(--border);
	}

	.brand {
		view-transition-name: brand;
		display: inline-flex;
		align-items: center;
		gap: 12px;
		font-size: 34px;
		letter-spacing: -0.03em;
		color: var(--text);
	}
	.brand .word {
		font-weight: 500;
	}
	.brand b {
		font-weight: 700;
		color: var(--accent);
	}
	.mark {
		width: 0.95em;
		height: 0.95em;
		border-radius: 30%;
		background: linear-gradient(135deg, var(--accent), var(--accent-strong));
		box-shadow: 0 4px 14px -4px var(--accent);
	}
	.active .brand {
		font-size: 19px;
		gap: 8px;
	}

	/* ---------- search box ---------- */
	.search {
		view-transition-name: search;
		position: relative;
		display: flex;
		align-items: center;
		width: min(640px, 100%);
		height: 56px;
		padding: 0 16px 0 48px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		box-shadow: var(--shadow);
		transition:
			border-color 0.15s var(--ease),
			box-shadow 0.15s var(--ease);
	}
	.search:focus-within {
		border-color: var(--accent);
		box-shadow:
			var(--shadow),
			0 0 0 4px var(--ring);
	}
	.active .search {
		width: 100%;
		height: 46px;
		box-shadow: none;
	}
	.active .search:focus-within {
		box-shadow: 0 0 0 4px var(--ring);
	}

	.icon {
		position: absolute;
		left: 18px;
		width: 20px;
		height: 20px;
		fill: none;
		stroke: var(--text-3);
		stroke-width: 2;
		stroke-linecap: round;
		transition: stroke 0.15s;
	}
	.search:focus-within .icon {
		stroke: var(--accent);
	}

	/* The input's own text is transparent; .mirror draws it with operator highlights. */
	.field {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 100%;
	}
	.mirror,
	input {
		font: inherit;
		font-size: 17px;
		letter-spacing: normal;
		padding: 0;
	}
	.mirror {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		overflow: hidden;
		white-space: pre;
		pointer-events: none;
		color: var(--text);
	}
	.mirror span {
		flex: none;
	}
	input {
		position: relative;
		width: 100%;
		height: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		color: transparent;
		caret-color: var(--text);
		-webkit-appearance: none;
		appearance: none;
	}
	input::-webkit-search-decoration {
		display: none;
	}
	.tk-op,
	.tk-phrase,
	.tk-exclude,
	.tk-or {
		border-radius: 4px;
		box-shadow: 0 0 0 2px var(--tk-bg);
		background: var(--tk-bg);
		color: var(--tk-fg);
	}
	.tk-op {
		--tk-bg: var(--accent-soft);
		--tk-fg: var(--accent-strong);
	}
	.tk-phrase {
		--tk-bg: var(--sage-soft);
		--tk-fg: var(--sage);
	}
	.tk-exclude {
		--tk-bg: var(--rose-soft);
		--tk-fg: var(--rose);
	}
	.tk-or {
		--tk-bg: transparent;
		--tk-fg: var(--accent);
		font-style: italic;
	}
	input::placeholder {
		color: var(--text-3);
	}
	input::-webkit-search-cancel-button {
		display: none;
	}

	kbd {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border: 1px solid var(--border);
		border-radius: 6px;
		font: 12px/1 ui-monospace, monospace;
		color: var(--text-3);
	}
	.search:focus-within kbd {
		opacity: 0;
	}

	.spinner {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid var(--accent-soft);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}

	/* ---------- theme toggle ---------- */
	.theme {
		position: fixed;
		top: 16px;
		right: 16px;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border: 1px solid transparent;
		border-radius: 12px;
		background: transparent;
		cursor: pointer;
		color: var(--text-2);
		transition:
			background-color 0.15s,
			color 0.15s;
	}
	.active .theme {
		position: static;
		justify-self: end;
	}
	.theme:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.theme svg {
		grid-area: 1 / 1;
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition:
			transform 0.3s var(--ease),
			opacity 0.2s;
	}
	.moon {
		opacity: 0;
		transform: rotate(-60deg) scale(0.6);
	}
	:global(:root[data-theme='dark']) .sun {
		opacity: 0;
		transform: rotate(60deg) scale(0.6);
	}
	:global(:root[data-theme='dark']) .moon {
		opacity: 1;
		transform: none;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .sun {
			opacity: 0;
			transform: rotate(60deg) scale(0.6);
		}
		:global(:root:not([data-theme='light'])) .moon {
			opacity: 1;
			transform: none;
		}
	}

	/* ---------- results ---------- */
	main {
		max-width: 688px;
		padding: 8px 24px 80px;
		margin-left: calc(var(--rail) + 24px);
	}

	.meta {
		margin: 14px 0 6px;
		font-size: 13px;
		color: var(--text-3);
	}

	.results {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.result,
	.skeleton {
		padding: 18px 0;
		animation: rise 0.35s var(--ease) both;
		animation-delay: calc(var(--i) * 28ms);
	}
	.result + .result {
		border-top: 1px solid var(--border);
	}

	.source {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: 13px;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
	}
	.source img {
		flex: none;
		width: 16px;
		height: 16px;
		border-radius: 4px;
		background: var(--surface-2);
	}
	.host {
		color: var(--text);
		font-weight: 500;
	}
	.crumb {
		color: var(--text-3);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.score {
		position: relative;
		flex: none;
		margin-left: auto;
		padding: 1px 8px 1px 20px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-3);
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
	}
	.score::before {
		content: '';
		position: absolute;
		left: 7px;
		top: 50%;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		transform: translateY(-50%);
		background: conic-gradient(var(--text-3) calc(var(--s) * 360deg), var(--border) 0);
	}
	.score.high {
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.score.high::before {
		background: conic-gradient(var(--accent) calc(var(--s) * 360deg), var(--border) 0);
	}

	h2 {
		margin: 6px 0 4px;
		font-size: 19px;
		font-weight: 600;
		line-height: 1.35;
		letter-spacing: -0.01em;
		color: var(--accent-strong);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		transition: color 0.12s;
	}
	.result a:hover h2 {
		text-decoration: underline;
		text-decoration-thickness: 1.5px;
		text-underline-offset: 3px;
	}
	.result a:visited h2 {
		color: var(--text-2);
	}
	.result a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
		border-radius: 6px;
	}

	.snippet {
		margin: 0;
		font-size: 14.5px;
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	time {
		color: var(--text-3);
		margin-right: 6px;
	}
	time::after {
		content: ' —';
	}

	/* ---------- skeleton ---------- */
	.skeleton {
		display: grid;
		gap: 10px;
	}
	.sk {
		display: block;
		height: 12px;
		border-radius: 6px;
		background: linear-gradient(
			90deg,
			var(--surface-2) 0%,
			var(--accent-soft) 50%,
			var(--surface-2) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.2s linear infinite;
	}
	.sk-host {
		width: 140px;
	}
	.sk-title {
		width: 62%;
		height: 18px;
		margin-bottom: 2px;
	}
	.sk-line {
		width: 100%;
	}
	.sk-line.short {
		width: 74%;
	}

	/* ---------- notice ---------- */
	.notice {
		display: grid;
		gap: 4px;
		margin-top: 28px;
		padding: 18px 20px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-2);
		font-size: 14.5px;
	}
	.notice strong {
		color: var(--text);
	}

	/* ---------- api hint ---------- */
	.apihint {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
		padding: 9px 14px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
		box-shadow: var(--shadow);
		font-size: 12.5px;
		color: var(--text-2);
	}
	.ah-title {
		color: var(--text-3);
	}
	.ah-item {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}
	.ah-item b {
		font-weight: 600;
		color: var(--accent-strong);
		overflow-wrap: anywhere;
	}
	.ah-item code {
		font: 11px/1.4 ui-monospace, monospace;
		color: var(--text-3);
	}
	.ah-item.post b {
		color: var(--text-2);
	}

	/* ---------- advanced search / tools ---------- */
	.adv-link {
		margin-top: -12px;
		padding: 6px 12px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font-size: 13.5px;
		color: var(--text-3);
		cursor: pointer;
		transition:
			color 0.15s,
			background-color 0.15s;
	}
	.adv-link:hover,
	.adv-link.on {
		color: var(--accent-strong);
		background: var(--accent-soft);
	}
	.home-panel {
		width: min(640px, calc(100% - 40px));
		margin: -24px auto 40px;
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 12px 0 2px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tool {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		font-size: 13.5px;
		color: var(--text-2);
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s,
			color 0.15s;
	}
	.tool:hover:not(:disabled),
	.tool.on {
		border-color: var(--accent);
		color: var(--accent-strong);
	}
	.tool.on {
		background: var(--accent-soft);
	}
	.tool:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.tool svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.tool.link {
		border-color: transparent;
		background: transparent;
		color: var(--text-3);
	}
	.badge {
		display: grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--accent);
		color: var(--surface);
		font-size: 11px;
		font-weight: 600;
	}
	.tools-meta {
		flex: none;
		margin-left: 4px;
		font-size: 13px;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}

	.btn {
		height: 38px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		font-size: 14px;
		font-weight: 500;
		color: var(--text-2);
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--text);
	}
	.btn.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--surface);
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--accent-strong);
		color: var(--surface);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent-strong);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* ---------- history dropdown ---------- */
	.below {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		right: 0;
		z-index: 20;
		display: grid;
		gap: 6px;
		animation: drop 0.16s var(--ease);
	}
	.history {
		margin: 0;
		padding: 6px;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		box-shadow: var(--shadow);
	}
	.history li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 12px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 15px;
	}
	.history li.active {
		background: var(--accent-soft);
	}
	.history svg,
	.cached svg {
		flex: none;
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--text-3);
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.hq {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hmeta {
		flex: none;
		font-size: 12px;
		color: var(--text-3);
	}
	.hdel {
		display: grid;
		place-items: center;
		flex: none;
		width: 24px;
		height: 24px;
		margin: -4px -6px -4px 0;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.12s,
			background-color 0.12s,
			color 0.12s;
	}
	.history li.active .hdel,
	.hdel:focus-visible {
		opacity: 1;
	}
	.hdel:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.history .hdel svg {
		width: 14px;
		height: 14px;
		stroke: currentColor;
		stroke-width: 2;
	}
	.history li.hfoot {
		justify-content: flex-end;
		padding: 4px 6px 2px;
		margin-top: 4px;
		border-top: 1px solid var(--border);
		border-radius: 0;
		cursor: default;
	}
	.hfoot button {
		padding: 4px 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		font-size: 12.5px;
		color: var(--text-3);
		cursor: pointer;
	}
	.hfoot button:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	@media (hover: none) {
		.hdel {
			opacity: 1;
		}
	}

	/* ---------- cached banner ---------- */
	.cached {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 14px 0 4px;
		padding: 8px 8px 8px 14px;
		border-radius: 12px;
		background: var(--accent-soft);
		color: var(--text-2);
		font-size: 13.5px;
		animation: rise 0.3s var(--ease);
	}
	.cached svg {
		stroke: var(--accent);
	}
	.cached span {
		flex: 1;
		min-width: 0;
	}
	.cached b {
		color: var(--accent-strong);
		font-weight: 600;
	}
	.cached button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}
	.cached button svg {
		width: 14px;
		height: 14px;
		stroke: currentColor;
	}
	.cached button:hover {
		border-color: var(--accent);
		color: var(--accent-strong);
	}

	/* ---------- expansion / progress / related ---------- */
	.rounds {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 2px 0 6px;
		padding: 0;
		list-style: none;
		font-size: 12.5px;
	}
	.rounds li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		padding: 3px 10px 3px 3px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-2);
		animation: rise 0.25s var(--ease) both;
	}
	.rounds .n {
		display: grid;
		place-items: center;
		flex: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 11px;
		font-weight: 600;
	}
	.rounds .rq {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rounds a.rq:hover {
		color: var(--accent-strong);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.rounds .rc {
		flex: none;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.sk-round {
		width: 90px;
		height: 10px;
	}

	.progress {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 22px 0 6px;
		border-top: 1px solid var(--border);
		font-size: 13.5px;
		color: var(--text-3);
	}

	.related {
		margin-top: 24px;
		padding-top: 22px;
		border-top: 1px solid var(--border);
	}
	.related h3 {
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
	}
	.chips {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
		gap: 8px;
	}
	.chips a {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		font-size: 14.5px;
		animation: rise 0.3s var(--ease) both;
		transition:
			border-color 0.15s,
			color 0.15s,
			transform 0.15s var(--ease);
	}
	.chips a:hover {
		border-color: var(--accent);
		color: var(--accent-strong);
	}
	.chips a:active {
		transform: scale(0.98);
	}
	.chips svg {
		flex: none;
		width: 15px;
		height: 15px;
		fill: none;
		stroke: var(--text-3);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.chips a:hover svg {
		stroke: var(--accent);
	}

	.spinner.small {
		width: 14px;
		height: 14px;
	}

	/* ---------- responsive ---------- */
	@media (max-width: 860px) {
		main {
			margin: 0 auto;
		}
	}
	@media (max-width: 600px) {
		header {
			padding-top: calc(26dvh - 40px);
		}
		.brand {
			font-size: 28px;
		}
		.active header {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 10px 8px;
			padding: 10px 16px 12px;
		}
		.active .brand {
			grid-column: 1;
		}
		.active .search {
			grid-column: 1 / -1;
			grid-row: 2;
			height: 44px;
		}
		.active .theme {
			grid-column: 2;
			grid-row: 1;
			width: 34px;
			height: 34px;
		}
		main {
			padding: 4px 16px 60px;
		}
		h2 {
			font-size: 17px;
		}
		kbd {
			display: none;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
</style>
