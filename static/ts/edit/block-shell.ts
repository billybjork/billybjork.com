import type { Alignment, Block, BlockContext } from '../types/blocks';
import type { EditorContext } from './context';
import { ICONS } from './icons';
import { activateLine } from './line-editor';
import type { SlashSelection } from './slash';
import { renderBlockContent } from './views';

const ALIGNMENTS: Array<{ value: Alignment; icon: string; title: string }> = [
  { value: 'left', icon: ICONS.alignLeft, title: 'Align left' },
  { value: 'center', icon: ICONS.alignCenter, title: 'Align center' },
  { value: 'right', icon: ICONS.alignRight, title: 'Align right' },
];

function canAlign(block: Block): boolean {
  return block.type !== 'divider' && block.type !== 'code' && block.type !== 'row';
}

function createAlignmentToolbar(ctx: EditorContext, block: Block, context: BlockContext): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'block-align-toolbar';
  const currentAlign = ('align' in block ? block.align : 'left') || 'left';

  ALIGNMENTS.forEach(({ value, icon, title }) => {
    const button = document.createElement('button');
    button.className = `block-align-btn${currentAlign === value ? ' active' : ''}`;
    button.innerHTML = icon;
    button.title = title;
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      ctx.store.update(context, (target) => ('align' in target ? { ...target, align: value } as Block : target));
    });
    toolbar.appendChild(button);
  });

  return toolbar;
}

function endDrag(ctx: EditorContext): void {
  ctx.drag.sourceIndex = null;
  ctx.drag.dropIndex = null;
  ctx.blocksRoot.querySelectorAll('.dragging, .drag-over-top, .drag-over-bottom').forEach((element) => {
    element.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  });
}

function attachDragHandlers(ctx: EditorContext, wrapper: HTMLElement, handle: HTMLElement, index: number): void {
  const { drag } = ctx;
  handle.addEventListener('dragstart', (event) => {
    drag.sourceIndex = index;
    wrapper.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  });
  handle.addEventListener('dragend', () => endDrag(ctx));

  wrapper.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (drag.sourceIndex === null) return;

    const rect = wrapper.getBoundingClientRect();
    const inTopHalf = event.clientY < rect.top + rect.height / 2;
    ctx.blocksRoot.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((element) => {
      element.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    wrapper.classList.add(inTopHalf ? 'drag-over-top' : 'drag-over-bottom');
    drag.dropIndex = inTopHalf ? index : index + 1;
  });
  wrapper.addEventListener('dragleave', () => {
    wrapper.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  wrapper.addEventListener('drop', (event) => {
    event.preventDefault();
    const { sourceIndex, dropIndex } = drag;
    if (sourceIndex === null || dropIndex === null) return;

    ctx.store.move(sourceIndex, sourceIndex < dropIndex ? dropIndex - 1 : dropIndex);
    endDrag(ctx);
  });
}

function createBlockWrapper(ctx: EditorContext, block: Block, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'block-wrapper';
  wrapper.dataset.blockIndex = String(index);
  wrapper.dataset.blockId = block.id;
  wrapper.dataset.blockType = block.type;

  const handle = document.createElement('div');
  handle.className = 'block-handle';
  handle.innerHTML = ICONS.dragHandle;
  handle.draggable = true;
  wrapper.appendChild(handle);

  const content = document.createElement('div');
  content.className = 'block-content';
  content.appendChild(renderBlockContent(ctx, block, { index }));
  wrapper.appendChild(content);

  if (canAlign(block)) {
    wrapper.appendChild(createAlignmentToolbar(ctx, block, { index }));
  }

  const deleteButton = document.createElement('button');
  deleteButton.className = 'block-delete-btn';
  deleteButton.innerHTML = ICONS.delete;
  deleteButton.title = 'Delete block';
  deleteButton.addEventListener('click', () => ctx.store.remove(index));
  wrapper.appendChild(deleteButton);

  attachDragHandlers(ctx, wrapper, handle, index);
  return wrapper;
}

function createAddButton(ctx: EditorContext, insertIndex: number): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'merge-add-btn';
  button.innerHTML = '+';
  button.title = 'Add block';
  button.addEventListener('click', () => ctx.slash.showFromButton(button, insertIndex));
  return button;
}

function createMergeDivider(ctx: EditorContext, afterIndex: number): HTMLElement {
  const divider = document.createElement('div');
  divider.className = 'merge-divider';
  divider.appendChild(createAddButton(ctx, afterIndex));

  if (ctx.store.canMergeIntoRow(afterIndex)) {
    const columnsButton = document.createElement('button');
    columnsButton.className = 'merge-columns-btn';
    columnsButton.type = 'button';
    columnsButton.innerHTML = ICONS.columns;
    columnsButton.title = 'Turn these two blocks into columns';
    columnsButton.addEventListener('click', () => ctx.store.mergeIntoRow(afterIndex));
    divider.appendChild(columnsButton);
  }

  return divider;
}

function createAddBlockWrapper(ctx: EditorContext, insertIndex: number, position: 'top' | 'bottom'): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `add-block-wrapper add-block-wrapper-${position}`;
  wrapper.appendChild(createAddButton(ctx, insertIndex));
  return wrapper;
}

