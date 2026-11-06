import { slugify, uniqueSlug } from './slug';

interface HeadingLine {
  indent: string;
  level: number;
  body: string;
  prefixLength: number;
}

type LinePreviewType =
  | 'empty'
  | 'divider'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'quote'
  | 'list'
  | 'paragraph';

interface LinePreview {
  node: Node;
  type: LinePreviewType;
}

const HEADING_LINE = /^(\s*)(#{1,6})\s+(.*)$/;
const QUOTE_LINE = /^(\s*)>\s+(.*)$/;
const LIST_LINE = /^(\s*)([-*+]|\d+\.)\s+/;

export const DIVIDER_LINE = /^(\*{3,}|-{3,}|_{3,})$/;
export const LINK_PATTERN = String.raw`\[([^\]]*)\]\(([^)]*)\)`;

export function parseHeadingLine(line: string): HeadingLine | null {
  const match = line.match(HEADING_LINE);
  if (!match) return null;
  const body = match[3] ?? '';
  return {
    indent: match[1] ?? '',
    level: match[2]?.length ?? 1,
    body,
    prefixLength: match[0].length - body.length,
  };
}

/** Links with both a label and a URL; `[]()` and its parts stay plain text. */
function* renderableLinks(text: string): Generator<RegExpExecArray> {
  for (const match of text.matchAll(new RegExp(LINK_PATTERN, 'g'))) {
    if (match[1] && match[2]) yield match as RegExpExecArray;
  }
}

interface InlineMatch {
  index: number;
  length: number;
  tagName: 'strong' | 'em' | 'u' | 'code' | 's';
  content: string;
}

const INLINE_MAX_DEPTH = 8;

function appendInlineFormatted(container: Node, text: string): void {
  container.appendChild(parseInlineTokens(text));
}

function parseInlineTokens(text: string): DocumentFragment {
  return parseInlineTokensRecursive(text, 0);
}

function parseInlineTokensRecursive(text: string, depth: number): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!text) return fragment;
  if (depth >= INLINE_MAX_DEPTH) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    const match = findNextInlineMatch(remaining);
    if (!match) {
      fragment.appendChild(document.createTextNode(remaining));
      break;
    }

    if (match.index > 0) {
      fragment.appendChild(document.createTextNode(remaining.slice(0, match.index)));
    }

    const el = document.createElement(match.tagName);
    if (match.tagName === 'code') {
      el.textContent = match.content;
    } else {
      el.appendChild(parseInlineTokensRecursive(match.content, depth + 1));
    }
    fragment.appendChild(el);

    cursor += match.index + match.length;
  }

  return fragment;
}

function findNextInlineMatch(text: string): InlineMatch | null {
  const matchers: Array<(input: string) => InlineMatch | null> = [
    matchInlineCodeBackticks,
    matchHtmlUnderline,
    matchHtmlStrong,
    matchHtmlEmphasis,
    matchHtmlCode,
    matchMarkdownStrongAsterisk,
    matchMarkdownStrongUnderscore,
    matchMarkdownStrikethrough,
    matchMarkdownEmphasisAsterisk,
    matchMarkdownEmphasisUnderscore,
  ];

  let best: InlineMatch | null = null;

  matchers.forEach((matcher) => {
    const current = matcher(text);
    if (!current) return;

    if (!best || current.index < best.index) {
      best = current;
    }
  });

  return best;
}

function toInlineMatch(match: RegExpMatchArray | null, tagName: InlineMatch['tagName'], contentIndex = 1): InlineMatch | null {
  if (!match || typeof match.index !== 'number') return null;
  const content = match[contentIndex];
  if (!content) return null;
  return {
    index: match.index,
    length: match[0].length,
    tagName,
    content,
  };
}

