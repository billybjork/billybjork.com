import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { isValidSlug, slugFromName, slugify, SLUG_INPUT_PATTERN, uniqueSlug } from '../../static/ts/edit/slug';

const fixture = JSON.parse(readFileSync('tests/fixtures/slugs.json', 'utf-8')) as { valid: string[]; invalid: string[] };

describe('project slugs, per tests/fixtures/slugs.json', () => {
  it.each(fixture.valid)('accepts %j', (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(fixture.invalid)('rejects %j', (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });

  it.each([...fixture.valid.map((slug) => [slug, true] as const), ...fixture.invalid.map((slug) => [slug, false] as const)])(
    'an input with the pattern agrees about %j',
    (slug, expected) => {
      const input = document.createElement('input');
      input.required = true;
      input.pattern = SLUG_INPUT_PATTERN;
      input.value = slug;
      expect(input.checkValidity()).toBe(expected);
    },
  );
});

describe('slugFromName', () => {
  it.each([
    ['My New Project', 'my-new-project'],
    ['  Spaces   everywhere  ', 'spaces-everywhere'],
    ['Crème Brûlée!', 'creme-brulee'],
    ['_leading and trailing-', 'leading-and-trailing'],
    ['snake_case stays', 'snake_case-stays'],
  ])('turns %j into %j', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('gives nothing for a name with no usable characters, so the required field stays empty', () => {
    expect(slugFromName('!!!')).toBe('');
  });
});

describe('heading ids, as Python-Markdown toc makes them', () => {
  it('slugifies', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('Déjà  vu -- again')).toBe('deja-vu-again');
  });

  it('numbers duplicates', () => {
    const taken = new Set<string>();
    expect(['a', 'a', 'a'].map((slug) => uniqueSlug(slug, taken))).toEqual(['a', 'a_1', 'a_2']);
    expect(uniqueSlug('a_1', taken)).toBe('a_3');
  });
});
