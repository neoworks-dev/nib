import type { SVGAttributes } from 'svelte/elements';

/**
 * Mirrors the phosphor icon prop shape so brand glyphs are interchangeable with
 * phosphor icons wherever an `IconComponent` is expected.
 */
export type BrandIconProps = Omit<SVGAttributes<SVGSVGElement>, 'color'> & {
	size?: number | string;
	color?: string;
	weight?: string;
	mirrored?: boolean;
};
