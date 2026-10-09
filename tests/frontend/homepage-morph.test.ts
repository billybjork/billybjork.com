import { describe, expect, it } from 'vitest';
import { buildMorphKeyframes, coverBox } from '../../static/ts/homepage/controller';

function parseKeyframe(keyframe: Keyframe): { tx: number; ty: number; scale: number; inset: number[] } {
  const transform = String(keyframe.transform);
  const translate = /translate3d\(([-\d.e]+)px, ([-\d.e]+)px/.exec(transform);
  const scale = /scale\(([-\d.e]+)\)/.exec(transform);
  const inset = /inset\(([^)]*)\)/.exec(String(keyframe.clipPath));
  if (!translate || !scale || !inset) throw new Error(`Unexpected keyframe: ${transform} ${keyframe.clipPath}`);
  return {
    tx: Number(translate[1]),
    ty: Number(translate[2]),
    scale: Number(scale[1]),
    inset: inset[1].split(' ').map((value) => Number.parseFloat(value)),
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
    const start = visibleBox(sourceMedia, keyframes[0]);
    const end = visibleBox(sourceMedia, keyframes[keyframes.length - 1]);

    for (const [actual, expected] of [[start, thumb], [end, portraitHero]] as const) {
      expect(actual.left).toBeCloseTo(expected.left);
      expect(actual.top).toBeCloseTo(expected.top);
      expect(actual.width).toBeCloseTo(expected.width);
      expect(actual.height).toBeCloseTo(expected.height);
    }
  });

  it('scales media uniformly so it never stretches mid-flight', () => {
    const keyframes = buildMorphKeyframes(thumb, portraitHero, 16 / 9);
    for (const keyframe of keyframes) {
      expect(String(keyframe.transform)).toMatch(/scale\([-\d.e]+\)$/);
    }
    expect(keyframes[0].offset).toBe(0);
    expect(keyframes[keyframes.length - 1].offset).toBe(1);
  });

  it('needs no crop when the frames share the media aspect ratio', () => {
    const hero = { left: 40, top: 30, width: 960, height: 540 };
    for (const keyframe of buildMorphKeyframes(thumb, hero, 16 / 9)) {
      parseKeyframe(keyframe).inset.forEach((value) => expect(value).toBeCloseTo(0));
    }
  });
});
