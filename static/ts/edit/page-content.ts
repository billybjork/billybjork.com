export function isAboutPage(): boolean {
  return window.location.pathname === '/me';
}

export function findProjectContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#homepage-detail-content .project-content');
}

/** Project pages scroll inside the detail scene, not the window. */
export function findDetailScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.homepage-detail-scroll');
}

/** The element whose content the editor replaces: the about page, or the open project. */
export function findActiveContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.about-content') ?? findProjectContent();
}
