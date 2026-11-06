import {
  attachHlsPlayback,
  destroyHlsInstance,
  isAbortError,
  resetVideoElementSource,
} from '../core/hls';
import { readPositiveNumber } from '../core/numbers';

const HLS_LEVEL_ASPECT_DRIFT_TOLERANCE = 0.0015;

interface HeroPlayer {
  abortController: AbortController;
  unbindLayout: () => void;
}

const heroPlayers = new WeakMap<HTMLVideoElement, HeroPlayer>();

function getVideoContainer(videoElement: HTMLVideoElement): HTMLElement | null {
  return videoElement.closest<HTMLElement>('.video-container');
}

function resolveVideoAspectRatio(videoElement: HTMLVideoElement): number | null {
  const metadataWidth = readPositiveNumber(videoElement.dataset.videoWidth);
  const metadataHeight = readPositiveNumber(videoElement.dataset.videoHeight);
  if (metadataWidth && metadataHeight) {
    return metadataWidth / metadataHeight;
  }

  const nativeWidth = videoElement.videoWidth;
  const nativeHeight = videoElement.videoHeight;
  if (nativeWidth > 0 && nativeHeight > 0) {
    return nativeWidth / nativeHeight;
  }

  return null;
}

function updateVideoContainerAspectRatio(videoElement: HTMLVideoElement): void {
  const container = getVideoContainer(videoElement);
  if (!container) return;

  const aspectRatio = resolveVideoAspectRatio(videoElement);
  if (aspectRatio) {
    container.style.setProperty('--video-aspect-ratio', aspectRatio.toString());
  }
}

function bindVideoLayout(videoElement: HTMLVideoElement): () => void {
  const refreshLayout = () => updateVideoContainerAspectRatio(videoElement);

  videoElement.addEventListener('loadedmetadata', refreshLayout);
  videoElement.addEventListener('resize', refreshLayout);
  refreshLayout();

  return () => {
    videoElement.removeEventListener('loadedmetadata', refreshLayout);
    videoElement.removeEventListener('resize', refreshLayout);
  };
}

interface HlsLevelSelection {
  index: number;
  width: number | null;
  height: number;
  bitrate: number;
  aspectDrift: number;
}

function selectStableHlsLevel(hls: Hls, videoElement: HTMLVideoElement): number | null {
  const targetAspectRatio = resolveVideoAspectRatio(videoElement);
  const containerRect = getVideoContainer(videoElement)?.getBoundingClientRect();
  const targetRenderWidth = containerRect?.width ?? videoElement.clientWidth ?? 0;
  const targetRenderHeight = containerRect?.height ?? videoElement.clientHeight ?? 0;
  if (targetRenderWidth <= 0 || targetRenderHeight <= 0) {
    return null;
  }
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const targetPixelWidth = targetRenderWidth * devicePixelRatio;
  const targetPixelHeight = targetRenderHeight * devicePixelRatio;

  const levelSelections: HlsLevelSelection[] = hls.levels
    .map((level, index) => {
      const height = readPositiveNumber(level.height);
      if (!height) {
        return null;
      }

      const width = readPositiveNumber(level.width);
      const aspectDrift = (targetAspectRatio && width)
        ? Math.abs((width / height) - targetAspectRatio)
        : 0;

      return {
        index,
        width,
        height,
        bitrate: readPositiveNumber(level.bitrate) ?? 0,
        aspectDrift,
      };
    })
    .filter((selection): selection is HlsLevelSelection => selection !== null);

  if (!levelSelections.length) {
    return null;
  }

  let candidates = levelSelections;
  if (targetAspectRatio) {
    const aspectMatched = levelSelections.filter(selection =>
      selection.width !== null && selection.aspectDrift <= HLS_LEVEL_ASPECT_DRIFT_TOLERANCE
    );
    if (aspectMatched.length) {
      candidates = aspectMatched;
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.height !== b.height) return a.height - b.height;
    return b.bitrate - a.bitrate;
  });

  const firstCoveringDimensions = sorted.find(selection => {
    if (selection.width === null) {
      return false;
    }
    return selection.width >= (targetPixelWidth * 0.95) && selection.height >= (targetPixelHeight * 0.95);
  });
  if (firstCoveringDimensions) {
    return firstCoveringDimensions.index;
  }

  const firstCoveringHeight = sorted.find(selection => selection.height >= (targetPixelHeight * 0.95));
  if (firstCoveringHeight) {
    return firstCoveringHeight.index;
  }

  return sorted[sorted.length - 1]?.index ?? null;
}

function applyStableHlsLevel(hls: Hls, videoElement: HTMLVideoElement): void {
  const stableLevel = selectStableHlsLevel(hls, videoElement);
  if (stableLevel === null) {
    return;
  }

  hls.startLevel = stableLevel;
}

export async function setupHeroVideoPlayer(videoElement: HTMLVideoElement): Promise<void> {
  const streamUrl = videoElement.dataset.hlsUrl;
  if (!streamUrl) {
    throw new Error('No HLS URL provided for video element');
  }

  const abortController = new AbortController();
  heroPlayers.set(videoElement, { abortController, unbindLayout: bindVideoLayout(videoElement) });

  try {
    await attachHlsPlayback({
      videoElement,
      sourceUrl: streamUrl,
      signal: abortController.signal,
      onManifestParsed: hls => {
        applyStableHlsLevel(hls, videoElement);
      },
    });
  } catch (error) {
    if (!isAbortError(error)) {
      throw error;
    }
  }
}

export function destroyHeroVideoPlayer(videoElement: HTMLVideoElement): void {
  const player = heroPlayers.get(videoElement);
  if (player) {
    player.abortController.abort();
    player.unbindLayout();
    heroPlayers.delete(videoElement);
  }

  destroyHlsInstance(videoElement);
  resetVideoElementSource(videoElement);
}
