import { getHomepageRuntime } from '../core/runtime-registry';
import type { AboutData, ProjectData, SaveResult } from '../types/api';
import { API, fetchJSON } from './api';
import { showNotification } from './notify';
import { findActiveContent, findProjectContent } from './page-content';
import { createProjectTopControls, makeHeaderEditable } from './project-controls';
import { withShowDrafts } from './show-drafts';
import type { BlockStore } from './store';

export interface LoadedContent {
  markdown: string;
  revision: string | null;
}

interface SaveBodyInput {
  markdown: string;
  stamp: { force: true } | { base_revision: string | null };
  cleanupCandidates: string[];
}

interface PageChromeDeps {
  content: HTMLElement;
  store: BlockStore;
  markDirty(): void;
  setToolbarTitle(title: string): void;
}

/** Everything that differs between editing a project and editing the about page. */
export interface PageAdapter {
  readonly saveRoute: string;
  readonly loadErrorMessage: string;
  readonly tracksAssets: boolean;
  load(): Promise<LoadedContent>;
  findContent(): HTMLElement | null;
  /** The subtree whose late-loading media can shift the content while the editor opens. */
  stabilityRoot(content: HTMLElement): ParentNode;
  toolbarTitle(): string;
  saveBody(input: SaveBodyInput): Record<string, unknown>;
  onSaved(result: SaveResult): void;
  mountChrome(deps: PageChromeDeps): void;
  /** Absent where the content cannot be deleted. `leave` navigates out of the editor. */
  deleteContent?: (leave: (navigate: () => void) => void) => Promise<void>;
}

function findDetailScene(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#homepage-detail-scene');
}

export function aboutPage(): PageAdapter {
  return {
    saveRoute: API.saveAbout,
    loadErrorMessage: 'Failed to load about content',
    tracksAssets: false,

    async load() {
      const data = await fetchJSON<AboutData>(API.about);
      return { markdown: data.markdown ?? '', revision: data.revision ?? null };
    },
    findContent: findActiveContent,
    stabilityRoot: (content) => content,
    toolbarTitle: () => 'About Page',
    saveBody: ({ markdown, stamp }) => ({ markdown, ...stamp }),
    onSaved() {},
    mountChrome() {},
  };
}

export function projectPage(slug: string): PageAdapter {
  let savedSlug = slug;
  let project: ProjectData;
  let slugInput: HTMLInputElement | null = null;
  let slugSent = slug;

  const followRename = (nextSlugValue: string | undefined): void => {
    const nextSlug = nextSlugValue?.trim();
    if (!nextSlug) return;

    const previousSlug = savedSlug;
    savedSlug = nextSlug;
    // The server may have normalized what it was sent, but the field may also have moved on since.
    if (project.slug === slugSent) {
      project.slug = nextSlug;
      if (slugInput) slugInput.value = nextSlug;
    }
    if (previousSlug === nextSlug) return;

    const runtime = getHomepageRuntime();
    if (runtime) {
      runtime.renameProjectSlug(previousSlug, nextSlug);
      return;
    }
    const url = new URL(window.location.href);
    if (url.pathname !== `/${nextSlug}`) {
      url.pathname = `/${nextSlug}`;
      window.history.replaceState(window.history.state, '', url.toString());
    }
  };

  return {
    saveRoute: API.saveProject,
    loadErrorMessage: 'Failed to load project',
    tracksAssets: true,

    async load() {
      project = await fetchJSON<ProjectData>(API.project(slug));
      return { markdown: project.markdown ?? '', revision: project.revision ?? null };
    },
    findContent: findProjectContent,
    stabilityRoot: (content) => findDetailScene() ?? content,
    toolbarTitle: () => project.name,

    saveBody({ markdown, stamp, cleanupCandidates }) {
      slugSent = project.slug;
      return {
        slug: String(project.slug || savedSlug).trim(),
        original_slug: savedSlug,
        name: project.name,
        date: project.date,
        pinned: project.pinned ?? false,
        draft: project.draft ?? false,
        youtube: project.youtube || '',
        og_image: project.og_image || null,
        video: project.video ?? {},
        markdown,
        ...(cleanupCandidates.length ? { cleanup_candidates: cleanupCandidates } : {}),
        ...stamp,
      };
    },

    onSaved: (result) => followRename(result.slug),

    mountChrome({ content, store, markDirty, setToolbarTitle }) {
      const scene = findDetailScene();
      if (!scene) return;

      scene.querySelectorAll('video').forEach((video) => video.pause());
      scene.querySelector('.edit-buttons')?.classList.add('edit-controls-hidden');

      const deps = { project, savedSlug: () => savedSlug, store, markDirty, setToolbarTitle };
      makeHeaderEditable(scene, deps);
      const controls = createProjectTopControls(scene, deps);
      slugInput = controls.querySelector('#inline-settings-slug');
      (scene.querySelector('.video-container') ?? content).before(controls);
    },

    async deleteContent(leave) {
      const name = project.name || 'this project';
      if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) return;

      try {
        await fetchJSON(API.project(savedSlug), { method: 'DELETE' });
        showNotification('Project deleted', 'success');
        leave(() => {
          window.location.href = withShowDrafts('/');
        });
      } catch (error) {
        console.error('Delete project error:', error);
        showNotification('Failed to delete project', 'error');
      }
    },
  };
}
