import type { BlockContext, CodeBlock } from '../../types/blocks';
import type { EditorContext } from '../context';
import { insertTextWithUndo, setupAutoResizeTextarea } from '../markdown-textarea';

const LANGUAGES = ['javascript', 'python', 'html', 'css', 'bash', 'json', 'sql', 'go', 'rust', 'text'];

export function renderCodeBlock(ctx: EditorContext, block: CodeBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'code-block-wrapper';

  const languageSelect = document.createElement('select');
  languageSelect.className = 'code-language-select';
  LANGUAGES.forEach((language) => {
    const option = document.createElement('option');
    option.value = language;
    option.textContent = language;
    option.selected = language === block.language;
    languageSelect.appendChild(option);
  });
  languageSelect.addEventListener('change', () => {
    ctx.store.updateFields(context, { language: languageSelect.value }, { render: false });
  });
  wrapper.appendChild(languageSelect);

  const textarea = document.createElement('textarea');
  textarea.className = 'code-textarea';
  textarea.value = block.code || '';
  textarea.placeholder = 'Enter code...';
  textarea.spellcheck = false;

  const sync = setupAutoResizeTextarea(textarea, (code) => {
    ctx.store.updateFields(context, { code }, { render: false });
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      insertTextWithUndo(textarea, '    ');
      sync();
    }
  });

  wrapper.appendChild(textarea);
  return wrapper;
}
