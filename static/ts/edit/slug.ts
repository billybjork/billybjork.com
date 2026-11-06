const SLUG_INPUT_PATTERN_SOURCE = String.raw`[a-z0-9][a-z0-9_\-]*`;
const SLUG_PATTERN = new RegExp(`^${SLUG_INPUT_PATTERN_SOURCE}$`);

/** For an input's `pattern` attribute; `pattern` is implicitly anchored. */
export const SLUG_INPUT_PATTERN = SLUG_INPUT_PATTERN_SOURCE;

/** The server's rule for project slugs (cms/projects.py); tests/fixtures/slugs.json pins both sides. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/** Heading ids, matching Python-Markdown's toc.slugify. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '-');
}

/** Appends _1, _2, ... to a slug already taken, as Python-Markdown's toc does. */
export function uniqueSlug(slug: string, taken: Set<string>): string {
  if (!taken.has(slug) && slug) {
    taken.add(slug);
    return slug;
  }
  const match = slug.match(/^(.+)_(\d+)$/);
  const base = match?.[1] ?? slug;
  let counter = match?.[2] ? parseInt(match[2], 10) + 1 : 1;
  let candidate = `${base}_${counter}`;
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${base}_${counter}`;
  }
  taken.add(candidate);
  return candidate;
}

/** A project slug suggested from its name; passes isValidSlug unless the name has no usable characters. */
export function slugFromName(name: string): string {
  return slugify(name).replace(/^[-_]+/, '').replace(/[-_]+$/, '');
}
