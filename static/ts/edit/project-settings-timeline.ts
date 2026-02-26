export function renderProjectSettingsTimelineFrames(
  root: ParentNode | null,
  framesB64: string[]
): number {
  if (!root) return 0;
  const canvas = root.querySelector('.edit-hero-timeline-thumbs') as HTMLCanvasElement | null;
  if (!canvas || !framesB64 || framesB64.length === 0) return 0;

  const track = canvas.parentElement;
  if (!track) return 0;
  const trackWidth = track.clientWidth;
  const trackHeight = track.clientHeight;

  // Size canvas to match track at device pixel ratio
  const dpr = window.devicePixelRatio || 1;
  canvas.width = trackWidth * dpr;
  canvas.height = trackHeight * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, trackWidth, trackHeight);

  const numThumbs = framesB64.length;
  const loadedImages: Array<HTMLImageElement | null> = new Array(numThumbs).fill(null);
  let completed = 0;

  const drawSlice = (img: HTMLImageElement, index: number): void => {
    // Integer slice boundaries avoid hairline seams.
    const x0 = Math.floor((index * trackWidth) / numThumbs);
    const x1 = index === numThumbs - 1
      ? trackWidth
      : Math.floor(((index + 1) * trackWidth) / numThumbs);
    const drawWidth = Math.max(1, x1 - x0);

    // "Cover" crop so each slice fills destination without squish.
    const srcAspect = img.width / img.height;
    const dstAspect = drawWidth / trackHeight;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (srcAspect > dstAspect) {
      sw = Math.max(1, Math.round(img.height * dstAspect));
      sx = Math.max(0, Math.floor((img.width - sw) / 2));
    } else if (srcAspect < dstAspect) {
      sh = Math.max(1, Math.round(img.width / dstAspect));
      sy = Math.max(0, Math.floor((img.height - sh) / 2));
    }

    // Slight overlap hides anti-aliased seam artifacts between slices.
    const dstX = Math.max(0, x0 - (index > 0 ? 1 : 0));
    const dstW = Math.min(trackWidth - dstX, drawWidth + (index > 0 ? 1 : 0));
    ctx.drawImage(img, sx, sy, sw, sh, dstX, 0, dstW, trackHeight);
  };

  const finishOne = (): void => {
    completed++;
    if (completed !== numThumbs) return;

    ctx.clearRect(0, 0, trackWidth, trackHeight);

    // Fill any failed slots with nearest valid neighbor to avoid visible holes.
    let lastValid: HTMLImageElement | null = null;
    for (let i = 0; i < numThumbs; i++) {
      const current = loadedImages[i] ?? null;
      if (current) {
        lastValid = current;
      } else if (lastValid) {
        loadedImages[i] = lastValid;
      }
    }
    let nextValid: HTMLImageElement | null = null;
    for (let i = numThumbs - 1; i >= 0; i--) {
      const current = loadedImages[i] ?? null;
      if (current) {
        nextValid = current;
      } else if (nextValid) {
        loadedImages[i] = nextValid;
      }
    }

    for (let i = 0; i < numThumbs; i++) {
      const img = loadedImages[i];
      if (img) drawSlice(img, i);
    }

    canvas.classList.add('loaded');
  };

  framesB64.forEach((b64Data, i) => {
    const img = new Image();
    img.onload = (): void => {
      loadedImages[i] = img;
      finishOne();
    };
    img.onerror = finishOne;
    img.src = 'data:image/jpeg;base64,' + b64Data;
  });

  return numThumbs;
}
