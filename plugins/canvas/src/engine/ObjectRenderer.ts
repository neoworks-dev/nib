import { Container, Ticker } from 'pixi.js';
import type { CanvasObject, CanvasObjectRenderer, Rect } from '@nib-ui/ui-contracts';
import { easeInCubic, easeOutBack, easeOutCubic } from './utils/easing';
import { pointInRect } from './utils/geometry';

const SPAWN_MS = 380;
const EXIT_MS = 200;

/**
 * Shared spawn/exit animation and world-space hit testing. A kind only has to
 * build its container and keep it in sync with the data.
 */
export abstract class ObjectRenderer<TData extends CanvasObject = CanvasObject>
	implements CanvasObjectRenderer<TData>
{
	abstract readonly container: Container;

	protected spawnScale = 1;
	private spawnDone = true;
	private exiting = false;
	private readonly tickers = new Set<() => void>();

	abstract sync(data: TData, selection: string[]): void;

	/**
	 * World-space bounds. The default reads the container, which is correct only
	 * once it has been added to the stage; a kind that knows its own size should
	 * report it directly so hit tests work on the first frame.
	 */
	bounds(): Rect | null {
		const container = this.container;
		if (!container.parent) return null;
		const local = container.getLocalBounds();
		const scale = container.scale.x || 1;
		return {
			x: container.x + (local.x - container.pivot.x) * scale,
			y: container.y + (local.y - container.pivot.y) * scale,
			width: local.width * scale,
			height: local.height * scale,
		};
	}

	hitTest(worldX: number, worldY: number): boolean {
		const bounds = this.bounds();
		return bounds ? pointInRect(worldX, worldY, bounds) : false;
	}

	spawn(): void {
		this.spawnDone = false;
		this.spawnScale = 0.78;
		this.container.scale.set(this.spawnScale);
		this.container.alpha = 0;

		const start = performance.now();
		this.animate((now) => {
			const t = Math.min(1, (now - start) / SPAWN_MS);
			this.spawnScale = 0.78 + 0.22 * easeOutBack(t);
			this.container.scale.set(this.spawnScale);
			this.container.alpha = Math.min(1, t * 3);
			if (t < 1) return false;
			this.spawnScale = 1;
			this.spawnDone = true;
			this.container.scale.set(1);
			this.container.alpha = 1;
			return true;
		});
	}

	exit(done: () => void): void {
		if (this.exiting) return;
		this.exiting = true;
		this.container.eventMode = 'none';

		const start = performance.now();
		const alpha = this.container.alpha;
		const scaleX = this.container.scale.x;
		const scaleY = this.container.scale.y;
		this.animate((now) => {
			const t = Math.min(1, (now - start) / EXIT_MS);
			const shrink = 1 - 0.3 * easeInCubic(t);
			this.container.scale.set(scaleX * shrink, scaleY * shrink);
			this.container.alpha = alpha * (1 - t);
			if (t < 1) return false;
			done();
			return true;
		});
	}

	destroy(): void {
		for (const ticker of this.tickers) Ticker.shared.remove(ticker);
		this.tickers.clear();
		this.container.destroy({ children: true });
	}

	/** Eases the container to a point; a move under half a pixel snaps instead. */
	protected tweenTo(x: number, y: number, duration = 260): void {
		const fromX = this.container.x;
		const fromY = this.container.y;
		if (Math.hypot(x - fromX, y - fromY) < 0.5) {
			this.container.position.set(x, y);
			return;
		}

		const start = performance.now();
		this.animate((now) => {
			const t = Math.min(1, (now - start) / duration);
			const eased = easeOutCubic(t);
			this.container.position.set(fromX + (x - fromX) * eased, fromY + (y - fromY) * eased);
			return t >= 1;
		});
	}

	/** Hover grows the card slightly; the spawn animation owns the scale until it lands. */
	protected applyHoverScale(hover: number): void {
		const base = this.spawnDone ? 1 : this.spawnScale;
		this.container.scale.set(base * (1 + 0.015 * hover));
	}

	/** Runs `step` each frame until it returns true, and stops on `destroy`. */
	protected animate(step: (now: number) => boolean): void {
		const tick = () => {
			if (step(performance.now())) {
				Ticker.shared.remove(tick);
				this.tickers.delete(tick);
			}
		};
		this.tickers.add(tick);
		Ticker.shared.add(tick);
	}
}
