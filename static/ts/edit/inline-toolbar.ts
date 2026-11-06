import { ICONS } from './icons';
import {
  findFormatAroundSelection,
  findLinkAtCursor,
  getLineHeadingLevel,
  insertLink,
  toggleFormat,
  toggleLineHeading,
} from './markdown-textarea';

type InlineAction = 'bold' | 'italic' | 'underline' | 'link' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4';

const MARKERS: Partial<Record<InlineAction, readonly [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
};

const ACTIONS: Array<{ action: InlineAction; title: string; ariaLabel: string; content: string; isHtml?: boolean }> = [
  { action: 'bold', content: 'B', ariaLabel: 'Bold', title: 'Bold (Cmd/Ctrl+B)' },
  { action: 'italic', content: 'I', ariaLabel: 'Italic', title: 'Italic (Cmd/Ctrl+I)' },
  { action: 'underline', content: 'U', ariaLabel: 'Underline', title: 'Underline (Cmd/Ctrl+U)' },
  { action: 'link', ariaLabel: 'Insert/Edit link', title: 'Insert/Edit link (Cmd/Ctrl+K)', isHtml: true, content: ICONS.link },
  { action: 'heading-1', content: 'H1', ariaLabel: 'Heading 1', title: 'Heading 1' },
  { action: 'heading-2', content: 'H2', ariaLabel: 'Heading 2', title: 'Heading 2' },
  { action: 'heading-3', content: 'H3', ariaLabel: 'Heading 3', title: 'Heading 3' },
  { action: 'heading-4', content: 'H4', ariaLabel: 'Heading 4', title: 'Heading 4' },
];

const SELECTION_MIRROR_PROPERTIES = [
  'box-sizing', 'width', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-transform', 'text-align', 'white-space', 'word-break', 'overflow-wrap',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
];

export interface InlineToolbarTarget {
  textarea: HTMLTextAreaElement;
  row: HTMLElement;
  onEdit: () => void;
}

export interface InlineToolbar {
  setTarget(target: InlineToolbarTarget | null): void;
  /** Clears the target only if it is this textarea, which is the one that just lost focus. */
  releaseTarget(textarea: HTMLTextAreaElement | null): void;
  /** Clears the target if it lives inside `container`, which is about to be rebuilt. */
  releaseTargetWithin(container: HTMLElement): void;
  scheduleUpdate(): void;
}

/** A textarea has no geometry for its selection, so a hidden copy of the text measures it. */
function selectionRect(textarea: HTMLTextAreaElement): DOMRect | null {
  const { selectionStart: start, selectionEnd: end } = textarea;
  if (start === end) return null;

  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  SELECTION_MIRROR_PROPERTIES.forEach((property) => {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  });
  mirror.style.cssText += `;position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:auto;min-height:0;max-height:none;overflow:hidden;white-space:pre-wrap;word-wrap:break-word;width:${textarea.offsetWidth}px`;

  const highlight = document.createElement('span');
  highlight.textContent = textarea.value.slice(start, end) || ' ';
  mirror.append(document.createTextNode(textarea.value.slice(0, start)), highlight);
  document.body.appendChild(mirror);

  const highlightRect = highlight.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  mirror.remove();

  return new DOMRect(
    textareaRect.left + (highlightRect.left - mirrorRect.left) - textarea.scrollLeft,
    textareaRect.top + (highlightRect.top - mirrorRect.top) - textarea.scrollTop,
    Math.max(1, highlightRect.width),
    Math.max(1, highlightRect.height)
  );
}

function headingLevelOf(action: InlineAction): number | null {
  return action.startsWith('heading-') ? Number.parseInt(action.slice(-1), 10) : null;
}

export function createInlineToolbar(anchorRoot: HTMLElement, signal: AbortSignal): InlineToolbar {
  const element = document.createElement('div');
  element.className = 'inline-format-toolbar';
  let target: InlineToolbarTarget | null = null;
  let frame: number | null = null;

  const apply = (action: InlineAction): void => {
    if (!target) return;
    const { textarea, onEdit } = target;
    const markers = MARKERS[action];
    const headingLevel = headingLevelOf(action);

    if (markers) {
      toggleFormat(textarea, markers[0], markers[1], onEdit);
    } else if (headingLevel) {
      toggleLineHeading(textarea, headingLevel);
      onEdit();
    } else {
      void insertLink(textarea, anchorRoot, () => {
        onEdit();
        scheduleUpdate();
      });
      return;
    }
    scheduleUpdate();
  };

  ACTIONS.forEach(({ action, content, title, ariaLabel, isHtml }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `inline-format-btn inline-format-btn-${action}`;
    button.dataset.action = action;
    button.setAttribute('aria-label', ariaLabel);
    button.title = title;
    if (isHtml) {
      button.innerHTML = content;
    } else {
      button.textContent = content;
    }
    // Keeps the textarea's selection through the click.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      apply(action);
    });
    element.appendChild(button);
  });
  document.body.appendChild(element);

  const updateButtonStates = (textarea: HTMLTextAreaElement): void => {
    const { value, selectionStart, selectionEnd } = textarea;
    const headingLevel = getLineHeadingLevel(value);
    const link = findLinkAtCursor(textarea);

    element.querySelectorAll<HTMLButtonElement>('.inline-format-btn').forEach((button) => {
      const action = button.dataset.action as InlineAction;
      const markers = MARKERS[action];
      let active: boolean;
      if (markers) {
        active = !!findFormatAroundSelection(value, selectionStart, selectionEnd, markers[0], markers[1]);
      } else if (action === 'link') {
        active = !!link && selectionStart >= link.start && selectionEnd <= link.end;
      } else {
        active = headingLevel === headingLevelOf(action);
      }
      button.classList.toggle('is-active', active);
    });
  };

  const update = (): void => {
    const hide = (): void => element.classList.remove('visible');
    if (!target?.row.isConnected || !target.textarea.isConnected) return hide();

    const { textarea } = target;
    if (document.activeElement !== textarea) return hide();
    const rect = selectionRect(textarea);
    if (!rect) return hide();

    updateButtonStates(textarea);
    element.classList.add('visible');

    const toolbarRect = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(
      rect.left + (rect.width / 2) - (toolbarRect.width / 2),
      window.innerWidth - toolbarRect.width - margin
    ));
    let top = rect.top - toolbarRect.height - 10;
    if (top < margin) top = rect.bottom + 10;

    element.style.left = `${left}px`;
    element.style.top = `${Math.max(margin, top)}px`;
  };

  const scheduleUpdate = (): void => {
    if (frame !== null || signal.aborted) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  };

  document.addEventListener('selectionchange', scheduleUpdate, { signal });
  window.addEventListener('resize', scheduleUpdate, { signal });
  window.addEventListener('scroll', scheduleUpdate, { capture: true, signal });

  const setTarget = (next: InlineToolbarTarget | null): void => {
    target = next;
    scheduleUpdate();
  };

  return {
    setTarget,
    releaseTarget(textarea) {
      if (target?.textarea === textarea) setTarget(null);
    },
    releaseTargetWithin(container) {
      if (target && container.contains(target.textarea)) setTarget(null);
    },
    scheduleUpdate,
  };
}
