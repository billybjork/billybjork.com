/**
 * The block markdown format. cms/markdown.py renders the same markers, and
 * tests/fixtures/block-format.md pins the format from both sides.
 */

import type {
  Alignment,
  Block,
  BlockType,
  CalloutBlock,
  CodeBlock,
  HtmlBlock,
  ImageBlock,
  VideoBlock,
} from '../types/blocks';
import {
  buildMediaStyleString,
  getTextAlignmentStyle,
  parseAlignmentFromStyle,
  parseTextAlignmentFromStyle,
  sizeStyleOf,
} from './block-style';
import { DIVIDER_LINE } from './inline-markdown';
import { decodeHtmlEntities, escapeHtml } from './text';

const BLOCK_SEPARATOR = '<!-- block -->';
const ROW_START = '<!-- row -->';
const ROW_END = '<!-- /row -->';
const COL_SEPARATOR = '<!-- col -->';
const HTML_START = '<!-- html -->';
const HTML_END = '<!-- /html -->';

const BLOCK_SPLIT = /\n+\s*<!--\s*block\s*-->\s*\n+/;
const ROW_START_PATTERN = /^\s*<!--\s*row\s*-->\s*/;
const ROW_END_PATTERN = /\s*<!--\s*\/row\s*-->\s*$/;
const COL_SPLIT = /\n*\s*<!--\s*col\s*-->\s*\n*/;
const HTML_BLOCK_PATTERN = /^<!--\s*html(?:\s+style="([^"]*)")?\s*-->\s*([\s\S]*?)\s*<!--\s*\/html\s*-->$/;
const TRAILING_CAPTION_PATTERN = /\n*<p\s+class=(["'])media-caption\1>([\s\S]*?)<\/p>\s*$/i;

function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function createBlock<T extends BlockType>(
  type: T,
  props: Partial<Extract<Block, { type: T }>> = {}
): Extract<Block, { type: T }> {
  const defaults = (): Record<string, unknown> => {
    switch (type as BlockType) {
      case 'text':
      case 'callout':
        return { content: '', align: 'left' };
      case 'image':
        return { src: '', alt: '', style: null, caption: '', align: 'left' };
      case 'video':
        return { src: '', poster: '', style: null, caption: '', align: 'left', autoplay: false };
      case 'code':
        return { language: 'javascript', code: '' };
      case 'html':
        return { html: '', style: null, caption: '', align: 'left' };
      case 'row':
        return { left: createBlock('text'), right: createBlock('text') };
      case 'divider':
        return {};
    }
  };
  return { id: generateBlockId(), type, ...defaults(), ...props } as Extract<Block, { type: T }>;
}

function parseAttribute(content: string, attribute: string): string | null {
  const match = content.match(new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '').trim() : null;
}

function parseHtmlBlock(match: RegExpMatchArray): HtmlBlock {
  const style = (match[1] ?? '').replace(/&quot;/g, '"').trim() || null;
  return createBlock('html', {
    style,
    html: (match[2] ?? '').trim(),
    align: parseAlignmentFromStyle(style),
  });
}

function parseCodeBlock(trimmed: string): CodeBlock {
  const match = trimmed.match(/^```(\w*)\n?([\s\S]*?)\n?```$/);
  return createBlock('code', match
    ? { language: match[1] || 'text', code: match[2] || '' }
    : { language: 'text', code: trimmed.replace(/^```\w*\n?/, '').replace(/\n?```$/, '') });
}

function parseImageBlock(trimmed: string): ImageBlock {
  if (!trimmed.startsWith('<img')) {
    const match = trimmed.match(/!\[(.*?)\]\((.*?)\)/);
    return createBlock('image', { src: match?.[2] ?? '', alt: match?.[1] ?? '' });
  }
  const style = trimmed.match(/style="([^"]*)"/)?.[1] ?? null;
  return createBlock('image', {
    src: trimmed.match(/src="([^"]*)"/)?.[1] ?? '',
    alt: trimmed.match(/alt="([^"]*)"/)?.[1] ?? '',
    style,
    align: parseAlignmentFromStyle(style),
  });
}

