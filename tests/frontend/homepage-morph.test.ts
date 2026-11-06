import { describe, expect, it } from 'vitest';
import { pinFlightTypography } from '../../static/ts/homepage/flight';
import { buildMorphKeyframes, coverBox } from '../../static/ts/homepage/morph';

function parseKeyframe(keyframe: Keyframe): { tx: number; ty: number; scale: number; inset: [number, number, number, number] } {
  const transform = String(keyframe.transform);
  const translate = /translate3d\(([-\d.e]+)px, ([-\d.e]+)px/.exec(transform);
  const scale = /scale\(([-\d.e]+)\)/.exec(transform);
  const inset = /inset\(([^)]*)\)/.exec(String(keyframe.clipPath));
  if (!translate || !scale || !inset) throw new Error(`Unexpected keyframe: ${transform} ${keyframe.clipPath}`);
  return {
    tx: Number(translate[1]),
    ty: Number(translate[2]),
    scale: Number(scale[1]),
    inset: inset[1]!.split(' ').map((value) => Number.parseFloat(value)) as [number, number, number, number],
  };
}

/** Screen-space rect the clipped, transformed layer shows for a keyframe. */
function visibleBox(sourceMedia: ReturnType<typeof coverBox>, keyframe: Keyframe) {
  const { tx, ty, scale, inset } = parseKeyframe(keyframe);
  const [top, right, bottom, left] = inset;
  return {
    left: sourceMedia.left + tx + left * scale,
    top: sourceMedia.top + ty + top * scale,
    width: (sourceMedia.width - left - right) * scale,
    height: (sourceMedia.height - top - bottom) * scale,
  };
}

describe('coverBox', () => {
  it('fits wide media to a portrait frame by height, centered', () => {
    const box = coverBox({ left: 0, top: 0, width: 90, height: 160 }, 16 / 9);
    expect(box.height).toBeCloseTo(160);
    expect(box.width).toBeCloseTo(160 * 16 / 9);
    expect(box.left).toBeCloseTo((90 - box.width) / 2);
    expect(box.top).toBeCloseTo(0);
  });
});

describe('buildMorphKeyframes', () => {
  const thumb = { left: 100, top: 400, width: 540, height: 540 * 9 / 16 };
  const portraitHero = { left: 300, top: 20, width: 405, height: 720 };

  it('starts on the thumbnail frame and ends on the hero frame across aspect ratios', () => {
    const keyframes = buildMorphKeyframes(thumb, portraitHero, 16 / 9);
    const sourceMedia = coverBox(thumb, 16 / 9);
    const start = visibleBox(sourceMedia, keyframes[0]!);
    const end = visibleBox(sourceMedia, keyframes[keyframes.length - 1]!);

    for (const [actual, expected] of [[start, thumb], [end, portraitHero]] as const) {
      expect(actual.left).toBeCloseTo(expected.left);
      expect(actual.top).toBeCloseTo(expected.top);
      expect(actual.width).toBeCloseTo(expected.width);
      expect(actual.height).toBeCloseTo(expected.height);
    }
  });

  it('moves the visible window in a straight line between the frames', () => {
    const keyframes = buildMorphKeyframes(thumb, portraitHero, 16 / 9);
    const sourceMedia = coverBox(thumb, 16 / 9);

    for (const keyframe of keyframes) {
      const t = Number(keyframe.offset);
      const visible = visibleBox(sourceMedia, keyframe);
      expect(visible.left).toBeCloseTo(thumb.left + (portraitHero.left - thumb.left) * t);
      expect(visible.top).toBeCloseTo(thumb.top + (portraitHero.top - thumb.top) * t);
      expect(visible.width).toBeCloseTo(thumb.width + (portraitHero.width - thumb.width) * t);
      expect(visible.height).toBeCloseTo(thumb.height + (portraitHero.height - thumb.height) * t);
    }
  });

  it('needs no crop when the frames share the media aspect ratio', () => {
    const hero = { left: 40, top: 30, width: 960, height: 540 };
    for (const keyframe of buildMorphKeyframes(thumb, hero, 16 / 9)) {
      parseKeyframe(keyframe).inset.forEach((value) => expect(value).toBeCloseTo(0));
    }
  });
});

describe('pinFlightTypography', () => {
  it('pins every node to its own source metrics, not the root line-height', () => {
    const source = document.createElement('header');
    source.innerHTML = '<time style="font-size: 11.52px; line-height: 18.432px">2024</time><h2 style="font-size: 16px; line-height: 25.6px">Title</h2>';
    source.style.lineHeight = '25.6px';
    document.body.appendChild(source);
    const clone = source.cloneNode(true) as HTMLElement;
    clone.querySelectorAll<HTMLElement>('*').forEach((node) => node.removeAttribute('style'));

    pinFlightTypography(source, clone);

    const [date, title] = Array.from(clone.children) as [HTMLElement, HTMLElement];
    expect(clone.style.lineHeight).toBe('25.6px');
    expect(date.style.lineHeight).toBe('18.432px');
    expect(date.style.fontSize).toBe('11.52px');
    expect(title.style.lineHeight).toBe('25.6px');
    source.remove();
  });
});
