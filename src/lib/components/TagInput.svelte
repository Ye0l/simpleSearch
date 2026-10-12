<script lang="ts">
	// Enter or comma adds a tag; Backspace on an empty field removes the last one.
	let {
		tags,
		onchange,
		placeholder,
		label,
		prefix = ''
	}: {
		tags: string[];
		onchange: (tags: string[]) => void;
		placeholder: string;
		label: string;
		prefix?: string;
	} = $props();

	let draft = $state('');

	function commit() {
		const value = draft.trim().replace(/^"|"$/g, '');
		draft = '';
		if (value && !tags.includes(value)) onchange([...tags, value]);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Backspace' && !draft && tags.length) {
			onchange(tags.slice(0, -1));
		}
	}
</script>

<div class="tags">
	{#each tags as tag (tag)}
		<span class="tag">
			{prefix}{tag}
			<button
				aria-label="'{tag}' 삭제"
				onclick={() => onchange(tags.filter((t) => t !== tag))}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
			</button>
		</span>
	{/each}
	<input
		bind:value={draft}
		onkeydown={onKeydown}
		onblur={commit}
		{placeholder}
		aria-label={label}
		enterkeyhint="done"
	/>
</div>

<style>
	.tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-height: 42px;
		padding: 5px 8px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.tags:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--ring);
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		max-width: 100%;
		padding: 3px 4px 3px 10px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 13.5px;
		overflow-wrap: anywhere;
		animation: pop 0.16s var(--ease);
	}
	.tag button {
		display: grid;
		place-items: center;
		flex: none;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.tag button:hover {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.tag svg {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
	}
	input {
		flex: 1;
		min-width: 120px;
		height: 30px;
		padding: 0 4px;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 15px;
	}
	input::placeholder {
		color: var(--text-3);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.9);
		}
	}
</style>
