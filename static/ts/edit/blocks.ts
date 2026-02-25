/**
 * Edit Blocks Module
 * Block parsing and markdown conversion for the block editor
 */

import type {
  Block,
  BlockType,
  Alignment,
  TextBlock,
  ImageBlock,
  VideoBlock,
  CodeBlock,
  HtmlBlock,
  CalloutBlock,
  DividerBlock,
  RowBlock,
} from '../types/blocks';
import {
  parseAlignmentFromStyle,
  parseTextAlignmentFromStyle,
  buildMediaStyleString,
  getTextAlignmentStyle,
} from '../core/utils';

// ========== CONSTANTS ==========

export const BLOCK_SEPARATOR = '<!-- block -->';
export const ROW_START = '<!-- row -->';
export const ROW_END = '<!-- /row -->';
export const COL_SEPARATOR = '<!-- col -->';
export const HTML_START = '<!-- html -->';
export const HTML_END = '<!-- /html -->';
const HTML_BLOCK_PATTERN = /^<!--\s*html(?:\s+style="([^"]*)")?\s*-->\s*([\s\S]*?)\s*<!--\s*\/html\s*-->$/;
const TRAILING_CAPTION_PATTERN = /\n*<p\s+class=(["'])media-caption\1>([\s\S]*?)<\/p>\s*$/i;

// ========== BLOCK ID GENERATION ==========

/**
 * Generate unique block ID
 */
export function generateBlockId(index: number): string {
  return `block-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`;
}

// ========== BLOCK DETECTION ==========

interface PartialBlock {
  id: string;
  type?: BlockType;
  content?: string;
  src?: string;
  poster?: string;
  alt?: string;
  style?: string | null;
  caption?: string;
  align?: Alignment;
  autoplay?: boolean;
  language?: string;
  code?: string;
  html?: string;
  left?: Block;
  right?: Block;
}

function decodeHtmlCommentStyle(style: string | undefined): string | null {
  if (!style) return null;
  const decoded = style.replace(/&quot;/g, '"').trim();
  return decoded || null;
}

function encodeHtmlCommentStyle(style: string): string {
  return style.replace(/"/g, '&quot;');
}

function buildHtmlStartMarker(style: string | null | undefined): string {
  const cleanStyle = (style ?? '').trim();
  if (!cleanStyle) return HTML_START;
  return `<!-- html style="${encodeHtmlCommentStyle(cleanStyle)}" -->`;
}

function isCaptionCapableType(type: BlockType | undefined): type is 'image' | 'video' | 'html' {
  return type === 'image' || type === 'video' || type === 'html';
}

interface CaptionExtractionResult {
  content: string;
  caption: string | null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractTrailingCaption(content: string): CaptionExtractionResult {
  const match = content.match(TRAILING_CAPTION_PATTERN);
  if (!match) {
    return { content, caption: null };
  }

  const index = match.index ?? content.length;
  return {
    content: content.slice(0, index).trim(),
    caption: decodeHtmlEntities((match[2] ?? '').trim()),
  };
}

function formatCaptionParagraph(caption: string | null | undefined): string {
  const cleanCaption = (caption ?? '').trim();
  if (!cleanCaption) return '';
  return `\n<p class="media-caption">${escapeHtml(cleanCaption)}</p>`;
}

function extractAttributeValue(content: string, attribute: string): string | null {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedAttribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = content.match(regex);
  if (!match) return null;
  return ((match[1] ?? match[2] ?? '') || '').trim();
}

function extractVideoSource(content: string): string {
  const sourceMatch = content.match(/<source\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return ((sourceMatch?.[1] ?? sourceMatch?.[2] ?? '') || '').trim();
}

/**
 * Detect and set block type based on content
 */
function detectBlockType(block: PartialBlock, trimmed: string): void {
  // Check for HTML block first (<!-- html --> ... <!-- /html -->)
  const htmlMatch = trimmed.match(HTML_BLOCK_PATTERN);
  if (htmlMatch) {
    block.type = 'html';
    block.style = decodeHtmlCommentStyle(htmlMatch[1]);
    block.html = (htmlMatch[2] ?? '').trim();
    block.align = parseAlignmentFromStyle(block.style);
    if (block.align === 'left') {
      const legacyAlignMatch = block.html.match(
        /^<div\b[^>]*\bstyle\s*=\s*["'][^"']*\btext-align\s*:\s*(center|right)\b[^"']*["'][^>]*>[\s\S]*<\/div>$/i
      );
      if (legacyAlignMatch) {
        block.align = legacyAlignMatch[1] as Alignment;
      }
    }
    return;
  }

  // Check for code block first (```language)
  if (trimmed.startsWith('```')) {
    block.type = 'code';
    const match = trimmed.match(/^```(\w*)\n?([\s\S]*?)\n?```$/);
    if (match) {
      block.language = match[1] || 'text';
      block.code = match[2] || '';
    } else {
      block.language = 'text';
      block.code = trimmed.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    return;
  }

  // Check for image: ![alt](url) or <img>
  if (trimmed.startsWith('<img') || /^!\[.*?\]\(.*?\)$/.test(trimmed)) {
    block.type = 'image';
    if (trimmed.startsWith('<img')) {
      const srcMatch = trimmed.match(/src="([^"]*)"/);
      const altMatch = trimmed.match(/alt="([^"]*)"/);
      const styleMatch = trimmed.match(/style="([^"]*)"/);
      block.src = srcMatch?.[1] ?? '';
      block.alt = altMatch?.[1] ?? '';
      block.style = styleMatch?.[1] ?? null;
      block.align = parseAlignmentFromStyle(block.style);
    } else {
      const mdMatch = trimmed.match(/!\[(.*?)\]\((.*?)\)/);
      block.src = mdMatch?.[2] ?? '';
      block.alt = mdMatch?.[1] ?? '';
      block.style = null;
      block.align = 'left';
    }
    return;
  }

  // Check for video: <video> tag
  if (trimmed.startsWith('<video')) {
    block.type = 'video';
    const openingTag = trimmed.match(/^<video\b[^>]*>/i)?.[0] ?? trimmed;
    const hasAutoplay = /<video\b[^>]*\sautoplay(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i.test(trimmed);
    const videoSrc = extractAttributeValue(openingTag, 'src');
    block.src = videoSrc || extractVideoSource(trimmed);
    block.poster = extractAttributeValue(openingTag, 'poster') ?? '';
    block.style = extractAttributeValue(openingTag, 'style');
    block.align = parseAlignmentFromStyle(block.style);
    block.autoplay = hasAutoplay;
    return;
  }

  // Check for callout: <div class="callout"> with optional style
  if (trimmed.startsWith('<div class="callout"')) {
    block.type = 'callout';
    // Match with or without style attribute
    const contentMatch = trimmed.match(/<div class="callout"(?:\s+style="([^"]*)")?>([\s\S]*?)<\/div>/);
    if (contentMatch) {
      block.align = contentMatch[1] ? parseTextAlignmentFromStyle(contentMatch[1]) : 'left';
      block.content = contentMatch[2]?.trim() ?? '';
    } else {
      block.content = '';
      block.align = 'left';
    }
    return;
  }

  // Check for divider: ---, ***, ___
  if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
    block.type = 'divider';
    return;
  }

  // Check for text block with paired comment-based alignment markers
  if (trimmed.startsWith('<!-- align:')) {
    block.type = 'text';
    const alignMatch = trimmed.match(/^<!-- align:(center|right) -->\n?([\s\S]*?)\n?<!-- \/align -->$/);
    if (alignMatch) {
      block.align = alignMatch[1] as Alignment;
      block.content = alignMatch[2]?.trim() ?? '';
    } else {
      block.align = 'left';
    }
    return;
  }

  // Legacy: text block with div alignment wrapper (backward compatibility)
  if (trimmed.startsWith('<div style="text-align:') || trimmed.startsWith('<div style="text-align :')) {
    block.type = 'text';
    const styleMatch = trimmed.match(/<div style="([^"]*)">([\s\S]*?)<\/div>/);
    if (styleMatch) {
      block.align = parseTextAlignmentFromStyle(styleMatch[1]);
      block.content = styleMatch[2]?.trim() ?? '';
    } else {
      block.align = 'left';
    }
    return;
  }

  // Default to text block
  block.type = 'text';
  block.align = 'left';
}

/**
 * Parse a single block from raw content
 */
export function parseSingleBlock(content: string, index: number): Block {
  const trimmed = content.trim();
  const block: PartialBlock = {
    id: generateBlockId(index),
    content: trimmed
  };
  const extractedCaption = extractTrailingCaption(trimmed);
  if (extractedCaption.caption !== null) {
    const probeBlock: PartialBlock = { id: block.id };
    detectBlockType(probeBlock, extractedCaption.content);
    if (isCaptionCapableType(probeBlock.type)) {
      Object.assign(block, probeBlock, { caption: extractedCaption.caption });
    } else {
      detectBlockType(block, trimmed);
    }
  } else {
    detectBlockType(block, trimmed);
  }

  // Convert partial block to proper Block type based on detected type
  switch (block.type) {
    case 'text':
      return {
        id: block.id,
        type: 'text',
        content: block.content ?? '',
        align: block.align ?? 'left',
      } as TextBlock;
    case 'image':
      return {
        id: block.id,
        type: 'image',
        src: block.src ?? '',
        alt: block.alt ?? '',
        style: block.style ?? null,
        caption: block.caption ?? '',
        align: block.align ?? 'left',
      } as ImageBlock;
    case 'video':
      return {
        id: block.id,
        type: 'video',
        src: block.src ?? '',
        poster: block.poster ?? '',
        style: block.style ?? null,
        caption: block.caption ?? '',
        align: block.align ?? 'left',
        autoplay: block.autoplay ?? false,
      } as VideoBlock;
    case 'code':
      return {
        id: block.id,
        type: 'code',
        code: block.code ?? '',
        language: block.language ?? 'text',
      } as CodeBlock;
    case 'html':
      return {
        id: block.id,
        type: 'html',
        html: block.html ?? '',
        style: block.style ?? null,
        caption: block.caption ?? '',
        align: block.align ?? 'left',
      } as HtmlBlock;
    case 'callout':
      return {
        id: block.id,
        type: 'callout',
        content: block.content ?? '',
        align: block.align ?? 'left',
      } as CalloutBlock;
    case 'divider':
      return {
        id: block.id,
        type: 'divider',
      } as DividerBlock;
    default:
      return {
        id: block.id,
        type: 'text',
        content: block.content ?? '',
        align: 'left',
      } as TextBlock;
  }
}

// ========== PARSING ==========

/**
 * Parse markdown content into blocks separated by <!-- block -->
 * Detects block types: text, image, video, code, row, callout, divider
 */
export function parseIntoBlocks(markdown: string): Block[] {
  if (!markdown || !markdown.trim()) {
    return [{ id: generateBlockId(0), type: 'text', content: '', align: 'left' } as TextBlock];
  }

  // Split on block separator with flexible whitespace (1+ newlines on each side)
  const rawBlocks = markdown.split(new RegExp(`\\n+${BLOCK_SEPARATOR}\\n+`));

  const blocks: Block[] = rawBlocks.map((content, index) => {
    const trimmed = content.trim();

    // Check for row block
    if (trimmed.startsWith(ROW_START) && trimmed.endsWith(ROW_END)) {
      // Extract content between row markers
      const innerContent = trimmed
        .slice(ROW_START.length, -ROW_END.length)
        .trim();

      // Split on column separator
      const columns = innerContent.split(new RegExp(`\\n*${COL_SEPARATOR}\\n*`));

      if (columns.length >= 2) {
        return {
          id: generateBlockId(index),
          type: 'row',
          left: parseSingleBlock(columns[0] ?? '', index * 10),
          right: parseSingleBlock(columns[1] ?? '', index * 10 + 1)
        } as RowBlock;
      }
    }

    // Regular block parsing
    return parseSingleBlock(content, index);
  });

  return blocks.length ? blocks : [{ id: generateBlockId(0), type: 'text', content: '', align: 'left' } as TextBlock];
}

// ========== FORMATTING ==========

/**
 * Format image block as markdown/HTML
 * Uses HTML img tag if sized or aligned, markdown syntax otherwise
 */
export function formatImageMarkdown(block: ImageBlock): string {
  const hasSize = block.style && (block.style.includes('width') || block.style.includes('max-width'));
  const hasAlignment = block.align && block.align !== 'left';
  const captionMarkup = formatCaptionParagraph(block.caption);

  if (hasSize || hasAlignment) {
    const finalStyle = buildMediaStyleString(block);
    return `<img src="${block.src}" alt="${block.alt || ''}" style="${finalStyle}">${captionMarkup}`;
  }
  // Use markdown syntax for unsized, left-aligned images
  return `![${block.alt || ''}](${block.src})${captionMarkup}`;
}

/**
 * Format video block as HTML
 */
export function formatVideoMarkdown(block: VideoBlock): string {
  const attrs: string[] = [`src="${block.src}"`];
  if (block.poster) {
    attrs.push(`poster="${block.poster}"`);
  }

  const playbackAttrs = block.autoplay ? 'autoplay loop muted playsinline' : 'controls';
  attrs.push(playbackAttrs);
  const hasSize = block.style && (block.style.includes('width') || block.style.includes('max-width'));
  const hasAlignment = block.align && block.align !== 'left';
  const captionMarkup = formatCaptionParagraph(block.caption);

  if (hasSize || hasAlignment) {
    const finalStyle = buildMediaStyleString(block);
    attrs.push(`style="${finalStyle}"`);
    return `<video ${attrs.join(' ')}></video>${captionMarkup}`;
  }
  return `<video ${attrs.join(' ')}></video>${captionMarkup}`;
}

/**
 * Format code block
 */
export function formatCodeMarkdown(block: CodeBlock): string {
  return '```' + (block.language || '') + '\n' + (block.code || '') + '\n```';
}

/**
 * Format callout block as HTML
 */
export function formatCalloutHtml(block: CalloutBlock): string {
  const hasAlignment = block.align && block.align !== 'left';
  if (hasAlignment) {
    const alignStyle = getTextAlignmentStyle(block.align);
    return `<div class="callout" style="${alignStyle}">${block.content}</div>`;
  }
  return `<div class="callout">${block.content}</div>`;
}

/**
 * Format HTML block (raw HTML preserved)
 */
export function formatHtmlBlock(block: HtmlBlock): string {
  const htmlContent = block.html || '';
  const hasStyle = Boolean(block.style && block.style.trim());
  const hasAlignment = Boolean(block.align && block.align !== 'left');
  const markerStyle = hasStyle || hasAlignment
    ? buildMediaStyleString(block)
    : block.style;
  const startMarker = buildHtmlStartMarker(markerStyle);
  const captionMarkup = formatCaptionParagraph(block.caption);
  return `${startMarker}\n${htmlContent}\n${HTML_END}${captionMarkup}`;
}

/**
 * Convert a single block to markdown string
 */
export function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case 'text': {
      const content = (block.content || '').trim();
      // Use paired comment markers for alignment (doesn't interfere with markdown parsing)
      if (block.align && block.align !== 'left') {
        return `<!-- align:${block.align} -->\n${content}\n<!-- /align -->`;
      }
      return content;
    }
    case 'image':
      return formatImageMarkdown(block);
    case 'video':
      return formatVideoMarkdown(block);
    case 'code':
      return formatCodeMarkdown(block);
    case 'html':
      return formatHtmlBlock(block);
    case 'row': {
      const leftContent = blockToMarkdown(block.left);
      const rightContent = blockToMarkdown(block.right);
      return `${ROW_START}\n${leftContent}\n${COL_SEPARATOR}\n${rightContent}\n${ROW_END}`;
    }
    case 'callout':
      return formatCalloutHtml(block);
    case 'divider':
      return '---';
    default:
      return '';
  }
}

/**
 * Convert blocks array back to markdown string
 * Uses double newlines around separator for proper markdown parsing
 */
export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map(block => blockToMarkdown(block)).join(`\n\n${BLOCK_SEPARATOR}\n\n`);
}

