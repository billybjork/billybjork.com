/**
 * Project Create Modal
 * Handles creating new projects with name, slug, date, and draft/pinned options
 */

import { showNotification, fetchJSON, withShowDrafts } from '../core/utils';

interface ProjectCreateState {
  modal: HTMLElement | null;
}

const ProjectCreate: ProjectCreateState & {
  show(): void;
  hide(): void;
  generateSlug(name: string): string;
  setupEventListeners(): void;
  createProject(): Promise<void>;
} = {
  modal: null,

  /**
   * Show create project modal
   */
  show(): void {
    this.modal = document.createElement('div');
    this.modal.className = 'edit-create-modal';
    this.modal.innerHTML = `
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
            <input type="text" id="project-slug" name="slug" required placeholder="my-new-project" pattern="[a-z0-9\\-]+">
            <span class="edit-form-hint">Lowercase letters, numbers, and hyphens only</span>
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

    document.body.appendChild(this.modal);
    document.body.classList.add('modal-open');

    this.setupEventListeners();

    // Auto-generate slug from name
    const nameInput = this.modal.querySelector('#project-name') as HTMLInputElement | null;
    const slugInput = this.modal.querySelector('#project-slug') as HTMLInputElement | null;

    if (nameInput && slugInput) {
      nameInput.addEventListener('input', () => {
        slugInput.value = this.generateSlug(nameInput.value);
      });

      // Focus name input
      nameInput.focus();
    }
  },

  /**
   * Generate slug from name
   */
  generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  },

  /**
   * Setup event listeners
   */
  setupEventListeners(): void {
    if (!this.modal) return;

    // Close button
    const closeBtn = this.modal.querySelector('.edit-create-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Overlay click
    const overlay = this.modal.querySelector('.edit-create-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => this.hide());
    }

    // Cancel button
    const cancelBtn = this.modal.querySelector('#create-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.hide());
    }

    // Form submit
    const form = this.modal.querySelector('#create-project-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.createProject();
      });
    }

    // Escape key
    const escHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && this.modal) {
        this.hide();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  },

  /**
   * Create the project
   */
  async createProject(): Promise<void> {
    if (!this.modal) return;

    const form = this.modal.querySelector('#create-project-form') as HTMLFormElement | null;
    if (!form) return;

    const formData = new FormData(form);

    const data = {
      name: formData.get('name'),
      slug: formData.get('slug'),
      date: formData.get('date'),
      draft: formData.get('draft') === 'on',
      pinned: formData.get('pinned') === 'on',
      markdown: '',
    };

    try {
      await fetchJSON('/api/create-project', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      showNotification('Project created!', 'success');
      this.hide();

      // Navigate to the new project
      window.location.href = withShowDrafts(`/${data.slug}`);
    } catch (error) {
      console.error('Create project error:', error);
      showNotification('Failed to create project', 'error');
    }
  },

  /**
   * Hide modal
   */
  hide(): void {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
    document.body.classList.remove('modal-open');
  },
};

export default ProjectCreate;
