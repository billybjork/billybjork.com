import type { BlockContext, CalloutBlock } from '../../types/blocks';
import type { EditorContext } from '../context';
import { setupAutoResizeTextarea } from '../markdown-textarea';

export function renderCalloutBlock(ctx: EditorContext, block: CalloutBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'callout-block-wrapper';

  const textarea = document.createElement('textarea');
  textarea.className = 'callout-textarea';
  textarea.value = block.content || '';
  textarea.placeholder = 'Callout content...';
  if (block.align) textarea.style.textAlign = block.align;

  setupAutoResizeTextarea(textarea, (content) => {
    ctx.store.updateFields(context, { content }, { render: false });
  });

  wrapper.appendChild(textarea);
  return wrapper;
}
