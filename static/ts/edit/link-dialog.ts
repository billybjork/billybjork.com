import { lockBodyScroll, unlockBodyScroll } from '../core/scroll-lock';
import { onEscape } from './modal';

// Matches the .link-dialog-backdrop opacity transition in edit-mode-extras.css.
const FADE_OUT_MS = 150;

interface LinkDialogResult {
  action: 'insert' | 'remove' | 'cancel';
  url?: string;
}

interface LinkDialogOptions {
  existingUrl?: string;
  container: HTMLElement;
}

interface AnchorItem {
  label: string;
  anchor: string;
}

function discoverAnchors(container: HTMLElement): AnchorItem[] {
  const anchors: AnchorItem[] = [
    { label: 'Top of page', anchor: '#hero' }
  ];

  container.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')
    .forEach(el => {
      anchors.push({
        label: el.textContent?.trim() || el.id,
        anchor: `#${el.id}`
      });
    });

  return anchors;
}

export function showLinkDialog(options: LinkDialogOptions): Promise<LinkDialogResult> {
  return new Promise((resolve) => {
    const { existingUrl, container } = options;
    const anchors = discoverAnchors(container);
    const isEditing = !!existingUrl;

    const backdrop = document.createElement('div');
    backdrop.className = 'link-dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'link-dialog';

    const header = document.createElement('div');
    header.className = 'link-dialog-header';
    header.textContent = isEditing ? 'Edit Link' : 'Insert Link';

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'link-dialog-url';
    urlInput.placeholder = 'Paste or type a URL...';
    urlInput.value = existingUrl || '';

    const divider = document.createElement('div');
    divider.className = 'link-dialog-divider';
    divider.textContent = 'or link to a section';

    const sectionsContainer = document.createElement('div');
    sectionsContainer.className = 'link-dialog-sections';

    anchors.forEach(({ label, anchor }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-dialog-section';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        cleanup();
        resolve({ action: 'insert', url: anchor });
      });
      sectionsContainer.appendChild(btn);
    });

    const actions = document.createElement('div');
    actions.className = 'link-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'edit-btn edit-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve({ action: 'cancel' });
    });

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'edit-btn edit-btn-primary';
    insertBtn.textContent = isEditing ? 'Update' : 'Insert';
    insertBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (url) {
        cleanup();
        resolve({ action: 'insert', url });
      }
    });

    actions.appendChild(cancelBtn);

    if (isEditing) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'edit-btn edit-btn-secondary';
      removeBtn.textContent = 'Remove Link';
      removeBtn.addEventListener('click', () => {
        cleanup();
        resolve({ action: 'remove' });
      });
      actions.appendChild(removeBtn);
    }

    actions.appendChild(insertBtn);

    dialog.appendChild(header);
    dialog.appendChild(urlInput);
    dialog.appendChild(divider);
    dialog.appendChild(sectionsContainer);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);

    const listeners = new AbortController();
    const cleanup = (): void => {
      listeners.abort();
      backdrop.classList.remove('visible');
      setTimeout(() => {
        backdrop.remove();
        unlockBodyScroll();
      }, FADE_OUT_MS);
    };

    onEscape(() => {
      cleanup();
      resolve({ action: 'cancel' });
    }, listeners.signal);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const url = urlInput.value.trim();
      if (url) {
        cleanup();
        resolve({ action: 'insert', url });
      }
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve({ action: 'cancel' });
      }
    });

    document.body.appendChild(backdrop);
    lockBodyScroll();

    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      urlInput.focus();
      if (existingUrl) {
        urlInput.select();
      }
    });
  });
}