function parseVideoBlock(trimmed: string): VideoBlock {
  const openingTag = trimmed.match(/^<video\b[^>]*>/i)?.[0] ?? trimmed;
  const sourceSrc = trimmed.match(/<source\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const style = parseAttribute(openingTag, 'style');
  return createBlock('video', {
    src: parseAttribute(openingTag, 'src') || (sourceSrc?.[1] ?? sourceSrc?.[2] ?? '').trim(),
    poster: parseAttribute(openingTag, 'poster') ?? '',
    style,
    align: parseAlignmentFromStyle(style),
    autoplay: /<video\b[^>]*\sautoplay(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i.test(trimmed),
  });
}

function parseCalloutBlock(trimmed: string): CalloutBlock {
  const match = trimmed.match(/<div class="callout"(?:\s+style="([^"]*)")?>([\s\S]*?)<\/div>/);
  return createBlock('callout', {
    content: match?.[2]?.trim() ?? '',
    align: parseTextAlignmentFromStyle(match?.[1]),
  });
}

function parseBody(trimmed: string): Block {
  const htmlMatch = trimmed.match(HTML_BLOCK_PATTERN);
  if (htmlMatch) return parseHtmlBlock(htmlMatch);
  if (trimmed.startsWith('```')) return parseCodeBlock(trimmed);
  if (trimmed.startsWith('<img') || /^!\[.*?\]\(.*?\)$/.test(trimmed)) return parseImageBlock(trimmed);
  if (trimmed.startsWith('<video')) return parseVideoBlock(trimmed);
  if (trimmed.startsWith('<div class="callout"')) return parseCalloutBlock(trimmed);
  if (DIVIDER_LINE.test(trimmed)) return createBlock('divider');

  const aligned = trimmed.match(/^<!-- align:(center|right) -->\n?([\s\S]*?)\n?<!-- \/align -->$/);
  if (aligned) {
    return createBlock('text', { align: aligned[1] as Alignment, content: aligned[2]?.trim() ?? '' });
  }
  return createBlock('text', { content: trimmed });
}

function parseSingleBlock(content: string): Block {
  const trimmed = content.trim();
  const captionMatch = trimmed.match(TRAILING_CAPTION_PATTERN);
  if (captionMatch) {
    const body = parseBody(trimmed.slice(0, captionMatch.index).trim());
    if (body.type === 'image' || body.type === 'video' || body.type === 'html') {
      return { ...body, caption: decodeHtmlEntities((captionMatch[2] ?? '').trim()) };
    }
  }
  return parseBody(trimmed);
}

function parseRowBlock(trimmed: string): Block | null {
  if (!ROW_START_PATTERN.test(trimmed) || !ROW_END_PATTERN.test(trimmed)) return null;

  const inner = trimmed.replace(ROW_START_PATTERN, '').replace(ROW_END_PATTERN, '');
  const split = inner.match(COL_SPLIT);
  if (!split || split.index === undefined) return null;

  return createBlock('row', {
    left: parseSingleBlock(inner.slice(0, split.index)),
    right: parseSingleBlock(inner.slice(split.index + split[0].length)),
  });
}

export function parseIntoBlocks(markdown: string): Block[] {
  if (!markdown.trim()) return [createBlock('text')];

  return markdown.split(BLOCK_SPLIT).map((raw) => parseRowBlock(raw.trim()) ?? parseSingleBlock(raw));
}

function formatCaption(caption: string | null | undefined): string {
  const clean = (caption ?? '').trim();
  return clean ? `\n<p class="media-caption">${escapeHtml(clean)}</p>` : '';
}

function needsStyleAttribute(block: ImageBlock | VideoBlock): boolean {
  const hasSize = !!block.style && block.style.includes('width');
  return hasSize || (!!block.align && block.align !== 'left');
}

function formatImage(block: ImageBlock): string {
  const alt = block.alt || '';
  const image = needsStyleAttribute(block)
    ? `<img src="${block.src}" alt="${alt}" style="${buildMediaStyleString(block)}">`
    : `![${alt}](${block.src})`;
  return image + formatCaption(block.caption);
}

function formatVideo(block: VideoBlock): string {
  const attrs = [`src="${block.src}"`];
  if (block.poster) attrs.push(`poster="${block.poster}"`);
  attrs.push(block.autoplay ? 'autoplay loop muted playsinline' : 'controls');
  if (needsStyleAttribute(block)) attrs.push(`style="${buildMediaStyleString(block)}"`);
  return `<video ${attrs.join(' ')}></video>${formatCaption(block.caption)}`;
}

function formatHtml(block: HtmlBlock): string {
  const style = block.align && block.align !== 'left' ? buildMediaStyleString(block) : sizeStyleOf(block.style);
  const startMarker = style ? `<!-- html style="${style.replace(/"/g, '&quot;')}" -->` : HTML_START;
  return `${startMarker}\n${block.html || ''}\n${HTML_END}${formatCaption(block.caption)}`;
}

function formatCallout(block: CalloutBlock): string {
  const alignStyle = getTextAlignmentStyle(block.align);
  const styleAttr = alignStyle ? ` style="${alignStyle}"` : '';
  return `<div class="callout"${styleAttr}>${block.content}</div>`;
}

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case 'text': {
      const content = (block.content || '').trim();
      return block.align && block.align !== 'left'
        ? `<!-- align:${block.align} -->\n${content}\n<!-- /align -->`
        : content;
    }
    case 'image':
      return formatImage(block);
    case 'video':
      return formatVideo(block);
    case 'code':
      return `\`\`\`${block.language || ''}\n${block.code || ''}\n\`\`\``;
    case 'html':
      return formatHtml(block);
    case 'row':
      return `${ROW_START}\n${blockToMarkdown(block.left)}\n${COL_SEPARATOR}\n${blockToMarkdown(block.right)}\n${ROW_END}`;
    case 'callout':
      return formatCallout(block);
    case 'divider':
      return '---';
  }
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map(blockToMarkdown).join(`\n\n${BLOCK_SEPARATOR}\n\n`);
}
