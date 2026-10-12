<script lang="ts">
	import TagInput from './TagInput.svelte';
	import {
		LANGUAGES,
		WHEN_LABELS,
		describeQuery,
		parseQuery,
		stringifyQuery,
		type ParsedQuery,
		type When
	} from '#lib/query.ts';

	// Edits the search box text: every toggle rewrites `value` with the matching operators.
	let { value = $bindable() }: { value: string } = $props();

	const parsed = $derived(parseQuery(value));
	const applied = $derived(describeQuery(parsed));
	let custom = $state(false);
	const showRange = $derived(custom || !!parsed.after || !!parsed.before);

	function update(change: Partial<ParsedQuery>) {
		value = stringifyQuery({ ...parsed, ...change });
	}

	function setWhen(when: When | undefined) {
		custom = false;
		update({ when, after: undefined, before: undefined });
	}

	let siteDraft = $state('');
	let siteMode = $state<'include' | 'exclude'>('include');

	function addSite() {
		const site = siteDraft
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/.*$/, '');
		siteDraft = '';
		if (!site) return;
		if (siteMode === 'include' && !parsed.sites.includes(site)) {
			update({ sites: [...parsed.sites, site] });
		} else if (siteMode === 'exclude' && !parsed.excludeSites.includes(site)) {
			update({ excludeSites: [...parsed.excludeSites, site] });
		}
	}
</script>

