export function resolveHashTarget(hash: string): HTMLElement | null {
  const rawId = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!rawId) return null;

  let decodedId = rawId;
  try {
    decodedId = decodeURIComponent(rawId);
  } catch {
    // Not percent-encoded after all; the raw id is the id.
  }

  // Links out in the wild can carry a duplicate-heading suffix ("heading_1"); land them on "heading".
  const candidates = [decodedId, rawId, decodedId.replace(/_\d+$/, ''), rawId.replace(/_\d+$/, '')];
  for (const id of candidates) {
    const target = document.getElementById(id);
    if (target) return target;
  }
  return null;
}

export function scrollToHashTarget(): void {
  resolveHashTarget(window.location.hash)?.scrollIntoView({ behavior: 'auto', block: 'start' });
}
