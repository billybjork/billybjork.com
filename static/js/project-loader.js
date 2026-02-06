(function() {
    /**
     * ============================
     * Project Loader Module
     * ============================
     * Handles AJAX-based project navigation, infinite scroll,
     * and browser history management (replaces htmx).
     */

    // AbortController for cancelling pending requests
    let currentAbortController = null;

    /**
     * Check if show_drafts is active (from URL or sessionStorage)
     */
    const isShowDraftsActive = () => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('show_drafts')) {
            return params.get('show_drafts') === 'true';
        }
        return sessionStorage.getItem('bb_show_drafts') === 'true';
    };

    /**
     * Build URL with show_drafts parameter if active
     */
    const buildUrl = (path, extraParams = {}) => {
        const url = new URL(path, window.location.origin);
        Object.entries(extraParams).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        });
        if (isShowDraftsActive()) {
            url.searchParams.set('show_drafts', 'true');
        }
        return url.toString();
    };

    /**
     * Dispatch a custom event on the document body
     */
    const dispatchEvent = (eventName, detail = {}) => {
        document.body.dispatchEvent(new CustomEvent(eventName, {
            bubbles: true,
            detail: detail
        }));
    };

    /**
     * Show notification (uses existing showNotification if available)
     */
    const showNotification = (message, isError = false) => {
        const notification = document.createElement('div');
        notification.className = `copy-notification${isError ? ' error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 4000);
    };

    /**
     * Fetch HTML content from a URL
     */
    const fetchHTML = async (url, signal) => {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'text/html'
            },
            signal: signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.text();
    };

    /**
     * Open a project by fetching its details
     */
    const openProject = async (slug, options = {}) => {
        const { pushUrl = true, smoothScroll = true } = options;

        // Find the project item and details container
        const projectItem = document.querySelector(`.project-item[data-slug="${slug}"]`);
        if (!projectItem) {
            console.error(`Project item not found for slug: ${slug}`);
            return;
        }

        // Skip if already open
        if (projectItem.classList.contains('active')) {
            return;
        }

        const detailsContainer = document.getElementById(`details-${slug}`);
        if (!detailsContainer) {
            console.error(`Details container not found for slug: ${slug}`);
            return;
        }

        // Cancel any pending request
        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentAbortController = new AbortController();

        // Close any open projects first
        closeAllProjects();

        // Dispatch beforeLoad event
        dispatchEvent('project:beforeLoad', {
            element: detailsContainer,
            slug: slug,
            isOpen: true
        });

        try {
            const url = buildUrl(`/${slug}`);
            const html = await fetchHTML(url, currentAbortController.signal);

            // Dispatch beforeSwap event
            dispatchEvent('project:beforeSwap', {
                element: detailsContainer,
                slug: slug,
                isOpen: true
            });

            // Update the DOM
            detailsContainer.innerHTML = html;
            projectItem.classList.add('active');

            // Update browser history
            if (pushUrl) {
                const stateUrl = buildUrl(`/${slug}`);
                history.pushState({ slug: slug, isOpen: true }, '', stateUrl);
            }

            // Dispatch afterSwap event
            dispatchEvent('project:afterSwap', {
                element: detailsContainer,
                slug: slug,
                isOpen: true,
                smoothScroll: smoothScroll
            });

            // Dispatch loaded event
            dispatchEvent('project:loaded', {
                element: detailsContainer,
                slug: slug,
                isOpen: true
            });

        } catch (error) {
            if (error.name === 'AbortError') {
                return; // Request was cancelled
            }
            console.error('Failed to load project:', error);
            dispatchEvent('project:error', {
                element: detailsContainer,
                slug: slug,
                error: error
            });
            showNotification('Failed to load content. Please try again.', true);
        } finally {
            currentAbortController = null;
        }
    };

    /**
     * Close a specific project
     */
    const closeProject = async (slug, options = {}) => {
        const { pushUrl = true } = options;

        const projectItem = document.querySelector(`.project-item[data-slug="${slug}"]`);
        if (!projectItem) return;

        const detailsContainer = document.getElementById(`details-${slug}`);
        if (!detailsContainer) return;

        // Dispatch beforeSwap event
        dispatchEvent('project:beforeSwap', {
            element: detailsContainer,
            slug: slug,
            isOpen: false
        });

        // Clear the details and remove active class
        detailsContainer.innerHTML = '';
        projectItem.classList.remove('active');

        // Update browser history
        if (pushUrl) {
            const stateUrl = buildUrl('/');
            history.pushState({ slug: null, isOpen: false }, '', stateUrl);
        }

        // Dispatch afterSwap event
        dispatchEvent('project:afterSwap', {
            element: detailsContainer,
            slug: slug,
            isOpen: false
        });
    };

    /**
     * Close all open projects
     */
    const closeAllProjects = () => {
        const openProjects = document.querySelectorAll('.project-item.active');
        openProjects.forEach(projectItem => {
            const slug = projectItem.dataset.slug;
            const detailsContainer = document.getElementById(`details-${slug}`);

            // Dispatch beforeSwap event
            dispatchEvent('project:beforeSwap', {
                element: detailsContainer,
                slug: slug,
                isOpen: false
            });

            // Clear details
            if (detailsContainer) {
                detailsContainer.innerHTML = '';
            }
            projectItem.classList.remove('active');

            // Dispatch afterSwap event
            dispatchEvent('project:afterSwap', {
                element: detailsContainer,
                slug: slug,
                isOpen: false
            });
        });
    };

    /**
     * Load more projects for infinite scroll
     */
    const loadMoreProjects = async (sentinel) => {
        const page = parseInt(sentinel.dataset.page, 10);
        if (!page || sentinel.dataset.loading === 'true') return;

        sentinel.dataset.loading = 'true';

        try {
            const url = buildUrl('/', { page: page });
            const html = await fetchHTML(url);

            // Replace sentinel with new content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Insert new content before the sentinel
            sentinel.insertAdjacentHTML('beforebegin', html);

            // Remove old sentinel
            sentinel.remove();

            // Dispatch event for new projects
            dispatchEvent('projects:loaded', {
                page: page
            });

        } catch (error) {
            console.error('Failed to load more projects:', error);
            sentinel.dataset.loading = 'false';
            showNotification('Failed to load more projects.', true);
        }
    };

    /**
     * IntersectionObserver for infinite scroll sentinel
     */
    let sentinelObserver = null;

    const initializeSentinelObserver = () => {
        if (sentinelObserver) {
            sentinelObserver.disconnect();
        }

        sentinelObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sentinel = entry.target;
                    if (sentinel.dataset.page) {
                        loadMoreProjects(sentinel);
                    }
                }
            });
        }, {
            rootMargin: '100px',
            threshold: 0
        });

        // Observe any existing sentinel
        observeSentinels();
    };

    const observeSentinels = () => {
        const sentinels = document.querySelectorAll('[id^="infinite-scroll-sentinel-"]');
        sentinels.forEach(sentinel => {
            if (sentinel.dataset.page && sentinelObserver) {
                sentinelObserver.observe(sentinel);
            }
        });
    };

    /**
     * Handle browser back/forward navigation
     */
    const handlePopState = (event) => {
        const state = event.state;

        if (state && state.slug && state.isOpen) {
            // Re-open the project without pushing to history
            openProject(state.slug, { pushUrl: false });
        } else {
            // Close all projects and potentially reload if needed
            const currentPath = window.location.pathname;
            if (currentPath === '/') {
                closeAllProjects();
            } else if (currentPath !== '/me') {
                // Direct URL to a project - reload to get isolation mode
                window.location.reload();
            }
        }
    };

    /**
     * Click delegation for project headers and thumbnails
     */
    const handleProjectClick = (event) => {
        // Check for project header click
        const projectHeader = event.target.closest('.project-header');
        if (projectHeader) {
            const projectItem = projectHeader.closest('.project-item');
            if (projectItem) {
                const slug = projectItem.dataset.slug;
                if (slug) {
                    event.preventDefault();
                    openProject(slug);
                    return;
                }
            }
        }

        // Check for thumbnail click
        const thumbnail = event.target.closest('.thumbnail');
        if (thumbnail) {
            const projectItem = thumbnail.closest('.project-item');
            if (projectItem) {
                const slug = projectItem.dataset.slug;
                if (slug) {
                    event.preventDefault();
                    openProject(slug);
                    return;
                }
            }
        }

        // Check for close button click (non-isolation mode only)
        const closeBtn = event.target.closest('.close-project');
        if (closeBtn) {
            const isIsolationMode = document.body.dataset.isolationMode === 'true';
            if (!isIsolationMode) {
                const projectItem = closeBtn.closest('.project-item');
                if (projectItem) {
                    const slug = projectItem.dataset.slug;
                    if (slug) {
                        event.preventDefault();
                        closeProject(slug);
                        return;
                    }
                }
            }
            // In isolation mode, the existing handler in project-interactions.js
            // will handle the close with animation
        }
    };

    /**
     * Initialize the project loader module
     */
    const initialize = () => {
        // Set up click delegation
        document.body.addEventListener('click', handleProjectClick);

        // Set up popstate handler for browser navigation
        window.addEventListener('popstate', handlePopState);

        // Initialize infinite scroll observer
        initializeSentinelObserver();

        // Re-observe sentinels when new projects are loaded
        document.body.addEventListener('projects:loaded', () => {
            observeSentinels();
        });

        // Set initial history state if not already set
        if (!history.state) {
            const pathname = window.location.pathname;
            if (pathname !== '/' && pathname !== '/me') {
                // On a project page in isolation mode
                const slug = pathname.slice(1); // Remove leading /
                history.replaceState({ slug: slug, isOpen: true }, '');
            } else {
                history.replaceState({ slug: null, isOpen: false }, '');
            }
        }
    };

    // Initialize on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Expose functions to global scope for other modules
    window.ProjectLoader = {
        openProject,
        closeProject,
        closeAllProjects,
        loadMoreProjects,
        dispatchEvent
    };
})();
