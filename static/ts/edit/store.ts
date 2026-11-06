import type { Block, BlockContext, BlockType, RowBlock } from '../types/blocks';
import { createBlock } from './blocks';
import { clamp } from './clamp';

interface UpdateOptions {
  render?: boolean;
  markDirty?: boolean;
}

export interface BlockStore {
  readonly blocks: Block[];
  blockAt(context: BlockContext): Block | null;
  /** Where a block is now. Anything holding on to a block across an await re-finds it with this. */
  contextOf(blockId: string): BlockContext | null;
  update(context: BlockContext, updater: (block: Block) => Block, options?: UpdateOptions): void;
  updateFields(context: BlockContext, updates: Partial<Block>, options?: UpdateOptions): void;
  insert(index: number, type: BlockType): number;
  replaceWithNew(index: number, type: BlockType): void;
  remove(index: number): void;
  move(from: number, to: number): void;
  canMergeIntoRow(afterIndex: number): boolean;
  mergeIntoRow(afterIndex: number): void;
  swapRowColumns(index: number): void;
  splitRow(index: number): void;
  /** Installs a document from history without rendering or marking it as a new edit. */
  restore(blocks: Block[]): void;

  addCleanupCandidate(url: string | null | undefined): void;
  cleanupCandidates(): string[];
  forgetCleanupCandidates(urls: string[]): void;
}

interface StoreDeps {
  onEdit(): void;
  render(): void;
}

/**
 * Only image and hero manifest URLs count: the poster and OG fields are typed by hand, so a
 * partial URL must not become a candidate. A manifest stands for the whole hero video.
 */
function isAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && /\.(webp|png|jpe?g|gif|avif|m3u8)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function createBlockStore(initial: Block[], deps: StoreDeps): BlockStore {
  let blocks = initial;
  const candidates = new Set<string>();

  const commit = (next: Block[], { render = true, markDirty = true }: UpdateOptions = {}): void => {
    blocks = next;
    if (markDirty) deps.onEdit();
    if (render) deps.render();
  };

  const addCleanupCandidate = (url: string | null | undefined): void => {
    const clean = (url ?? '').trim();
    if (isAssetUrl(clean)) candidates.add(clean);
  };

  const trackRemoved = (block: Block | undefined): void => {
    if (block?.type === 'video') addCleanupCandidate(block.poster);
    if (block?.type === 'row') {
      trackRemoved(block.left);
      trackRemoved(block.right);
    }
  };

  const splice = (start: number, deleteCount: number, ...items: Block[]): void => {
    const next = blocks.slice();
    next.splice(start, deleteCount, ...items);
    commit(next);
  };

  const update = (context: BlockContext, updater: (block: Block) => Block, options?: UpdateOptions): void => {
    const current = blocks[context.index];
    if (!current) return;

    let updated: Block;
    const { rowSide } = context;
    if (rowSide) {
      if (current.type !== 'row') return;
      const child = updater(current[rowSide]);
      updated = child === current[rowSide] ? current : { ...current, [rowSide]: child };
    } else {
      updated = updater(current);
    }
    if (updated === current) return;

    const next = blocks.slice();
    next[context.index] = updated;
    commit(next, options);
  };

  const canMergeIntoRow = (afterIndex: number): boolean => {
    const left = blocks[afterIndex - 1];
    const right = blocks[afterIndex];
    return !!left && !!right && left.type !== 'row' && right.type !== 'row';
  };

  return {
    get blocks() {
      return blocks;
    },

    blockAt({ index, rowSide }) {
      const block = blocks[index];
      if (!block) return null;
      if (!rowSide) return block;
      return block.type === 'row' ? block[rowSide] : null;
    },

    contextOf(blockId) {
      for (const [index, block] of blocks.entries()) {
        if (block.id === blockId) return { index };
        if (block.type === 'row') {
          if (block.left.id === blockId) return { index, rowSide: 'left' };
          if (block.right.id === blockId) return { index, rowSide: 'right' };
        }
      }
      return null;
    },

    update,

    updateFields(context, updates, options) {
      update(context, (block) => ({ ...block, ...updates }) as Block, options);
    },

    insert(index, type) {
      const at = clamp(index, 0, blocks.length);
      splice(at, 0, createBlock(type) as Block);
      return at;
    },

    replaceWithNew(index, type) {
      trackRemoved(blocks[index]);
      update({ index }, () => createBlock(type) as Block);
    },

    remove(index) {
      trackRemoved(blocks[index]);
      if (blocks.length <= 1) {
        commit([createBlock('text')]);
      } else {
        splice(index, 1);
      }
    },

    move(from, to) {
      const moved = blocks[from];
      if (!moved || from === to) return;
      const next = blocks.slice();
      next.splice(from, 1);
      next.splice(to, 0, moved);
      commit(next);
    },

    canMergeIntoRow,

    mergeIntoRow(afterIndex) {
      if (!canMergeIntoRow(afterIndex)) return;
      const row: RowBlock = createBlock('row', {
        left: blocks[afterIndex - 1] as Block,
        right: blocks[afterIndex] as Block,
      });
      splice(afterIndex - 1, 2, row);
    },

    swapRowColumns(index) {
      update({ index }, (block) => (
        block.type === 'row' ? { ...block, left: block.right, right: block.left } : block
      ));
    },

    splitRow(index) {
      const row = blocks[index];
      if (row?.type === 'row') splice(index, 1, row.left, row.right);
    },

    restore(next) {
      blocks = next;
    },

    addCleanupCandidate,
    cleanupCandidates: () => Array.from(candidates),
    forgetCleanupCandidates: (urls) => urls.forEach((url) => candidates.delete(url)),
  };
}
