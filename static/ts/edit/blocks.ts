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

// ========== BLOCK ID GENERATION ==========

/**
 * Generate unique block ID
 */
export function generateBlockId(index: number): string {
  return `block-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`;
}

// ========== BLOCK DETECTION ==========

/**
 * Detect block type from trimmed content and return a fully typed Block.
 * Pure function: inspects content, returns a new Block without mutation.
 */
function detectBlock(id: string, trimmed: string): Block {
  // HTML block: <!-- html --> ... <!-- /html -->
  if (trimmed.startsWith(HTML_START) && trimmed.endsWith(HTML_END)) {
    return {
      id,
      type: 'html',
      html: trimmed.slice(HTML_START.length, -HTML_END.length).trim(),
      align: 'left',
    } as HtmlBlock;
  }

  // Code block: ```language
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/^```(\w*)\n?([\s\S]*?)\n?```$/);
    return {
      id,
      type: 'code',
      language: match?.[1] || 'text',
      code: match?.[2] ?? trimmed.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''),
    } as CodeBlock;
  }

  // Image: ![alt](url) or <img>
  if (trimmed.startsWith('<img') || /^!\[.*?\]\(.*?\)$/.test(trimmed)) {
    if (trimmed.startsWith('<img')) {
      const srcMatch = trimmed.match(/src="([^"]*)"/);
      const altMatch = trimmed.match(/alt="([^"]*)"/);
      const styleMatch = trimmed.match(/style="([^"]*)"/);
      const style = styleMatch?.[1] ?? null;
      return {
        id,
        type: 'image',
        src: srcMatch?.[1] ?? '',
        alt: altMatch?.[1] ?? '',
        style,
        align: parseAlignmentFromStyle(style),
      } as ImageBlock;
    }
    const mdMatch = trimmed.match(/!\[(.*?)\]\((.*?)\)/);
    return {
      id,
      type: 'image',
      src: mdMatch?.[2] ?? '',
      alt: mdMatch?.[1] ?? '',
      style: null,
      align: 'left',
    } as ImageBlock;
  }

  // Video: <video> tag
  if (trimmed.startsWith('<video')) {
    const srcMatch = trimmed.match(/src="([^"]*)"/);
    const styleMatch = trimmed.match(/style="([^"]*)"/);
    const style = styleMatch?.[1] ?? null;
    return {
      id,
      type: 'video',
      src: srcMatch?.[1] ?? '',
      style,
      align: parseAlignmentFromStyle(style),
    } as VideoBlock;
  }

  // Callout: <div class="callout"> with optional style
  if (trimmed.startsWith('<div class="callout"')) {
    const contentMatch = trimmed.match(/<div class="callout"(?:\s+style="([^"]*)")?>([\s\S]*?)<\/div>/);
    return {
      id,
      type: 'callout',
      align: contentMatch?.[1] ? parseTextAlignmentFromStyle(contentMatch[1]) : 'left',
      content: contentMatch?.[2]?.trim() ?? '',
    } as CalloutBlock;
  }

  // Divider: ---, ***, ___
  if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
    return { id, type: 'divider' } as DividerBlock;
  }

  // Text with comment-based alignment markers
  if (trimmed.startsWith('<!-- align:')) {
    const alignMatch = trimmed.match(/^<!-- align:(center|right) -->\n?([\s\S]*?)\n?<!-- \/align -->$/);
    return {
      id,
      type: 'text',
      align: (alignMatch?.[1] as Alignment) ?? 'left',
      content: alignMatch?.[2]?.trim() ?? trimmed,
    } as TextBlock;
  }

  // Default: plain text block
  return {
    id,
    type: 'text',
    content: trimmed,
    align: 'left',
  } as TextBlock;
}

/**
 * Parse a single block from raw content
 */
export function parseSingleBlock(content: string, index: number): Block {
  return detectBlock(generateBlockId(index), content.trim());
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

  if (hasSize || hasAlignment) {
    const finalStyle = buildMediaStyleString(block);
    return `<img src="${block.src}" alt="${block.alt || ''}" style="${finalStyle}">`;
  }
  // Use markdown syntax for unsized, left-aligned images
  return `![${block.alt || ''}](${block.src})`;
}

/**
 * Format video block as HTML
 */
export function formatVideoMarkdown(block: VideoBlock): string {
  const hasSize = block.style && (block.style.includes('width') || block.style.includes('max-width'));
  const hasAlignment = block.align && block.align !== 'left';

  if (hasSize || hasAlignment) {
    const finalStyle = buildMediaStyleString(block);
    return `<video src="${block.src}" controls style="${finalStyle}"></video>`;
  }
  return `<video src="${block.src}" controls></video>`;
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
  // Wrap in alignment div if not left-aligned
  if (block.align && block.align !== 'left') {
    const alignStyle = getTextAlignmentStyle(block.align);
    return `${HTML_START}\n<div style="${alignStyle}">\n${htmlContent}\n</div>\n${HTML_END}`;
  }
  return `${HTML_START}\n${htmlContent}\n${HTML_END}`;
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
      return { ...base, src: '', alt: '', style: null, align: 'left', ...props } as Extract<Block, { type: T }>;
    case 'video':
      return { ...base, src: '', style: null, align: 'left', ...props } as Extract<Block, { type: T }>;
    case 'code':
      return { ...base, language: 'javascript', code: '', ...props } as Extract<Block, { type: T }>;
    case 'html':
      return { ...base, html: '', align: 'left', ...props } as Extract<Block, { type: T }>;
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
