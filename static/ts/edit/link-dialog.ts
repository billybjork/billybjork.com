/**
 * Link Dialog Component
 * Modal dialog for inserting/editing links with internal anchor support
 */

import { lockBodyScroll, unlockBodyScroll } from '../core/utils';

export interface LinkDialogResult {
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

/**
 * Discover anchors (headings with IDs + hero section) from the container
 */
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

/**
 * Show link dialog and return user's choice
 */
export function showLinkDialog(options: LinkDialogOptions): Promise<LinkDialogResult> {
  return new Promise((resolve) => {
    const { existingUrl, container } = options;
    const anchors = discoverAnchors(container);
    const isEditing = !!existingUrl;

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'link-dialog-backdrop';

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'link-dialog';

    // Header
    const header = document.createElement('div');
    header.className = 'link-dialog-header';
    header.textContent = isEditing ? 'Edit Link' : 'Insert Link';

    // URL input
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'link-dialog-url';
    urlInput.placeholder = 'Paste or type a URL...';
    urlInput.value = existingUrl || '';

    // Divider
    const divider = document.createElement('div');
    divider.className = 'link-dialog-divider';
    divider.textContent = 'or link to a section';

    // Sections list
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

    // Actions
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

    // Assemble dialog
    dialog.appendChild(header);
    dialog.appendChild(urlInput);
    dialog.appendChild(divider);
    dialog.appendChild(sectionsContainer);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);

    // Cleanup function
    const cleanup = (): void => {
      backdrop.classList.remove('visible');
      setTimeout(() => {
        backdrop.remove();
        unlockBodyScroll();
        document.removeEventListener('keydown', handleKeydown);
      }, 150);
    };

    // Keyboard handling
    const handleKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve({ action: 'cancel' });
      } else if (e.key === 'Enter' && document.activeElement === urlInput) {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url) {
          cleanup();
          resolve({ action: 'insert', url });
        }
      }
    };

    // Backdrop click to close
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve({ action: 'cancel' });
      }
    });

    // Add to DOM and show
    document.body.appendChild(backdrop);
    lockBodyScroll();
    document.addEventListener('keydown', handleKeydown);

    // Trigger animation
    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      urlInput.focus();
      if (existingUrl) {
        urlInput.select();
      }
    });
  });
}
