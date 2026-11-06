export const ABOUT_PATH = '/me';

export function isAboutPage(): boolean {
  return window.location.pathname === ABOUT_PATH;
}

export function findProjectContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#homepage-detail-content .project-content')
    ?? document.querySelector<HTMLElement>('.project-content');
}

/** The element whose content the editor replaces: the about page, or the open project. */
export function findActiveContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.about-content') ?? findProjectContent();
}
