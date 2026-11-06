import { buildMorphKeyframes, coverBox, type Box } from './morph';
import type { SpriteThumbnail } from './sprite-runtime';

const HERO_BRIDGE_FADE_MS = 180;
const EASING_STANDARD = 'cubic-bezier(0.2, 0.0, 0, 1)';

/** One end of a shared-element flight: the frame the media fills and the heading beside it. */
interface FlightEnd {
  frame: HTMLElement;
  heading: HTMLElement | null;
}

interface MeasuredHeading {
  el: HTMLElement;
  rect: DOMRect;
}

interface FlightPath {
  sourceRect: DOMRect;
  targetRect: DOMRect;
  sourceHeading: MeasuredHeading | null;
  targetHeading: MeasuredHeading | null;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function waitForAnimation(animation: Animation): Promise<void> {
  return animation.finished.then(() => undefined, () => undefined);
}

function measureHeading(el: HTMLElement | null): MeasuredHeading | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width >= 1 && rect.height >= 1 ? { el, rect } : null;
}

/** Null when either frame has no box to fly between. */
export function measureFlight(source: FlightEnd, target: FlightEnd): FlightPath | null {
  const sourceRect = source.frame.getBoundingClientRect();
  const targetRect = target.frame.getBoundingClientRect();
  if (sourceRect.width < 1 || sourceRect.height < 1 || targetRect.width < 1 || targetRect.height < 1) {
    return null;
  }
  return {
    sourceRect,
    targetRect,
    sourceHeading: measureHeading(source.heading),
    targetHeading: measureHeading(target.heading),
  };
}

/**
 * Pins each node of a heading clone to its source's resolved type metrics, so
 * the clone lays out identically outside the source's cascade. Pinning only
 * the root would hand its resolved px line-height to smaller children (the
 * date), stretching their lines and offsetting the clone from the real heading.
 */
export function pinFlightTypography(source: HTMLElement, clone: HTMLElement): void {
  const sources = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const clones = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  sources.forEach((sourceNode, index) => {
    const cloneNode = clones[index];
    if (!cloneNode) return;
    const computed = window.getComputedStyle(sourceNode);
    cloneNode.style.fontFamily = computed.fontFamily;
    cloneNode.style.fontSize = computed.fontSize;
    cloneNode.style.fontWeight = computed.fontWeight;
    cloneNode.style.lineHeight = computed.lineHeight;
    cloneNode.style.letterSpacing = computed.letterSpacing;
  });
}

/** The overlay that carries a card's media and heading between the list and the detail. */
export class TransitionFlight {
  private readonly layer: HTMLElement;
  private animations: Animation[] = [];
  private headingClones: HTMLElement[] = [];

  constructor(layer: HTMLElement) {
    this.layer = layer;
  }

  async run(
    path: FlightPath,
    thumbnail: SpriteThumbnail,
    frameIndex: number,
    durationMs: number,
    signal: AbortSignal
  ): Promise<void> {
    const mediaAspectRatio = thumbnail.getSourceAspectRatio();
    const keyframes = buildMorphKeyframes(path.sourceRect, path.targetRect, mediaAspectRatio);
    const sourceMedia = coverBox(path.sourceRect, mediaAspectRatio);
    this.mountLayer(thumbnail, frameIndex, sourceMedia, keyframes[0]);

    const timing: KeyframeAnimationOptions = { duration: durationMs, easing: EASING_STANDARD, fill: 'forwards' };
    this.animations = [
      ...this.flyHeadings(path.sourceHeading, path.targetHeading, timing),
      this.layer.animate(keyframes, timing),
    ];
    await Promise.all(this.animations.map(waitForAnimation));
    if (!signal.aborted) {
      this.cancel();
    }
  }

  cancel(): void {
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    this.headingClones.forEach((clone) => clone.remove());
    this.headingClones = [];
    this.layer.classList.remove('homepage-active');
    this.layer.removeAttribute('style');
    this.layer.innerHTML = '';
  }

