/**
 * Slugify utilities for heading ID generation
 * Matches Python-Markdown's toc.slugify exactly:
 * 1. NFKD normalize → ASCII encode (strip non-ASCII)
 * 2. Remove non-word chars except spaces/hyphens
 * 3. Lowercase, trim
 * 4. Replace whitespace/separator runs with single hyphen
 */

/**
 * Convert a string to a URL-safe slug
 */
export function slugify(value: string, separator = '-'): string {
  // Normalize and strip to ASCII (removes diacritics and non-ASCII chars)
  let result = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  result = result.replace(/[^\x00-\x7F]/g, '');
  // Remove non-word chars (keep alphanumeric, spaces, hyphens)
  result = result.replace(/[^\w\s-]/g, '').trim().toLowerCase();
  // Collapse whitespace/separator runs into single separator
  return result.replace(/[\s-]+/g, separator);
}

/**
 * Generate a unique slug by appending _1, _2, etc. for duplicates
 */
export function uniqueSlug(slug: string, existing: Set<string>): string {
  if (!existing.has(slug) && slug) {
    existing.add(slug);
    return slug;
  }
  const match = slug.match(/^(.+)_(\d+)$/);
  const base = match?.[1] ?? slug;
  let counter = match?.[2] ? parseInt(match[2], 10) + 1 : 1;
  let candidate = `${base}_${counter}`;
  while (existing.has(candidate)) {
    counter++;
    candidate = `${base}_${counter}`;
  }
  existing.add(candidate);
  return candidate;
}
