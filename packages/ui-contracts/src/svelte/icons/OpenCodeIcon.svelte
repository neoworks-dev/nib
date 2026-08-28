<script lang="ts">
	import type { BrandIconProps } from './props';

	// opencode mark, from lobe-icons (MIT), inlined to avoid an icon-package dependency.
	const { size = 16, color = 'currentColor', weight: _weight, mirrored: _mirrored, ...rest }: BrandIconProps = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill={color}
	fill-rule="evenodd"
	aria-hidden="true"
	xmlns="http://www.w3.org/2000/svg"
	{...rest}
>
	<path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" />
</svg>