function matchInlineCodeBackticks(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/`([^`\n]+?)`/), 'code');
}

function matchHtmlUnderline(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/<u>([\s\S]+?)<\/u>/i), 'u');
}

function matchHtmlStrong(input: string): InlineMatch | null {
  const match = input.match(/<(strong|b)>([\s\S]+?)<\/(strong|b)>/i);
  if (!match || typeof match.index !== 'number') return null;
  const open = (match[1] || '').toLowerCase();
  const close = (match[3] || '').toLowerCase();
  if (!open || open !== close) return null;
  return {
    index: match.index,
    length: match[0].length,
    tagName: 'strong',
    content: match[2] ?? '',
  };
}

function matchHtmlEmphasis(input: string): InlineMatch | null {
  const match = input.match(/<(em|i)>([\s\S]+?)<\/(em|i)>/i);
  if (!match || typeof match.index !== 'number') return null;
  const open = (match[1] || '').toLowerCase();
  const close = (match[3] || '').toLowerCase();
  if (!open || open !== close) return null;
  return {
    index: match.index,
    length: match[0].length,
    tagName: 'em',
    content: match[2] ?? '',
  };
}

function matchHtmlCode(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/<code>([\s\S]+?)<\/code>/i), 'code');
}

function matchMarkdownStrongAsterisk(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/\*\*([^*\n][\s\S]*?)\*\*/), 'strong');
}

function matchMarkdownStrongUnderscore(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/__([^_\n][\s\S]*?)__/), 'strong');
}

function matchMarkdownStrikethrough(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/~~([^~\n][\s\S]*?)~~/), 's');
}

function matchMarkdownEmphasisAsterisk(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/\*([^*\n][^*\n]*?)\*/), 'em');
}

function matchMarkdownEmphasisUnderscore(input: string): InlineMatch | null {
  return toInlineMatch(input.match(/_([^_\n][^_\n]*?)_/), 'em');
}

function sanitizeUrl(url: string): string | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    return null;
  }

  return null;
}

function renderInlineMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of renderableLinks(text)) {
    const offset = match.index;
    if (offset > lastIndex) {
      appendInlineFormatted(fragment, text.slice(lastIndex, offset));
    }

    const safeUrl = sanitizeUrl(match[2] ?? '');
    if (safeUrl) {
      const link = document.createElement('a');
      link.href = safeUrl;
      if (!/^(#|\/|\.\/|\.\.\/)/.test(safeUrl)) {
        link.rel = 'noopener';
        link.target = '_blank';
      }
      appendInlineFormatted(link, match[1] ?? '');
      fragment.appendChild(link);
    } else {
      fragment.appendChild(document.createTextNode(match[0]));
    }

    lastIndex = offset + match[0].length;
  }

  if (lastIndex < text.length) {
    appendInlineFormatted(fragment, text.slice(lastIndex));
  }

  return fragment;
}

/** The text a heading's id comes from: its rendered text, as the server's toc extension sees it. */
function headingText(body: string): string {
  const holder = document.createElement('span');
  holder.appendChild(renderInlineMarkdown(body));
  return holder.textContent?.trim() ?? '';
}

/** The heading ids taken by the lines before `upTo`, for numbering the next duplicate. */
export function headingSlugsBefore(lines: string[], upTo: number): Set<string> {
  const taken = new Set<string>();
  for (const line of lines.slice(0, upTo)) {
    const heading = parseHeadingLine(line);
    const base = heading ? slugify(headingText(heading.body)) : '';
    if (base) uniqueSlug(base, taken);
  }
  return taken;
}

/** The preview for one line of a text block. Approximates the server's markdown renderer. */
export function renderLinePreview(line: string, takenHeadingSlugs: Set<string>): LinePreview {
  const trimmed = line.trim();

  if (!trimmed) {
    const empty = document.createElement('span');
    empty.innerHTML = '&nbsp;';
    return { node: empty, type: 'empty' };
  }

  if (DIVIDER_LINE.test(trimmed)) {
    const divider = document.createElement('hr');
    divider.className = 'text-line-divider';
    return { node: divider, type: 'divider' };
  }

  const heading = parseHeadingLine(line);
  if (heading) {
    const element = document.createElement(`h${heading.level}`);
    element.appendChild(renderInlineMarkdown(heading.body));
    const base = slugify(element.textContent?.trim() ?? '');
    if (base) element.id = uniqueSlug(base, takenHeadingSlugs);
    return { node: element, type: `heading-${heading.level}` as LinePreviewType };
  }

  const quote = line.match(QUOTE_LINE);
  if (quote) {
    const element = document.createElement('blockquote');
    element.appendChild(renderInlineMarkdown(quote[2] ?? ''));
    return { node: element, type: 'quote' };
  }

  const span = document.createElement('span');
  span.appendChild(renderInlineMarkdown(line));
  return { node: span, type: LIST_LINE.test(line) ? 'list' : 'paragraph' };
}

function literalBoundaries(text: string, rawStart: number): number[] {
  const map = [rawStart];
  for (let i = 0; i < text.length; i += 1) {
    map.push(rawStart + i + 1);
  }
  return map;
}

function appendBoundaries(target: number[], incoming: number[]): void {
  if (!incoming.length) return;
  target[target.length - 1] = incoming[0] ?? target[target.length - 1] ?? 0;
  target.push(...incoming.slice(1));
}

function inlineBoundaries(text: string, rawStart: number, depth = 0): number[] {
  const map = [rawStart];
  if (!text) return map;

  if (depth >= INLINE_MAX_DEPTH) {
    appendBoundaries(map, literalBoundaries(text, rawStart));
    return map;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    const match = findNextInlineMatch(remaining);

    if (!match) {
      appendBoundaries(map, literalBoundaries(remaining, rawStart + cursor));
      break;
    }

    if (match.index > 0) {
      appendBoundaries(map, literalBoundaries(remaining.slice(0, match.index), rawStart + cursor));
    }

    const tokenStart = cursor + match.index;
    const tokenRawStart = rawStart + tokenStart;
    const tokenText = remaining.slice(match.index, match.index + match.length);
    const contentIndex = tokenText.indexOf(match.content);

    if (contentIndex < 0) {
      appendBoundaries(map, literalBoundaries(tokenText, tokenRawStart));
    } else {
      const contentRawStart = tokenRawStart + contentIndex;
      appendBoundaries(map, match.tagName === 'code'
        ? literalBoundaries(match.content, contentRawStart)
        : inlineBoundaries(match.content, contentRawStart, depth + 1));
    }

    cursor = tokenStart + match.length;
  }

  return map;
}

/**
 * For each character offset in a line's rendered preview, the offset in its raw markdown.
 * Walks the same tokens as the renderer above, so clicks in the preview land the caret
 * at the matching spot in the textarea.
 */
export function renderedToRawBoundaries(line: string, lineType: string | undefined): number[] {
  if (!line) return [0];
  if (lineType === 'divider') return [line.length];

  let bodyStart = 0;
  if (lineType?.startsWith('heading-')) {
    bodyStart = parseHeadingLine(line)?.prefixLength ?? 0;
  } else if (lineType === 'quote') {
    bodyStart = line.match(/^(\s*)>\s+/)?.[0].length ?? 0;
  }

  const body = line.slice(bodyStart);
  const map = [bodyStart];
  let lastIndex = 0;

  for (const match of renderableLinks(body)) {
    const offset = match.index;
    if (offset > lastIndex) {
      appendBoundaries(map, inlineBoundaries(body.slice(lastIndex, offset), bodyStart + lastIndex));
    }
    appendBoundaries(map, sanitizeUrl(match[2] ?? '')
      ? inlineBoundaries(match[1] ?? '', bodyStart + offset + 1)
      : literalBoundaries(match[0], bodyStart + offset));
    lastIndex = offset + match[0].length;
  }

  if (lastIndex < body.length) {
    appendBoundaries(map, inlineBoundaries(body.slice(lastIndex), bodyStart + lastIndex));
  }

  return map;
}