  private mountLayer(thumbnail: SpriteThumbnail, frameIndex: number, media: Box, firstKeyframe: Keyframe | undefined): void {
    const visual = document.createElement('div');
    visual.className = 'homepage-transition-visual';
    visual.appendChild(thumbnail.createFrameNode(frameIndex, {
      className: 'homepage-transition-media-layer',
      width: Math.max(1, Math.round(media.width)),
      height: Math.max(1, Math.round(media.height)),
    }));

    this.layer.innerHTML = '';
    this.layer.appendChild(visual);
    this.layer.style.left = `${media.left}px`;
    this.layer.style.top = `${media.top}px`;
    this.layer.style.width = `${media.width}px`;
    this.layer.style.height = `${media.height}px`;
    this.layer.style.transform = String(firstKeyframe?.transform ?? 'none');
    this.layer.style.clipPath = String(firstKeyframe?.clipPath ?? '');
    this.layer.classList.add('homepage-active');
  }

  private mountHeadingClone(end: MeasuredHeading): HTMLElement {
    const clone = end.el.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.removeAttribute('data-open-project');
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    clone.classList.remove('homepage-source-hidden', 'homepage-target-hidden');
    clone.classList.add('homepage-heading-flight');
    clone.setAttribute('aria-hidden', 'true');

    clone.style.left = `${end.rect.left}px`;
    clone.style.top = `${end.rect.top}px`;
    clone.style.width = `${end.rect.width}px`;
    pinFlightTypography(end.el, clone);

    document.body.appendChild(clone);
    this.headingClones.push(clone);
    return clone;
  }

  /**
   * Headings that wrap the same way move as one layer; when the wider detail
   * header rewraps the title, the two layouts cross-fade along the same path
   * instead of snapping at the end.
   */
  private flyHeadings(
    source: MeasuredHeading | null,
    target: MeasuredHeading | null,
    timing: KeyframeAnimationOptions
  ): Animation[] {
    if (!source || !target) return [];

    const dx = target.rect.left - source.rect.left;
    const dy = target.rect.top - source.rect.top;
    const sameLayout = Math.abs(source.rect.height - target.rect.height) < 1;
    const fromColor = window.getComputedStyle(source.el).color;
    const toColor = window.getComputedStyle(target.el).color;

    const animations = [
      this.mountHeadingClone(source).animate([
        { transform: 'translate3d(0px, 0px, 0px)', color: fromColor, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)`, color: toColor, opacity: sameLayout ? 1 : 0 },
      ], timing),
    ];
    if (!sameLayout) {
      animations.push(this.mountHeadingClone(target).animate([
        { transform: `translate3d(${-dx}px, ${-dy}px, 0px)`, color: fromColor, opacity: 0 },
        { transform: 'translate3d(0px, 0px, 0px)', color: toColor, opacity: 1 },
      ], timing));
    }
    return animations;
  }
}

/**
 * Holds the card's frame over the hero until the video can paint, so the flight
 * lands on the same picture and cross-fades into the video when it is ready.
 */
export async function coverHeroUntilReady(
  heroFrame: HTMLElement,
  thumbnail: SpriteThumbnail,
  frameIndex: number,
  ready: Promise<boolean>,
  signal: AbortSignal
): Promise<void> {
  const bridge = thumbnail.createFrameNode(frameIndex, {
    className: 'homepage-hero-bridge',
    width: Math.max(1, Math.round(heroFrame.clientWidth || 1)),
    height: Math.max(1, Math.round(heroFrame.clientHeight || 1)),
  });
  bridge.setAttribute('aria-hidden', 'true');
  heroFrame.appendChild(bridge);

  const isReady = await ready;
  if (signal.aborted) return;

  if (isReady && !prefersReducedMotion()) {
    await waitForAnimation(bridge.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: HERO_BRIDGE_FADE_MS, easing: EASING_STANDARD, fill: 'forwards' }
    ));
    if (signal.aborted) return;
  }
  bridge.remove();
}
