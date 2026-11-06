import { lockBodyScroll, unlockBodyScroll } from '../core/scroll-lock';
import { API, postJSON } from './api';
import { onEscape } from './modal';
import { showNotification } from './notify';
import { withShowDrafts } from './show-drafts';
import { isValidSlug, SLUG_INPUT_PATTERN, slugFromName } from './slug';

export function showProjectCreateDialog(): void {
  const modal = document.createElement('div');
  modal.className = 'edit-create-modal';
  modal.innerHTML = `
    <div class="edit-create-overlay"></div>
    <div class="edit-create-content">
      <div class="edit-create-header">
        <h2>Create New Project</h2>
        <button class="edit-create-close">&times;</button>
      </div>
      <form class="edit-create-form" id="create-project-form">
        <div class="edit-form-group">
          <label for="project-name">Project Name</label>
          <input type="text" id="project-name" name="name" required placeholder="My New Project">
        </div>
        <div class="edit-form-group">
          <label for="project-slug">URL Slug</label>
          <input type="text" id="project-slug" name="slug" required placeholder="my-new-project" pattern="${SLUG_INPUT_PATTERN}">
          <span class="edit-form-hint">Must start with letter/number. Lowercase, numbers, hyphens, underscores only.</span>
        </div>
        <div class="edit-form-group">
          <label for="project-date">Date</label>
          <input type="date" id="project-date" name="date" required value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="edit-form-row">
          <div class="edit-form-group edit-form-checkbox">
            <label>
              <input type="checkbox" id="project-draft" name="draft" checked>
              Draft
            </label>
          </div>
          <div class="edit-form-group edit-form-checkbox">
            <label>
              <input type="checkbox" id="project-pinned" name="pinned">
              Pinned
            </label>
          </div>
        </div>
        <div class="edit-create-actions">
          <button type="button" class="edit-btn edit-btn-secondary" id="create-cancel">Cancel</button>
          <button type="submit" class="edit-btn edit-btn-primary">Create Project</button>
        </div>
      </form>
    </div>
  `;

  const listeners = new AbortController();
  const hide = (): void => {
    listeners.abort();
    modal.remove();
    unlockBodyScroll();
  };

  const form = modal.querySelector('form') as HTMLFormElement;
  const nameInput = modal.querySelector('#project-name') as HTMLInputElement;
  const slugInput = modal.querySelector('#project-slug') as HTMLInputElement;

  nameInput.addEventListener('input', () => {
    slugInput.value = slugFromName(nameInput.value);
  });
  modal.querySelector('.edit-create-close')?.addEventListener('click', hide);
  modal.querySelector('.edit-create-overlay')?.addEventListener('click', hide);
  modal.querySelector('#create-cancel')?.addEventListener('click', hide);
  onEscape(hide, listeners.signal);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const slug = String(fields.get('slug'));
    if (!isValidSlug(slug)) {
      showNotification('Slug must start with a letter or number and use only lowercase letters, numbers, hyphens, and underscores.', 'error');
      return;
    }

    try {
      await postJSON(API.createProject, {
        name: fields.get('name'),
        slug,
        date: fields.get('date'),
        draft: fields.get('draft') === 'on',
        pinned: fields.get('pinned') === 'on',
        markdown: '',
      });
      showNotification('Project created!', 'success');
      hide();
      window.location.href = withShowDrafts(`/${slug}`);
    } catch (error) {
      console.error('Create project error:', error);
      showNotification(error instanceof Error ? error.message : 'Failed to create project', 'error');
    }
  });

  document.body.appendChild(modal);
  lockBodyScroll();
  nameInput.focus();
}
