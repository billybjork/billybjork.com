export interface InlineMatch {
  index: number;
  length: number;
  tagName: 'strong' | 'em' | 'u' | 'code' | 's';
  content: string;
}

export const INLINE_MAX_DEPTH = 8;

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

export function findNextInlineMatch(text: string): InlineMatch | null {
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

export function sanitizeUrl(url: string): string | null {
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

export function renderInlineMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    const offset = match.index;

    if (offset > lastIndex) {
      appendInlineFormatted(fragment, text.slice(lastIndex, offset));
    }

    const safeUrl = sanitizeUrl(match[2] ?? '');
    if (safeUrl) {
      const link = document.createElement('a');
      link.href = safeUrl;
      const isInternalLink = safeUrl.startsWith('#')
        || safeUrl.startsWith('/')
        || safeUrl.startsWith('./')
        || safeUrl.startsWith('../');
      if (!isInternalLink) {
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
