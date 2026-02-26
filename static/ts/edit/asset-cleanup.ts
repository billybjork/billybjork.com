import type { Block } from '../types/blocks';

export function addCleanupCandidateUrl(
  cleanupCandidateUrls: Set<string>,
  url: string | null | undefined
): void {
  const cleanUrl = (url ?? '').trim();
  if (!cleanUrl) return;
  cleanupCandidateUrls.add(cleanUrl);
}

export function isTrackableAssetUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return /\.(webp|png|jpe?g|gif|avif)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function trackPosterCleanupCandidatesFromBlock(
  cleanupCandidateUrls: Set<string>,
  block: Block | null | undefined
): void {
  if (!block) return;
  if (block.type === 'video') {
    addCleanupCandidateUrl(cleanupCandidateUrls, block.poster);
    return;
  }
  if (block.type === 'row') {
    trackPosterCleanupCandidatesFromBlock(cleanupCandidateUrls, block.left);
    trackPosterCleanupCandidatesFromBlock(cleanupCandidateUrls, block.right);
  }
}
