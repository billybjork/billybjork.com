/** The project a site path names, or null for the homepage and other pages. */
export function projectSlugFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '');
  if (!path || path === '/me') return null;

  const slug = decodeURIComponent(path.slice(1)).trim();
  return slug && !slug.includes('/') ? slug : null;
}
