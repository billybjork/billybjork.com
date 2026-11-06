import { applySandboxInlineStyle, cleanupIframe, createSandboxedIframe } from '../../utils/html-sandbox';
import type { BlockContext, HtmlBlock } from '../../types/blocks';
import { styleHasHeight } from '../block-style';
import type { EditorContext } from '../context';
import { setupAutoResizeTextarea } from '../markdown-textarea';
import { createMediaCaptionInput } from './media';

export function renderHtmlBlock(ctx: EditorContext, block: HtmlBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'html-block-wrapper';

  if (block.align) wrapper.style.textAlign = block.align;

  const previewContainer = document.createElement('div');
  previewContainer.className = 'html-block-preview-container';
  wrapper.appendChild(previewContainer);

  let iframe: HTMLIFrameElement | null = null;
  let selectOverlay: HTMLButtonElement | null = null;
  let isEditing = false;
  let isInteractive = false;

  const controls = document.createElement('div');
  controls.className = 'html-block-controls';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'html-toggle-btn';
  toggleBtn.textContent = 'Edit HTML';
  toggleBtn.type = 'button';
  controls.appendChild(toggleBtn);

  const interactBtn = document.createElement('button');
  interactBtn.className = 'html-toggle-btn';
  interactBtn.textContent = 'Interact';
  interactBtn.type = 'button';
  controls.appendChild(interactBtn);

  function syncInteractionUi(): void {
    if (selectOverlay) {
      selectOverlay.style.display = isInteractive ? 'none' : 'block';
    }
    interactBtn.classList.toggle('is-active', isInteractive);
    interactBtn.textContent = isInteractive ? 'Resize' : 'Interact';
    interactBtn.disabled = isEditing || !iframe;
    interactBtn.style.display = isEditing ? 'none' : '';
  }

  function renderPreview(html: string): void {
    if (iframe) {
      cleanupIframe(iframe);
      iframe.remove();
      iframe = null;
    }

    if (!html.trim()) {
      selectOverlay = null;
      previewContainer.innerHTML = '<p class="html-block-empty">Empty HTML block</p>';
      syncInteractionUi();
      return;
    }

    previewContainer.innerHTML = '';
    iframe = createSandboxedIframe(html);
    const previewIframe = iframe;
    previewIframe.dataset.autoHeight = styleHasHeight(block.style) ? 'false' : 'true';
    applySandboxInlineStyle(previewIframe, block.style, block.align);
    previewContainer.appendChild(previewIframe);

    selectOverlay = document.createElement('button');
    selectOverlay.type = 'button';
    selectOverlay.className = 'html-block-select-overlay';
    selectOverlay.setAttribute('aria-label', 'Select HTML block for resize');
    selectOverlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctx.media.select(previewIframe, block);
    });
    previewContainer.appendChild(selectOverlay);
    syncInteractionUi();
  }

  renderPreview(block.html || '');

  const textarea = document.createElement('textarea');
  textarea.className = 'html-textarea';
  textarea.value = block.html || '';
  textarea.placeholder = 'Enter raw HTML...';
  textarea.style.display = 'none';
  const captionInput = createMediaCaptionInput(ctx, block.caption, context);
  wrapper.appendChild(textarea);
  wrapper.appendChild(controls);
  wrapper.appendChild(captionInput);

  toggleBtn.addEventListener('click', () => {
    isEditing = !isEditing;
    if (isEditing) {
      previewContainer.style.display = 'none';
      textarea.style.display = 'block';
      toggleBtn.textContent = 'Preview';
      isInteractive = false;
      ctx.media.deselect();
      syncInteractionUi();
      textarea.focus({ preventScroll: true });
    } else {
      previewContainer.style.display = 'block';
      textarea.style.display = 'none';
      toggleBtn.textContent = 'Edit HTML';
      renderPreview(textarea.value);
    }
  });

  interactBtn.addEventListener('click', () => {
    if (!iframe || isEditing) return;
    isInteractive = !isInteractive;
    if (isInteractive) {
      ctx.media.deselect();
    } else {
      ctx.media.select(iframe, block);
    }
    syncInteractionUi();
  });

  // The iframe only rebuilds when switching back to the preview.
  setupAutoResizeTextarea(textarea, (value) => {
    ctx.store.updateFields(context, { html: value }, { render: false });
  });

  syncInteractionUi();

  return wrapper;
}
