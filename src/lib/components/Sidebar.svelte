<script lang="ts">
	import type { ArchiveItem } from '#lib/types.ts';

	// Slide-in archive menu: saved result pages and single saved results.
	let {
		open = $bindable(),
		items,
		user,
		onremove,
		onlogout
	}: {
		open: boolean;
		items: ArchiveItem[];
		user?: string;
		onremove: (item: ArchiveItem) => void;
		onlogout: () => void;
	} = $props();

	let tab = $state<'search' | 'result'>('search');
	const pages = $derived(items.filter((i) => i.kind === 'search'));
	const results = $derived(items.filter((i) => i.kind === 'result'));

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) open = false;
	}

	function host(url: string) {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	const date = (ts: number) =>
		new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<button class="backdrop" aria-label="닫기" tabindex="-1" onclick={() => (open = false)}></button>
	<nav class="sidebar" aria-label="아카이브">
		<header>
			<h2>아카이브</h2>
			<button class="icon-btn" aria-label="닫기" onclick={() => (open = false)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
			</button>
		</header>

		<div class="tabs" role="tablist">
			<button role="tab" aria-selected={tab === 'search'} onclick={() => (tab = 'search')}>
				결과 페이지 <span>{pages.length}</span>
			</button>
			<button role="tab" aria-selected={tab === 'result'} onclick={() => (tab = 'result')}>
				저장한 결과 <span>{results.length}</span>
			</button>
		</div>

		<ul>
			{#if tab === 'search'}
				{#each pages as item (item.id)}
					<li>
						<a
							href="/?q={encodeURIComponent(item.query)}&a={item.id}"
							onclick={() => (open = false)}
						>
							<b>{item.query}</b>
							<small>{item.count}개 · {date(item.createdAt)}</small>
						</a>
						<button class="icon-btn" aria-label="'{item.query}' 삭제" onclick={() => onremove(item)}>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
						</button>
					</li>
				{:else}
					<li class="empty">결과 화면의 <b>저장</b>을 누르면 검색 결과 전체가 여기에 보관돼요.</li>
				{/each}
			{:else}
				{#each results as item (item.id)}
					{#if item.kind === 'result'}
						<li>
							<a href={item.result.url} target="_blank" rel="noopener noreferrer">
								{#if item.result.image}
									<img
										src={item.result.image}
										alt=""
										loading="lazy"
										referrerpolicy="no-referrer"
										onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
									/>
								{/if}
								<span class="text">
									<b>{item.result.title}</b>
									<small>{host(item.result.url)} · {item.query}</small>
								</span>
							</a>
							<button
								class="icon-btn"
								aria-label="'{item.result.title}' 삭제"
								onclick={() => onremove(item)}
							>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
							</button>
						</li>
					{/if}
				{:else}
					<li class="empty">결과 옆 <b>북마크</b>를 누르면 그 결과가 여기에 보관돼요.</li>
				{/each}
			{/if}
		</ul>

		{#if user}
			<footer>
				<span class="avatar" aria-hidden="true">{user[0]}</span>
				<b>{user}</b>
				<button onclick={onlogout}>로그아웃</button>
			</footer>
		{/if}
	</nav>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		border: 0;
		background: var(--overlay);
		animation: fade 0.2s var(--ease);
	}

	.sidebar {
		position: fixed;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 51;
		display: flex;
		flex-direction: column;
		width: min(340px, 86vw);
		padding-bottom: env(safe-area-inset-bottom);
		background: var(--surface);
		border-right: 1px solid var(--border);
		box-shadow: var(--shadow);
		animation: slide 0.26s var(--ease);
	}

	header {
		display: flex;
		align-items: center;
		padding: 14px 10px 6px 20px;
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.icon-btn {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.icon-btn svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	.tabs {
		display: flex;
		gap: 4px;
		margin: 6px 14px 8px;
		padding: 3px;
		border-radius: 8px;
		background: var(--surface-2);
	}
	.tabs button {
		flex: 1;
		height: 34px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		font-size: 13.5px;
		color: var(--text-2);
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		box-shadow: var(--shadow-xs);
	}
	.tabs span {
		margin-left: 2px;
		color: var(--text-3);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	ul {
		flex: 1;
		margin: 0;
		padding: 0 8px 16px;
		list-style: none;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	li {
		display: flex;
		align-items: center;
		gap: 2px;
		border-radius: 6px;
	}
	li:hover {
		background: var(--surface-2);
	}
	li .icon-btn {
		margin-right: 4px;
		opacity: 0;
	}
	li:hover .icon-btn,
	li .icon-btn:focus-visible {
		opacity: 1;
	}
	@media (hover: none) {
		li .icon-btn {
			opacity: 1;
		}
	}

	a {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		padding: 10px 12px;
		color: var(--text);
		text-decoration: none;
	}
	a:has(img) {
		flex-direction: row;
		align-items: center;
		gap: 10px;
	}
	a img {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 8px;
		object-fit: cover;
		background: var(--surface-2);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	b {
		font-size: 14px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	small {
		font-size: 12px;
		color: var(--text-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty {
		display: block;
		padding: 24px 14px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-3);
	}
	.empty:hover {
		background: none;
	}
	.empty b {
		font-size: inherit;
		font-weight: 600;
		color: var(--text-2);
	}

	footer {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px 14px 18px;
		border-top: 1px solid var(--border);
	}
	.avatar {
		display: grid;
		place-items: center;
		flex: none;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 13px;
		font-weight: 700;
		text-transform: uppercase;
	}
	footer b {
		flex: 1;
	}
	footer button {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: transparent;
		font-size: 12.5px;
		color: var(--text-2);
		cursor: pointer;
	}
	footer button:hover {
		border-color: var(--rose);
		color: var(--rose);
	}

	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