<div class="field">
	<span class="label">기간 <code>when:</code> <code>after:</code> <code>before:</code></span>
	<div class="chips" role="radiogroup" aria-label="기간">
		<button
			role="radio"
			aria-checked={!parsed.when && !showRange}
			class:on={!parsed.when && !showRange}
			onclick={() => setWhen(undefined)}>전체</button
		>
		{#each Object.entries(WHEN_LABELS) as [key, label]}
			<button
				role="radio"
				aria-checked={parsed.when === key}
				class:on={parsed.when === key}
				onclick={() => setWhen(key as When)}>{label}</button
			>
		{/each}
		<button
			role="radio"
			aria-checked={showRange && !parsed.when}
			class:on={showRange && !parsed.when}
			onclick={() => {
				custom = true;
				update({ when: undefined });
			}}>직접 지정</button
		>
	</div>
	{#if showRange && !parsed.when}
		<div class="range">
			<input
				type="date"
				aria-label="시작일"
				value={parsed.after ?? ''}
				max={parsed.before}
				onchange={(e) => update({ after: e.currentTarget.value || undefined })}
			/>
			<span>~</span>
			<input
				type="date"
				aria-label="종료일"
				value={parsed.before ?? ''}
				min={parsed.after}
				onchange={(e) => update({ before: e.currentTarget.value || undefined })}
			/>
		</div>
	{/if}
</div>

<div class="field">
	<span class="label">언어 <code>lang:</code></span>
	<div class="chips" role="radiogroup" aria-label="언어">
		<button
			role="radio"
			aria-checked={!parsed.lang}
			class:on={!parsed.lang}
			onclick={() => update({ lang: undefined })}>전체</button
		>
		{#each Object.entries(LANGUAGES) as [code, label]}
			<button
				role="radio"
				aria-checked={parsed.lang === code}
				class:on={parsed.lang === code}
				onclick={() => update({ lang: code })}>{label}</button
			>
		{/each}
	</div>
</div>

<div class="field">
	<span class="label">사이트 <code>site:</code> <code>-site:</code></span>
	<div class="site">
		<div class="seg" role="radiogroup" aria-label="사이트 모드">
			<button
				role="radio"
				aria-checked={siteMode === 'include'}
				class:on={siteMode === 'include'}
				onclick={() => (siteMode = 'include')}>포함</button
			>
			<button
				role="radio"
				aria-checked={siteMode === 'exclude'}
				class:on={siteMode === 'exclude'}
				onclick={() => (siteMode = 'exclude')}>제외</button
			>
		</div>
		<input
			bind:value={siteDraft}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.isComposing) {
					e.preventDefault();
					addSite();
				}
			}}
			onblur={addSite}
			placeholder="example.com"
			aria-label="사이트 도메인"
			inputmode="url"
			enterkeyhint="done"
		/>
	</div>
	{#if parsed.sites.length || parsed.excludeSites.length}
		<div class="chips">
			{#each parsed.sites as site}
				<button
					class="tag"
					aria-label="'{site}' 제거"
					onclick={() => update({ sites: parsed.sites.filter((s) => s !== site) })}
					>+ {site} <span aria-hidden="true">×</span></button
				>
			{/each}
			{#each parsed.excludeSites as site}
				<button
					class="tag neg"
					aria-label="'{site}' 제거"
					onclick={() => update({ excludeSites: parsed.excludeSites.filter((s) => s !== site) })}
					>− {site} <span aria-hidden="true">×</span></button
				>
			{/each}
		</div>
	{/if}
	{#if parsed.sites.length && parsed.excludeSites.length}
		<p class="hint">포함과 제외를 함께 쓰면 제외는 결과 후처리로 적용돼요.</p>
	{/if}
</div>

<div class="field">
	<span class="label">정확히 일치하는 구문 <code>"…"</code></span>
	<TagInput
		tags={parsed.phrases}
		onchange={(phrases) => update({ phrases })}
		placeholder="구문 입력 후 Enter"
		label="정확히 일치하는 구문"
	/>
</div>

<div class="field">
	<span class="label">다음 중 하나 이상 <code>OR</code></span>
	<TagInput
		tags={parsed.anyOf}
		onchange={(anyOf) => update({ anyOf })}
		placeholder="단어 입력 후 Enter"
		label="다음 중 하나 이상 포함"
	/>
</div>

{#if applied.length}
	<div class="applied">
		<span class="label">검색 시 적용</span>
		<ul>
			{#each applied as item}
				<li class:post={!item.api}><b>{item.label}</b> <code>{item.via}</code></li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.applied {
		display: grid;
		gap: 6px;
		padding: 12px 14px;
		border-radius: 8px;
		background: var(--surface-2);
	}
	.applied ul {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 13px;
	}
	.applied b {
		font-weight: 600;
		color: var(--accent-strong);
		overflow-wrap: anywhere;
	}
	.applied .post b {
		color: var(--text-2);
	}
	.field {
		display: grid;
		gap: 8px;
	}
	.label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	code {
		padding: 0 5px;
		border-radius: 5px;
		background: var(--surface-2);
		font: 11.5px/1.6 ui-monospace, monospace;
		font-weight: 400;
		color: var(--text-3);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chips button,
	.seg button {
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		box-shadow: var(--shadow-xs);
		font-size: 13.5px;
		color: var(--text-2);
		cursor: pointer;
		transition:
			background-color 0.15s,
			border-color 0.15s,
			color 0.15s;
	}
	.chips button:hover,
	.seg button:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.chips button.on,
	.seg button.on {
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.chips .tag {
		border-color: transparent;
		background: var(--accent-soft);
		color: var(--accent-strong);
	}
	.chips .tag.neg {
		background: var(--rose-soft);
		color: var(--rose);
	}

	.range {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-3);
	}
	.range input,
	.site input {
		flex: 1;
		min-width: 0;
		height: 40px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		box-shadow: var(--shadow-xs);
		font-size: 15px;
		outline: 0;
	}
	.range input:focus,
	.site input:focus {
		border-color: var(--ring-border);
		box-shadow: 0 0 0 3px var(--ring);
	}

	.site {
		display: flex;
		gap: 8px;
	}
	.seg {
		display: flex;
		flex: none;
		gap: 4px;
	}
	.seg button {
		height: 40px;
		border-radius: 8px;
	}

	.hint {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-3);
	}
</style>
