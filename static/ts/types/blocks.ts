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
  caption: string;
  align?: Alignment;
}

export interface VideoBlock extends BaseBlock {
  type: 'video';
  src: string;
  poster?: string;
  style: string | null;
  caption: string;
  align?: Alignment;
  autoplay?: boolean;
}

export interface CodeBlock extends BaseBlock {
  type: 'code';
  code: string;
  language: string;
}

export interface HtmlBlock extends BaseBlock {
  type: 'html';
  html: string;
  style: string | null;
  caption: string;
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
