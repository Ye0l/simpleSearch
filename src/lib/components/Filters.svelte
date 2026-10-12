<script lang="ts">
	import TagInput from './TagInput.svelte';
	import { AGE_LABELS, hostOf, type Age, type ResultFilter } from '#lib/filter.ts';
	import type { Round, SearchResult } from '#lib/types.ts';

	let {
		filter = $bindable(),
		results,
		rounds
	}: { filter: ResultFilter; results: SearchResult[]; rounds: Round[] } = $props();

	const DOMAIN_PREVIEW = 10;
	let showAllDomains = $state(false);

	const domains = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const r of results) {
			const h = hostOf(r.url);
			counts.set(h, (counts.get(h) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	});

	const maxScore = $derived(Math.max(0, ...results.map((r) => r.score ?? 0)));
	const hasScores = $derived(results.some((r) => r.score !== undefined));

	const toggle = <T,>(list: T[], item: T) =>
		list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
</script>

<div class="field">
	<span class="label">포함할 단어</span>
	<TagInput
		tags={filter.include}
		onchange={(include) => (filter.include = include)}
		placeholder="제목·본문에 있어야 할 단어"
		label="포함할 단어"
	/>
</div>

<div class="field">
	<span class="label">제외할 단어</span>
	<TagInput
		tags={filter.exclude}
		onchange={(exclude) => (filter.exclude = exclude)}
		placeholder="들어 있으면 숨길 단어"
		label="제외할 단어"
	/>
</div>

{#if rounds.length > 1}
	<div class="field">
		<span class="label">검색어 <small>끄면 그 검색어로 찾은 결과를 숨겨요</small></span>
		<div class="chips">
			{#each rounds as r, i}
				{@const n = i + 1}
				<button
					class="check"
					aria-pressed={!filter.hiddenRounds.includes(n)}
					class:off={filter.hiddenRounds.includes(n)}
					onclick={() => (filter.hiddenRounds = toggle(filter.hiddenRounds, n))}
				>
					<span class="n">{n}</span>
					<span class="t">{r.query}</span>
					<span class="c">{r.count}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<div class="field">
	<span class="label">발행일</span>
	<div class="chips" role="radiogroup" aria-label="발행일">
		{#each Object.entries(AGE_LABELS) as [key, label]}
			<button
				role="radio"
				aria-checked={filter.age === key}
				class:on={filter.age === key}
				onclick={() => (filter.age = key as Age)}>{label}</button
			>
		{/each}
	</div>
</div>

{#if hasScores}
	<div class="field">
		<span class="label">
			최소 유사도
			<output>{filter.minScore > 0 ? filter.minScore.toFixed(2) : '제한 없음'}</output>
		</span>
		<input
			type="range"
			min="0"
			max={Math.ceil(maxScore * 20) / 20}
			step="0.01"
			bind:value={filter.minScore}
			aria-label="최소 유사도"
		/>
	</div>
{/if}

<div class="field">
	<span class="label">도메인 <small>눌러서 숨기기</small></span>
	<div class="chips">
		{#each showAllDomains ? domains : domains.slice(0, DOMAIN_PREVIEW) as [host, count] (host)}
			<button
				class="check"
				aria-pressed={!filter.hiddenDomains.includes(host)}
				class:off={filter.hiddenDomains.includes(host)}
				onclick={() => (filter.hiddenDomains = toggle(filter.hiddenDomains, host))}
			>
				<span class="t">{host}</span>
				<span class="c">{count}</span>
			</button>
		{/each}
		{#if domains.length > DOMAIN_PREVIEW}
			<button class="more" onclick={() => (showAllDomains = !showAllDomains)}>
				{showAllDomains ? '접기' : `+${domains.length - DOMAIN_PREVIEW}개 더`}
			</button>
		{/if}
	</div>
</div>

<style>
	.field {
		display: grid;
		gap: 8px;
	}
	.label {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	small,
	output {
		font-weight: 400;
		color: var(--text-3);
	}
	output {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		color: var(--accent-strong);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chips button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		font-size: 13.5px;
		color: var(--text-2);
		cursor: pointer;
		transition:
			background-color 0.15s,
			border-color 0.15s,
			color 0.15s,
			opacity 0.15s;
	}
	.chips button:hover {
		border-color: var(--accent);
	}
	.chips button.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.check {
		border-color: transparent !important;
		background: var(--accent-soft) !important;
		color: var(--accent-strong) !important;
	}
	.check.off {
		background: var(--surface-2) !important;
		color: var(--text-3) !important;
	}
	.check.off .t {
		text-decoration: line-through;
	}
	.check .t {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.check .n {
		display: grid;
		place-items: center;
		flex: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--surface);
		font-size: 11px;
		font-weight: 600;
	}
	.check .c {
		flex: none;
		font-size: 12px;
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}
	.more {
		color: var(--text-3) !important;
		border-style: dashed !important;
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}
</style>
