const MORPH_KEYFRAME_STEPS = 12;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The box media of `aspectRatio` fills when cover-fit and centered in `frame`. */
export function coverBox(frame: Box, aspectRatio: number): Box {
  if (!(aspectRatio > 0) || frame.width <= 0 || frame.height <= 0) {
    return { left: frame.left, top: frame.top, width: frame.width, height: frame.height };
  }
  const fitsWidth = frame.width / frame.height > aspectRatio;
  const width = fitsWidth ? frame.width : frame.height * aspectRatio;
  const height = fitsWidth ? frame.width / aspectRatio : frame.height;
  return {
    left: frame.left + (frame.width - width) / 2,
    top: frame.top + (frame.height - height) / 2,
    width,
    height,
  };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpBox(from: Box, to: Box, t: number): Box {
  return {
    left: lerp(from.left, to.left, t),
    top: lerp(from.top, to.top, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
  };
}

/**
 * Shared-element morph between frames of different shapes. The media keeps its
 * own aspect ratio and only scales uniformly, while a clip-path crops it to the
 * frame, so a 16:9 thumbnail can open into a portrait hero without stretching.
 * Keyframes sample the frame and media boxes linearly so the visible window
 * tracks a straight interpolation between the two frames.
 */
export function buildMorphKeyframes(sourceFrame: Box, targetFrame: Box, mediaAspectRatio: number): Keyframe[] {
  const sourceMedia = coverBox(sourceFrame, mediaAspectRatio);
  const targetMedia = coverBox(targetFrame, mediaAspectRatio);
  const keyframes: Keyframe[] = [];

  for (let step = 0; step <= MORPH_KEYFRAME_STEPS; step += 1) {
    const t = step / MORPH_KEYFRAME_STEPS;
    const frame = lerpBox(sourceFrame, targetFrame, t);
    const media = lerpBox(sourceMedia, targetMedia, t);
    const scale = sourceMedia.width > 0 ? media.width / sourceMedia.width : 1;
    const toLocal = (value: number): number => Math.max(0, value / (scale || 1));
    const insetTop = toLocal(frame.top - media.top);
    const insetRight = toLocal((media.left + media.width) - (frame.left + frame.width));
    const insetBottom = toLocal((media.top + media.height) - (frame.top + frame.height));
    const insetLeft = toLocal(frame.left - media.left);

    keyframes.push({
      offset: t,
      transform: `translate3d(${media.left - sourceMedia.left}px, ${media.top - sourceMedia.top}px, 0px) scale(${scale})`,
      clipPath: `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px)`,
      opacity: 1,
    });
  }

  return keyframes;
}
