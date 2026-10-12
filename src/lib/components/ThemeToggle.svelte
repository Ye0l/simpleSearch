<script lang="ts">
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
</script>

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

<style>
	.theme {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		color: var(--text-2);
		transition:
			background-color 0.15s,
			color 0.15s;
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
</style>
