import type { Block, BlockContext, RowBlock } from '../../types/blocks';
import type { EditorContext } from '../context';
import { ICONS } from '../icons';
import { createLineEditor } from '../line-editor';
import { renderCalloutBlock } from './callout';
import { renderCodeBlock } from './code';
import { renderHtmlBlock } from './html';
import { renderImageBlock, renderVideoBlock } from './media';

function createRowAction(icon: string, title: string, extraClass: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `row-action-btn${extraClass}`;
  button.type = 'button';
  button.innerHTML = icon;
  button.title = title;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderRowBlock(ctx: EditorContext, block: RowBlock, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'row-block-wrapper';

  const toolbar = document.createElement('div');
  toolbar.className = 'row-toolbar';
  toolbar.append(
    createRowAction(ICONS.split, 'Split columns into blocks', ' row-action-btn-split', () => ctx.store.splitRow(index)),
    createRowAction(ICONS.swap, 'Swap column sides', '', () => ctx.store.swapRowColumns(index)),
  );
  wrapper.appendChild(toolbar);

  const columns = document.createElement('div');
  columns.className = 'row-columns';
  for (const side of ['left', 'right'] as const) {
    const column = document.createElement('div');
    column.className = `row-column row-column-${side}`;
    column.appendChild(renderBlockContent(ctx, block[side], { index, rowSide: side }));
    columns.appendChild(column);
  }
  wrapper.appendChild(columns);

  return wrapper;
}

export function renderBlockContent(ctx: EditorContext, block: Block, context: BlockContext): HTMLElement {
  switch (block.type) {
    case 'text': {
      const wrapper = document.createElement('div');
      wrapper.className = 'text-block-wrapper';
      wrapper.appendChild(createLineEditor(ctx, block, context));
      return wrapper;
    }
    case 'image':
      return renderImageBlock(ctx, block, context);
    case 'video':
      return renderVideoBlock(ctx, block, context);
    case 'code':
      return renderCodeBlock(ctx, block, context);
    case 'html':
      return renderHtmlBlock(ctx, block, context);
    case 'callout':
      return renderCalloutBlock(ctx, block, context);
    case 'row':
      return renderRowBlock(ctx, block, context.index);
    case 'divider': {
      const wrapper = document.createElement('div');
      wrapper.className = 'block-divider';
      wrapper.innerHTML = ICONS.divider;
      return wrapper;
    }
  }
}
