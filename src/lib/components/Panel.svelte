<script lang="ts">
	import type { Snippet } from 'svelte';

	// Inline card on wide screens, bottom sheet on phones.
	let {
		open = $bindable(),
		title,
		children,
		footer
	}: { open: boolean; title: string; children: Snippet; footer?: Snippet } = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) open = false;
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<button class="backdrop" aria-label="닫기" tabindex="-1" onclick={() => (open = false)}></button>
	<section class="panel" aria-label={title}>
		<header>
			<span class="grip" aria-hidden="true"></span>
			<h2>{title}</h2>
			<button class="close" aria-label="닫기" onclick={() => (open = false)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
			</button>
		</header>
		<div class="body">{@render children()}</div>
		{#if footer}
			<footer>{@render footer()}</footer>
		{/if}
	</section>
{/if}

<style>
	.backdrop {
		display: none;
	}

	.panel {
		margin: 10px 0 6px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 18px;
		box-shadow: var(--shadow);
		animation: drop 0.2s var(--ease);
	}

	header {
		display: flex;
		align-items: center;
		padding: 12px 10px 4px 18px;
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	.grip {
		display: none;
	}
	.close {
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
	.close:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.close svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	.body {
		display: grid;
		gap: 18px;
		padding: 8px 18px 16px;
	}

	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 18px 14px;
		border-top: 1px solid var(--border);
	}

	@media (max-width: 600px) {
		.backdrop {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 40;
			border: 0;
			background: rgb(10 8 20 / 0.32);
			animation: fade 0.2s var(--ease);
		}
		.panel {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 41;
			display: flex;
			flex-direction: column;
			max-height: min(72dvh, 640px);
			margin: 0;
			border-radius: 20px 20px 0 0;
			border-bottom: 0;
			animation: sheet 0.28s var(--ease);
		}
		header {
			position: relative;
			padding-top: 18px;
		}
		.grip {
			display: block;
			position: absolute;
			top: 7px;
			left: 50%;
			width: 36px;
			height: 4px;
			margin-left: -18px;
			border-radius: 2px;
			background: var(--border);
		}
		.body {
			overflow-y: auto;
			overscroll-behavior: contain;
		}
		footer {
			padding-bottom: calc(14px + env(safe-area-inset-bottom));
		}
	}

	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	@keyframes sheet {
		from {
			transform: translateY(100%);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
