import { getHomepageRuntime } from '../core/runtime-registry';
import { withShowDrafts } from '../core/show-drafts';
import type { AboutData, ProjectData, SaveResult } from '../types/api';
import { API, fetchJSON } from './api';
import { showNotification } from './notify';
import { findActiveContent, findDetailScroller, findProjectContent } from './page-content';
import { createProjectTopControls, makeHeaderEditable } from './project-controls';
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
  load(): Promise<LoadedContent>;
  findContent(): HTMLElement | null;
  /** The subtree whose late-loading media can shift the content while the editor opens. */
  stabilityRoot(content: HTMLElement): ParentNode;
  /** What scrolls this page's content; null means the window. */
  scrollContainer(): HTMLElement | null;
  toolbarTitle(): string;
  saveBody(input: SaveBodyInput): Record<string, unknown>;
  onSaved(result: SaveResult): void;
  mountChrome(deps: PageChromeDeps): void;
  /** The server diffs the about page itself, so only projects hand it assets a session dropped. */
  discardAssets?: (urls: string[]) => Promise<void>;
  /** Absent where the content cannot be deleted. `leave` navigates out of the editor. */
  deleteContent?: (leave: (navigate: () => void) => void) => Promise<void>;
}

function detailScene(): HTMLElement {
  return document.querySelector<HTMLElement>('#homepage-detail-scene') as HTMLElement;
}

export function aboutPage(): PageAdapter {
  return {
    saveRoute: API.saveAbout,
    loadErrorMessage: 'Failed to load about content',

    async load() {
      const data = await fetchJSON<AboutData>(API.about);
      return { markdown: data.markdown ?? '', revision: data.revision ?? null };
    },
    findContent: findActiveContent,
    stabilityRoot: (content) => content,
    scrollContainer: () => null,
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

    const renamed = savedSlug !== nextSlug;
    savedSlug = nextSlug;
    // The server may have normalized what it was sent, but the field may also have moved on since.
    if (project.slug === slugSent) {
      project.slug = nextSlug;
      if (slugInput) slugInput.value = nextSlug;
    }
    if (renamed) getHomepageRuntime()?.renameProjectSlug(nextSlug);
  };

  return {
    saveRoute: API.saveProject,
    loadErrorMessage: 'Failed to load project',

    async load() {
      project = await fetchJSON<ProjectData>(API.project(slug));
      return { markdown: project.markdown ?? '', revision: project.revision ?? null };
    },
    findContent: findProjectContent,
    stabilityRoot: detailScene,
    scrollContainer: findDetailScroller,
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
      const scene = detailScene();
      scene.querySelectorAll('video').forEach((video) => video.pause());
      scene.querySelector('.edit-buttons')?.classList.add('edit-controls-hidden');

      const deps = { project, savedSlug: () => savedSlug, store, markDirty, setToolbarTitle };
      makeHeaderEditable(scene, deps);
      const controls = createProjectTopControls(scene, deps);
      slugInput = controls.querySelector('#inline-settings-slug');
      (scene.querySelector('.video-container') ?? content).before(controls);
    },

    async discardAssets(urls) {
      if (urls.length === 0) return;
      try {
        const response = await fetch(API.cleanupAssets, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls }),
          keepalive: true,
        });
        if (!response.ok) console.warn('Asset cleanup request failed:', response.status);
      } catch (error) {
        console.warn('Asset cleanup request failed:', error);
      }
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
