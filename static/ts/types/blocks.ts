/**
 * Block type definitions for the editor
 */

export type BlockType = 'text' | 'image' | 'video' | 'code' | 'html' | 'callout' | 'divider' | 'row';
export type Alignment = 'left' | 'center' | 'right';

interface BaseBlock {
  id: string;
  type: BlockType;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  content: string;
  align?: Alignment;
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  src: string;
  alt: string;
  style: string | null;
  align?: Alignment;
}

export interface VideoBlock extends BaseBlock {
  type: 'video';
  src: string;
  style: string | null;
  align?: Alignment;
}

export interface CodeBlock extends BaseBlock {
  type: 'code';
  code: string;
  language: string;
  align?: Alignment;
}

export interface HtmlBlock extends BaseBlock {
  type: 'html';
  html: string;
  align?: Alignment;
}

export interface CalloutBlock extends BaseBlock {
  type: 'callout';
  content: string;
  align?: Alignment;
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
}

export interface RowBlock extends BaseBlock {
  type: 'row';
  left: Block;
  right: Block;
}

export type Block =
  | TextBlock
  | ImageBlock
  | VideoBlock
  | CodeBlock
  | HtmlBlock
  | CalloutBlock
  | DividerBlock
  | RowBlock;

/**
 * Type guard functions for block types
 */
export function isTextBlock(block: Block): block is TextBlock {
  return block.type === 'text';
}

export function isImageBlock(block: Block): block is ImageBlock {
  return block.type === 'image';
}

export function isVideoBlock(block: Block): block is VideoBlock {
  return block.type === 'video';
}

export function isCodeBlock(block: Block): block is CodeBlock {
  return block.type === 'code';
}

export function isHtmlBlock(block: Block): block is HtmlBlock {
  return block.type === 'html';
}

export function isCalloutBlock(block: Block): block is CalloutBlock {
  return block.type === 'callout';
}

export function isDividerBlock(block: Block): block is DividerBlock {
  return block.type === 'divider';
}

export function isRowBlock(block: Block): block is RowBlock {
  return block.type === 'row';
}

/**
 * Block creation options (partial block without id)
 */
export type BlockCreateOptions<T extends Block> = Omit<T, 'id' | 'type'>;
