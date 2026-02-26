import type {
  Block,
  BlockType,
  TextBlock,
  ImageBlock,
  VideoBlock,
  CodeBlock,
  HtmlBlock,
  CalloutBlock,
  RowBlock,
} from '../types/blocks';

export type RowColumnSide = 'left' | 'right';

export interface BlockContext {
  index: number;
  rowSide?: RowColumnSide;
}

export interface BlockUpdateResult {
  changed: boolean;
  nextBlocks: Block[];
}

export function applyBlockUpdates(block: Block, updates: Partial<Block>): Block {
  switch (block.type) {
    case 'text':
      return { ...block, ...(updates as Partial<TextBlock>) };
    case 'image':
      return { ...block, ...(updates as Partial<ImageBlock>) };
    case 'video':
      return { ...block, ...(updates as Partial<VideoBlock>) };
    case 'code':
      return { ...block, ...(updates as Partial<CodeBlock>) };
    case 'html':
      return { ...block, ...(updates as Partial<HtmlBlock>) };
    case 'callout':
      return { ...block, ...(updates as Partial<CalloutBlock>) };
    case 'row':
      return { ...block, ...(updates as Partial<RowBlock>) };
    case 'divider':
    default:
      return { ...block };
  }
}

export function updateTopLevelBlock(
  blocks: Block[],
  index: number,
  updater: (block: Block) => Block
): BlockUpdateResult {
  const currentBlock = blocks[index];
  if (!currentBlock) {
    return { changed: false, nextBlocks: blocks };
  }

  const updatedBlock = updater(currentBlock);
  if (updatedBlock === currentBlock) {
    return { changed: false, nextBlocks: blocks };
  }

  const nextBlocks = blocks.slice();
  nextBlocks[index] = updatedBlock;
  return { changed: true, nextBlocks };
}

export function updateBlockInContext(
  blocks: Block[],
  context: BlockContext,
  updater: (block: Block) => Block
): BlockUpdateResult {
  const rowSide = context.rowSide;
  if (rowSide) {
    return updateTopLevelBlock(blocks, context.index, (parentBlock) => {
      if (parentBlock.type !== 'row') return parentBlock;
      const currentChild = parentBlock[rowSide];
      const updatedChild = updater(currentChild);
      if (updatedChild === currentChild) return parentBlock;
      return rowSide === 'left'
        ? { ...parentBlock, left: updatedChild }
        : { ...parentBlock, right: updatedChild };
    });
  }

  return updateTopLevelBlock(blocks, context.index, updater);
}

export function updateBlockFieldsInContext(
  blocks: Block[],
  context: BlockContext,
  updates: Partial<Block>
): BlockUpdateResult {
  return updateBlockInContext(blocks, context, (block) => applyBlockUpdates(block, updates));
}

export function createBlockWithProps(
  createBlockFactory: (type: BlockType, props: Partial<Block>) => Block,
  type: BlockType,
  props: Partial<Block> = {}
): Block {
  return createBlockFactory(type, props);
}
