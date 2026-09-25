/**
 * Which clips on a board are allowed to run.
 *
 * Decoding is the expensive half of showing a video and it is paid per clip, not
 * per pixel drawn: a folder of twelve 4K60 clips is twelve decoders, and one
 * machine manages that where another manages two. So the number is not a constant
 * — the board plays as many as it can and keeps its frame rate, adding one at a
 * time while frames stay quick and giving one up as soon as they do not. Which
 * ones play is the largest on screen; everything else holds the frame it stopped
 * on, so a card that is not running is still a picture.
 *
 * The claims are re-read on a timer rather than per frame, so panning across a
 * board does not start and stop a decoder every time a card crosses an edge.
 */

/** Never fewer than this, however slow the board is: a board of stills is not a board. */
export const MIN_PLAYING = 1;
/** And never more, however fast: past a point this is a wall of moving thumbnails. */
export const MAX_PLAYING = 12;
/** Where a board starts before it has measured itself. */
export const START_PLAYING = 3;

/** How often the claims are weighed against each other. */
export const REVIEW_MS = 250;

/** A claim not renewed within this is the card having gone quiet, or gone. */
const STALE_MS = REVIEW_MS * 4;

/**
 * Smoothed frame times the budget steers by: under the first there is room for
 * another decoder, over the second the board is already behind. The gap between
 * them is what stops it adding and dropping the same clip forever.
 */
const FRAME_ROOM_MS = 19;
const FRAME_OVER_MS = 26;
/** How long between changes, so a clip gets a fair chance to show what it costs. */
const ADJUST_MS = 1200;
/** Frames to watch before trusting the average at all. */
const FRAME_SAMPLES = 30;
/** A frame longer than this was a tab in the background, not a board under load. */
const FRAME_OUTLIER_MS = 120;

/** What the budget needs of a video element, and all a test needs to stand in for one. */
export interface Playable {
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

interface Claim {
  clip: Playable;
  /** Screen pixels the card covers: what makes one clip worth more than another. */
  area: number;
  seen: number;
}

export class PlaybackBudget {
  private readonly claims = new Map<string, Claim>();
  /** Null until the first claim: nothing has been weighed against anything yet. */
  private reviewedAt: number | null = null;

  /** How many may run now. Measured, not chosen: see `adjust`. */
  private limit: number;
  private adjustedAt: number | null = null;
  private frameMs = 0;
  private frames = 0;
  private frameAt: number | null = null;

  constructor(
    private readonly ceiling = MAX_PLAYING,
    private readonly reviewMs = REVIEW_MS,
  ) {
    this.limit = Math.min(START_PLAYING, ceiling);
  }

  /**
   * A frame went by. Called from the cards, which each call once a frame, so a
   * reading that lands in the same frame as the last one is another card saying
   * the same thing and is dropped.
   */
  frame(now: number): void {
    const last = this.frameAt;
    this.frameAt = now;
    if (last === null) return;

    const delta = now - last;
    if (delta < 1 || delta > FRAME_OUTLIER_MS) return;
    this.frames += 1;
    // Exponential: the board's recent behaviour, not its history.
    this.frameMs = this.frames === 1 ? delta : this.frameMs + (delta - this.frameMs) * 0.1;
  }

  /**
   * A card saying it is on screen and how much of it there is. Renewed every
   * frame; what it is worth against the other claims is settled on the timer.
   */
  claim(id: string, clip: Playable, area: number, now = performance.now()): void {
    this.claims.set(id, { clip, area, seen: now });
    this.review(now);
  }

  /** A card that has gone off screen, or gone entirely. Its clip stops at once. */
  release(id: string, now = performance.now()): void {
    const claim = this.claims.get(id);
    if (!claim) return;
    this.claims.delete(id);
    if (!claim.clip.paused) claim.clip.pause();
    this.review(now);
  }

  /** Which cards hold the budget, largest first. */
  playing(): string[] {
    return this.ranked().slice(0, this.limit);
  }

  /** How many may run at once as the board currently measures itself. */
  get allowance(): number {
    return this.limit;
  }

  private ranked(): string[] {
    return [...this.claims.entries()]
      .sort(([, left], [, right]) => right.area - left.area)
      .map(([id]) => id);
  }

  /**
   * Hands the budget to the biggest claims and stops everything else. A claim
   * nobody renewed belongs to a card that was torn down mid-frame, and its clip
   * is stopped on the way out.
   */
  private review(now: number): void {
    // The first claim on a board is one of a dozen arriving in the same frame.
    // They are weighed once they are all in, so the budget is not handed to
    // whichever card happened to finish loading first and taken back a frame later.
    if (this.reviewedAt === null) {
      this.reviewedAt = now;
      return;
    }
    if (now - this.reviewedAt < this.reviewMs) return;
    this.reviewedAt = now;

    for (const [id, claim] of this.claims) {
      if (now - claim.seen <= STALE_MS) continue;
      this.claims.delete(id);
      if (!claim.clip.paused) claim.clip.pause();
    }

    this.adjust(now);

    const winners = new Set(this.playing());
    for (const [id, claim] of this.claims) {
      const wanted = winners.has(id);
      if (wanted && claim.clip.paused) start(claim.clip);
      if (!wanted && !claim.clip.paused) claim.clip.pause();
    }
  }

  /**
   * Moves the allowance one clip at a time against what the board is measuring.
   * Only while there is something waiting for it: a board whose clips all run
   * already has nothing to learn from raising the number.
   */
  private adjust(now: number): void {
    if (this.frames < FRAME_SAMPLES) return;
    if (this.adjustedAt !== null && now - this.adjustedAt < ADJUST_MS) return;

    const over = this.frameMs > FRAME_OVER_MS && this.limit > MIN_PLAYING;
    const room =
      this.frameMs < FRAME_ROOM_MS && this.limit < this.ceiling && this.claims.size > this.limit;
    if (!over && !room) return;

    this.adjustedAt = now;
    this.limit += over ? -1 : 1;
  }
}

function start(clip: Playable): void {
  void Promise.resolve(clip.play()).catch(() => {
    // Refused, as autoplay is until the page has been interacted with. The frame
    // already on the card stands until the next review tries again.
  });
}

/** The board's own budget. One board is on screen at a time, so one is enough. */
export const playbackBudget = new PlaybackBudget();
