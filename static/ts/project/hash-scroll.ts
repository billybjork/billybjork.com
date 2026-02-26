/**
 * Hash target resolution + scrolling for project content anchors.
 */

export function resolveHashTarget(hash: string): HTMLElement | null {
  const rawId = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!rawId) return null;

  let decodedId = rawId;
  try {
    decodedId = decodeURIComponent(rawId);
  } catch {
    decodedId = rawId;
  }

  const direct = document.getElementById(decodedId) || document.getElementById(rawId);
  if (direct) return direct;

  // Fallback for stale/legacy hashes like "heading_1" when only "heading" exists.
  const baseDecoded = decodedId.replace(/_\d+$/, '');
  if (baseDecoded && baseDecoded !== decodedId) {
    const fallback = document.getElementById(baseDecoded);
    if (fallback) return fallback;
  }

  const baseRaw = rawId.replace(/_\d+$/, '');
  if (baseRaw && baseRaw !== rawId) {
    const fallback = document.getElementById(baseRaw);
    if (fallback) return fallback;
  }

  return null;
}

export function scrollToHashTarget(behavior: ScrollBehavior = 'auto'): void {
  const target = resolveHashTarget(window.location.hash);
  if (!target) return;
  target.scrollIntoView({ behavior, block: 'start' });
}