export function renderBlocks(ctx: EditorContext): void {
  const { blocks } = ctx.store;
  ctx.media.deselect();
  ctx.inlineToolbar.setTarget(null);

  ctx.blocksRoot.innerHTML = '';
  ctx.blocksRoot.appendChild(createAddBlockWrapper(ctx, 0, 'top'));
  blocks.forEach((block, index) => {
    if (index > 0) ctx.blocksRoot.appendChild(createMergeDivider(ctx, index));
    ctx.blocksRoot.appendChild(createBlockWrapper(ctx, block, index));
  });
  if (blocks.length > 0) {
    ctx.blocksRoot.appendChild(createAddBlockWrapper(ctx, blocks.length, 'bottom'));
  }
}

export function rerenderBlockInPlace(ctx: EditorContext, block: Block, index: number): boolean {
  const wrapper = ctx.blocksRoot.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${index}"]`);
  const content = wrapper?.querySelector<HTMLElement>(':scope > .block-content');
  if (!wrapper || !content) return false;

  wrapper.dataset.blockId = block.id;
  wrapper.dataset.blockType = block.type;
  content.innerHTML = '';
  content.appendChild(renderBlockContent(ctx, block, { index }));

  const currentToolbar = wrapper.querySelector<HTMLElement>(':scope > .block-align-toolbar');
  if (canAlign(block)) {
    const nextToolbar = createAlignmentToolbar(ctx, block, { index });
    if (currentToolbar) {
      currentToolbar.replaceWith(nextToolbar);
    } else {
      wrapper.appendChild(nextToolbar);
    }
  } else {
    currentToolbar?.remove();
  }
  return true;
}

function focusNewBlock(ctx: EditorContext, index: number): void {
  const wrapper = ctx.blocksRoot.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${index}"]`);
  const firstLine = wrapper?.querySelector<HTMLElement>('.text-block-line');
  if (firstLine) {
    activateLine(firstLine);
    return;
  }
  wrapper?.querySelector<HTMLTextAreaElement>('.callout-textarea')?.focus({ preventScroll: true });
}

export function runSlashSelection(ctx: EditorContext, { commandId, insertIndex, replaceBlockIndex }: SlashSelection): void {
  let index: number;
  if (replaceBlockIndex !== null) {
    ctx.store.replaceWithNew(replaceBlockIndex, commandId);
    index = replaceBlockIndex;
  } else {
    index = ctx.store.insert(insertIndex, commandId);
  }
  if (commandId === 'text' || commandId === 'callout') focusNewBlock(ctx, index);
}