/**
 * Create a new empty block of specified type
 */
export function createBlock<T extends BlockType>(
  type: T,
  props: Partial<Extract<Block, { type: T }>> = {}
): Extract<Block, { type: T }> {
  const base = {
    id: generateBlockId(Date.now()),
    type,
  };

  switch (type) {
    case 'text':
      return { ...base, content: '', align: 'left', ...props } as Extract<Block, { type: T }>;
    case 'image':
      return { ...base, src: '', alt: '', style: null, caption: '', align: 'left', ...props } as Extract<Block, { type: T }>;
    case 'video':
      return {
        ...base,
        src: '',
        poster: '',
        style: null,
        caption: '',
        align: 'left',
        autoplay: false,
        ...props,
      } as Extract<Block, { type: T }>;
    case 'code':
      return { ...base, language: 'javascript', code: '', ...props } as Extract<Block, { type: T }>;
    case 'html':
      return { ...base, html: '', style: null, caption: '', align: 'left', ...props } as Extract<Block, { type: T }>;
    case 'callout':
      return { ...base, content: '', align: 'left', ...props } as Extract<Block, { type: T }>;
    case 'row':
      return {
        ...base,
        left: createBlock('text'),
        right: createBlock('text'),
        ...props
      } as Extract<Block, { type: T }>;
    case 'divider':
      return { ...base, ...props } as Extract<Block, { type: T }>;
    default:
      return { ...base, content: '', align: 'left', ...props } as Extract<Block, { type: T }>;
  }
}

// ========== PUBLIC API (for window.EditBlocks compatibility) ==========

const EditBlocks = {
  // Constants
  BLOCK_SEPARATOR,
  ROW_START,
  ROW_END,
  COL_SEPARATOR,
  HTML_START,
  HTML_END,

  // Parsing
  parseIntoBlocks,
  parseSingleBlock,

  // Formatting
  blockToMarkdown,
  blocksToMarkdown,
  formatImageMarkdown,
  formatVideoMarkdown,
  formatCodeMarkdown,
  formatHtmlBlock,
  formatCalloutHtml,

  // Factory
  createBlock,
  generateBlockId,
};

export default EditBlocks;
