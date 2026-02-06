(function() {
    /**
     * ============================
     * Edit Mode Bootstrap (Dev Only)
     * ============================
     * Provides edit-mode UI controls and keyboard shortcuts.
     * Only activates on localhost — no-op in production.
     */

    const isDevMode = () => {
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1';
    };

    if (!isDevMode()) return;

    const isIsolationMode = () => {
        return document.body.dataset.isolationMode === 'true';
    };

    const SHOW_DRAFTS_KEY = 'bb_show_drafts';

    const syncShowDraftsFromUrl = () => {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('show_drafts')) return;

        if (params.get('show_drafts') === 'true') {
            sessionStorage.setItem(SHOW_DRAFTS_KEY, 'true');
        } else {
            sessionStorage.removeItem(SHOW_DRAFTS_KEY);
        }
    };

    const isShowDraftsActive = () => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('show_drafts')) {
            return params.get('show_drafts') === 'true';
        }
        return sessionStorage.getItem(SHOW_DRAFTS_KEY) === 'true';
    };

    const buildUrlWithShowDrafts = (pathname, params = {}) => {
        const url = new URL(pathname, window.location.origin);
        Object.entries(params).forEach(([key, value]) => {
            if (value === null || value === undefined) return;
            url.searchParams.set(key, value);
        });
        if (isShowDraftsActive()) {
            url.searchParams.set('show_drafts', 'true');
        }
        return url.toString();
    };

    /**
     * Load edit mode CSS immediately (for button styling)
     */
    const loadEditModeCSS = () => {
        if (document.querySelector('link[href*="edit-mode.css"]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/static/css/edit-mode.css';
        document.head.appendChild(link);
    };

    /**
     * Load edit mode scripts dynamically
     */
    const loadEditModeScripts = () => {
        return new Promise((resolve) => {
            loadEditModeCSS();

            const cacheBust = `?v=${Date.now()}`;
            const scripts = [
                '/static/js/edit-utils.js',
                '/static/js/edit-blocks.js',
                '/static/js/edit-media.js',
                '/static/js/edit-slash.js',
                '/static/js/edit-undo.js',
                '/static/js/edit-mode.js',
            ];

            let loaded = 0;
            scripts.forEach(src => {
                if (document.querySelector(`script[data-edit-src="${src}"]`)) {
                    loaded++;
                    if (loaded === scripts.length) resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = src + cacheBust;
                script.setAttribute('data-edit-src', src);
                script.onload = () => {
                    loaded++;
                    if (loaded === scripts.length) {
                        resolve();
                    }
                };
                document.head.appendChild(script);
            });

            if (loaded === scripts.length) resolve();
        });
    };

    /**
     * Add project controls (Edit, Settings) to an active project item.
     */
    const addProjectControls = (projectItem) => {
        const slug = projectItem.dataset.slug;
        if (!slug) return;

        if (projectItem.querySelector('.edit-buttons')) return;

        const editBtns = document.createElement('div');
        editBtns.className = 'edit-buttons';

        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn-action';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!isIsolationMode()) {
                window.location.href = buildUrlWithShowDrafts(`/${slug}`, { edit: '' });
                return;
            }

            if (!window.EditMode) {
                await loadEditModeScripts();
            }
            window.EditMode.init(slug);
        });

        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'edit-btn-action edit-btn-settings';
        settingsBtn.innerHTML = '&#9881;';
        settingsBtn.title = 'Project Settings';
        settingsBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!window.ProjectSettings) {
                await loadEditModeScripts();
            }
            window.ProjectSettings.show(slug);
        });

        editBtns.appendChild(editBtn);
        editBtns.appendChild(settingsBtn);
        projectItem.appendChild(editBtns);
    };

    const removeProjectControls = (projectItem) => {
        const editBtns = projectItem.querySelector('.edit-buttons');
        if (editBtns) {
            editBtns.remove();
        }
    };

    /**
     * Add new project button to header (or Edit button on /me page)
     */
    const addNewProjectButton = () => {
        const header = document.querySelector('#main-header nav');
        if (!header || header.querySelector('.new-project-btn')) return;

        const isAboutPage = window.location.pathname === '/me';

        const btn = document.createElement('button');
        btn.className = 'new-project-btn';
        btn.textContent = isAboutPage ? 'Edit' : '+ New Project';
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (isAboutPage) {
                if (!window.EditMode) {
                    await loadEditModeScripts();
                }
                if (window.EditMode) {
                    window.EditMode.initAbout();
                }
            } else {
                if (!window.ProjectCreate) {
                    await loadEditModeScripts();
                }
                window.ProjectCreate.show();
            }
        });

        header.insertBefore(btn, header.firstChild);
    };

    /**
     * Add "Show Drafts" / "Hide Drafts" toggle to header nav (home page only)
     */
    const addShowDraftsToggle = () => {
        if (window.location.pathname !== '/') return;

        const header = document.querySelector('#main-header nav');
        if (!header || header.querySelector('.show-drafts-toggle')) return;

        const params = new URLSearchParams(window.location.search);
        const isActive = isShowDraftsActive();

        const btn = document.createElement('button');
        btn.className = 'show-drafts-toggle' + (isActive ? ' active' : '');
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px;margin-right:5px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Drafts';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const url = new URL(window.location);
            if (isActive) {
                url.searchParams.delete('show_drafts');
                sessionStorage.removeItem(SHOW_DRAFTS_KEY);
            } else {
                url.searchParams.set('show_drafts', 'true');
                sessionStorage.setItem(SHOW_DRAFTS_KEY, 'true');
            }
            window.location.href = url.toString();
        });

        const newProjectBtn = header.querySelector('.new-project-btn');
        if (newProjectBtn) {
            header.insertBefore(btn, newProjectBtn);
        } else {
            header.insertBefore(btn, header.firstChild);
        }
    };

    /**
     * Cmd/Ctrl + E keyboard shortcut to enter edit mode
     */
    const initEditModeKeyboardShortcut = () => {
        document.addEventListener('keydown', async function(event) {
            if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
                if (document.body.classList.contains('editing')) return;

                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                    return;
                }

                event.preventDefault();

                const pathname = window.location.pathname;

                if (pathname === '/me') {
                    const url = new URL(window.location);
                    url.searchParams.set('edit', '');
                    window.history.replaceState({}, '', url);

                    if (!window.EditMode) {
                        await loadEditModeScripts();
                    }
                    if (window.EditMode) {
                        window.EditMode.initAbout();
                    }
                    return;
                }

                const projectItem = document.querySelector('.project-item.active');
                if (projectItem) {
                    const slug = projectItem.dataset.slug;
                    if (slug) {
                        if (!isIsolationMode()) {
                            window.location.href = buildUrlWithShowDrafts(`/${slug}`, { edit: '' });
                            return;
                        }

                        if (!window.EditMode) {
                            await loadEditModeScripts();
                        }
                        window.EditMode.init(slug);
                    }
                }
            }
        });
    };

    /**
     * Initialize edit mode UI and event handlers
     */
    const initializeEditMode = () => {
        syncShowDraftsFromUrl();

        if (window.location.pathname === '/') {
            const params = new URLSearchParams(window.location.search);
            if (!params.has('show_drafts') && isShowDraftsActive()) {
                const url = new URL(window.location);
                url.searchParams.set('show_drafts', 'true');
                window.location.replace(url.toString());
                return;
            }
        }

        loadEditModeCSS();

        addNewProjectButton();
        addShowDraftsToggle();

        document.querySelectorAll('.project-item.active').forEach(addProjectControls);

        document.body.addEventListener('project:afterSwap', (event) => {
            const { element, isOpen } = event.detail;

            if (element && element.classList && element.classList.contains('project-details')) {
                const projectItem = element.closest('.project-item');
                if (projectItem) {
                    if (isOpen) {
                        setTimeout(() => addProjectControls(projectItem), 50);
                    } else {
                        removeProjectControls(projectItem);
                    }
                }
            }
        });

        if (isIsolationMode()) {
            const urlParams = new URLSearchParams(window.location.search);
            const projectItem = document.querySelector('.project-item.active');
            const slug = projectItem?.dataset.slug;

            if (slug) {
                if (urlParams.has('edit')) {
                    setTimeout(async () => {
                        if (!window.EditMode) {
                            await loadEditModeScripts();
                        }
                        window.EditMode.init(slug);
                    }, 100);
                } else if (urlParams.has('settings')) {
                    window.history.replaceState({}, '', buildUrlWithShowDrafts(`/${slug}`));
                    setTimeout(async () => {
                        if (!window.ProjectSettings) {
                            await loadEditModeScripts();
                        }
                        window.ProjectSettings.show(slug);
                    }, 100);
                }
            }
        }

        if (window.location.pathname === '/me') {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('edit')) {
                setTimeout(async () => {
                    if (!window.EditMode) {
                        await loadEditModeScripts();
                    }
                    if (window.EditMode) {
                        window.EditMode.initAbout();
                    }
                }, 100);
            }
        }

        initEditModeKeyboardShortcut();
    };

    document.addEventListener('DOMContentLoaded', initializeEditMode);
})();
