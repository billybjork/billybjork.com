/**
 * Edit Mode - Main Block Editor
 * Full block editor with drag-drop and slash commands
 * Supports both project pages and the about page
 */
window.EditMode = (function() {
    'use strict';

    // ========== STATE ==========

    let blocks = [];
    let projectSlug = null;
    let projectData = null;
    let isDirty = false;
    let isActive = false;
    let container = null;
    let toolbar = null;
    let editMode = null; // 'project' or 'about'

    // Auto-save state
    const SaveState = {
        UNCHANGED: 'unchanged',
        PENDING: 'pending',
        SAVING: 'saving',
        SAVED: 'saved',
        ERROR: 'error'
    };
    let saveState = SaveState.UNCHANGED;
    let autoSaveTimer = null;
    let savedFadeTimer = null;
    let retryTimer = null;
    let abortController = null;
    const AUTO_SAVE_DELAY = 2000;
    const RETRY_DELAY = 5000;
    const SAVED_FADE_DELAY = 3000;

    // Drag & Drop state
    let dragState = {
        sourceIndex: null,
        currentDropIndex: null,
        isDragging: false
    };

    // ========== INITIALIZATION ==========

    /**
     * Initialize edit mode for a project
     * @param {string} slug - Project slug
     */
    async function init(slug) {
        if (!EditUtils.isDevMode()) {
            console.log('Edit mode only available on localhost');
            return;
        }

        projectSlug = slug;
        editMode = 'project';
        isActive = true;

        try {
            projectData = await EditUtils.fetchJSON(`/api/project/${slug}`);
            setupEditor(projectData);

            const url = new URL(window.location);
            url.searchParams.set('edit', '');
            window.history.replaceState({}, '', url);
        } catch (error) {
            console.error('Failed to load project:', error);
            EditUtils.showNotification('Failed to load project', 'error');
        }
    }

    /**
     * Initialize edit mode for the about page
     */
    async function initAbout() {
        if (!EditUtils.isDevMode()) {
            console.log('Edit mode only available on localhost');
            return;
        }

        editMode = 'about';
        projectSlug = null;
        isActive = true;

        try {
            projectData = await EditUtils.fetchJSON('/api/about');
            setupEditor(projectData);

            const url = new URL(window.location);
            url.searchParams.set('edit', '');
            window.history.replaceState({}, '', url);
        } catch (error) {
            console.error('Failed to load about content:', error);
            EditUtils.showNotification('Failed to load about content', 'error');
        }
    }

    /**
     * Setup the editor UI
     */
    function setupEditor(data) {
        // Find the content container based on edit mode
        const contentContainer = editMode === 'about'
            ? document.querySelector('.about-content')
            : document.querySelector('.project-content');

        if (!contentContainer) {
            console.error('Content container not found');
            return;
        }

        // For project mode, pause any playing videos
        if (editMode === 'project') {
            const projectItem = contentContainer.closest('.project-item');
            if (projectItem) {
                projectItem.querySelectorAll('video').forEach(video => {
                    video.pause();
                });
            }

            // Replace the Edit/Settings buttons with Save/Cancel buttons
            const editButtons = projectItem?.querySelector('.edit-buttons');
            if (editButtons) {
                editButtons.dataset.originalHtml = editButtons.innerHTML;
                editButtons.innerHTML = `
                    <span class="edit-status"></span>
                    <button class="edit-btn-action edit-btn-cancel" data-action="cancel">Cancel</button>
                    <button class="edit-btn-action edit-btn-save" data-action="save">Save</button>
                `;
                toolbar = editButtons;
                toolbar.querySelector('[data-action="cancel"]').addEventListener('click', handleCancel);
                toolbar.querySelector('[data-action="save"]').addEventListener('click', handleSave);
            }
        }

        // Parse markdown into blocks
        blocks = EditBlocks.parseIntoBlocks(data.markdown || '');

        // Create editor wrapper
        const editorWrapper = document.createElement('div');
        editorWrapper.className = 'edit-mode-container';

        // For about page, include a toolbar since there's no edit-buttons container
        if (editMode === 'about') {
            editorWrapper.innerHTML = `
                <div class="edit-mode-toolbar">
                    <div class="edit-toolbar-left">
                        <span class="edit-project-name">About Page</span>
                        <span class="edit-status"></span>
                    </div>
                    <div class="edit-toolbar-right">
                        <button class="edit-btn edit-btn-secondary" data-action="cancel">Cancel</button>
                        <button class="edit-btn edit-btn-primary" data-action="save">Save</button>
                    </div>
                </div>
                <div class="edit-blocks-container"></div>
            `;
            toolbar = editorWrapper.querySelector('.edit-mode-toolbar');
            toolbar.querySelector('[data-action="cancel"]').addEventListener('click', handleCancel);
            toolbar.querySelector('[data-action="save"]').addEventListener('click', handleSave);
        } else {
            editorWrapper.innerHTML = `
                <div class="edit-blocks-container"></div>
            `;
        }

        // Replace content with editor
        contentContainer.innerHTML = '';
        contentContainer.appendChild(editorWrapper);
        contentContainer.classList.add('edit-mode-active');

        // Get reference to blocks container
        container = editorWrapper.querySelector('.edit-blocks-container');

        // Initialize slash commands
        EditSlash.init(handleSlashCommand);

        // Add keyboard listener
        document.addEventListener('keydown', handleGlobalKeydown);

        // Render blocks
        renderBlocks();

        // Add editing class to body
        document.body.classList.add('editing');

        // Warn before leaving with unsaved changes
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    /**
     * Cleanup and exit edit mode
     */
    function cleanup() {
        isActive = false;

        // Clear auto-save timers
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
        if (savedFadeTimer) {
            clearTimeout(savedFadeTimer);
            savedFadeTimer = null;
        }
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        if (abortController) {
            abortController.abort();
            abortController = null;
        }

        // Reset save state
        saveState = SaveState.UNCHANGED;

        document.removeEventListener('keydown', handleGlobalKeydown);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        EditSlash.cleanup();
        if (window.EditMedia && EditMedia.deselect) {
            EditMedia.deselect();
        }
        document.body.classList.remove('editing');

        // Remove edit-mode-active class from the appropriate container
        const contentContainer = editMode === 'about'
            ? document.querySelector('.about-content')
            : document.querySelector('.project-content');
        if (contentContainer) {
            contentContainer.classList.remove('edit-mode-active');
        }

        // Restore original Edit/Settings buttons (project mode only)
        if (editMode === 'project' && toolbar && toolbar.dataset.originalHtml) {
            toolbar.innerHTML = toolbar.dataset.originalHtml;
            delete toolbar.dataset.originalHtml;
        }

        // Remove edit param from URL
        const url = new URL(window.location);
        url.searchParams.delete('edit');
        window.history.replaceState({}, '', url);

        // Reset state
        editMode = null;
    }

    /**
     * Handle beforeunload event
     */
    function handleBeforeUnload(e) {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    }

    // ========== TOOLBAR ==========

    /**
     * Update toolbar status indicator based on save state
     */
    function updateToolbarStatus() {
        if (!toolbar) return;
        const status = toolbar.querySelector('.edit-status');
        const saveBtn = toolbar.querySelector('[data-action="save"]');

        // Remove all state classes
        saveBtn.classList.remove('has-changes', 'is-saving', 'has-error');

        switch (saveState) {
            case SaveState.UNCHANGED:
                status.textContent = '';
                status.style.color = '';
                break;
            case SaveState.PENDING:
                status.textContent = '(unsaved)';
                status.style.color = '#eab308';
                saveBtn.classList.add('has-changes');
                break;
            case SaveState.SAVING:
                status.textContent = 'Saving...';
                status.style.color = '#3b82f6';
                saveBtn.classList.add('is-saving');
                break;
            case SaveState.SAVED:
                status.textContent = 'Saved';
                status.style.color = '#22c55e';
                break;
            case SaveState.ERROR:
                status.textContent = 'Save failed';
                status.style.color = '#ef4444';
                saveBtn.classList.add('has-error');
                break;
        }
    }

    /**
     * Set the save state and update UI
     */
    function setSaveState(state) {
        saveState = state;
        updateToolbarStatus();

        // Clear fade timer if not in SAVED state
        if (state !== SaveState.SAVED && savedFadeTimer) {
            clearTimeout(savedFadeTimer);
            savedFadeTimer = null;
        }

        // Schedule fade for SAVED state
        if (state === SaveState.SAVED) {
            savedFadeTimer = setTimeout(() => {
                if (saveState === SaveState.SAVED) {
                    setSaveState(SaveState.UNCHANGED);
                }
            }, SAVED_FADE_DELAY);
        }
    }

    /**
     * Schedule auto-save with debounce
     */
    function scheduleAutoSave() {
        // Clear any existing timer
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }

        // Clear retry timer if user is typing
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        // Schedule new auto-save
        autoSaveTimer = setTimeout(() => {
            performAutoSave();
        }, AUTO_SAVE_DELAY);
    }

    /**
     * Perform auto-save (silent, no toast)
     */
    async function performAutoSave() {
        if (!isDirty || saveState === SaveState.SAVING) return;

        // Cancel any in-flight request
        if (abortController) {
            abortController.abort();
        }
        abortController = new AbortController();

        setSaveState(SaveState.SAVING);

        try {
            const markdown = EditBlocks.blocksToMarkdown(blocks);

            let response;
            if (editMode === 'about') {
                response = await fetch('/api/save-about', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ markdown }),
                    signal: abortController.signal
                });
            } else {
                const saveData = {
                    slug: projectSlug,
                    name: projectData.name,
                    date: projectData.date,
                    pinned: projectData.pinned,
                    draft: projectData.draft,
                    youtube: projectData.youtube,
                    video: projectData.video,
                    markdown: markdown
                };

                response = await fetch('/api/save-project', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(saveData),
                    signal: abortController.signal
                });
            }

            if (!response.ok) {
                throw new Error(`Save failed: ${response.status}`);
            }

            isDirty = false;
            setSaveState(SaveState.SAVED);

        } catch (error) {
            if (error.name === 'AbortError') {
                // Request was cancelled, don't show error
                return;
            }
            console.error('Auto-save error:', error);
            setSaveState(SaveState.ERROR);

            // Schedule retry
            retryTimer = setTimeout(() => {
                if (saveState === SaveState.ERROR && isDirty) {
                    performAutoSave();
                }
            }, RETRY_DELAY);
        }
    }

    // ========== BLOCK RENDERING ==========

    /**
     * Render all blocks to the container
     */
    function renderBlocks() {
        if (!container) return;

        if (window.EditMedia && EditMedia.deselect) {
            EditMedia.deselect();
        }

        container.innerHTML = '';

        blocks.forEach((block, index) => {
            // Create merge divider before each block (except first)
            if (index > 0) {
                container.appendChild(createMergeDivider(index));
            }

            // Create block wrapper
            container.appendChild(createBlockWrapper(block, index));
        });

        // Add final "Add Block" button
        container.appendChild(createAddBlockButton(blocks.length));
    }

    /**
     * Create a block wrapper element with all controls
     * @param {object} block - Block data
     * @param {number} index - Block index
     * @returns {HTMLElement}
     */
    function createBlockWrapper(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-wrapper';
        wrapper.dataset.blockIndex = index;
        wrapper.dataset.blockId = block.id;
        wrapper.dataset.blockType = block.type;

        // Drag handle
        const handle = document.createElement('div');
        handle.className = 'block-handle';
        handle.innerHTML = '⋮⋮';
        handle.draggable = true;
        handle.addEventListener('dragstart', (e) => handleDragStart(e, index));
        handle.addEventListener('dragend', handleDragEnd);
        wrapper.appendChild(handle);

        // Block content
        const content = document.createElement('div');
        content.className = 'block-content';
        content.appendChild(renderBlockContent(block, index));
        wrapper.appendChild(content);

        // Alignment toolbar (for most block types, except divider and code)
        if (block.type !== 'divider' && block.type !== 'code') {
            wrapper.appendChild(createAlignmentToolbar(block, index));
        }

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'block-delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete block';
        deleteBtn.addEventListener('click', () => deleteBlock(index));
        wrapper.appendChild(deleteBtn);

        // Drag over handling
        wrapper.addEventListener('dragover', (e) => handleDragOver(e, index));
        wrapper.addEventListener('dragleave', handleDragLeave);
        wrapper.addEventListener('drop', (e) => handleDrop(e, index));

        return wrapper;
    }

    /**
     * Create alignment toolbar with left/center/right buttons
     * @param {object} block - Block data
     * @param {number} index - Block index
     * @returns {HTMLElement}
     */
    function createAlignmentToolbar(block, index) {
        const toolbar = document.createElement('div');
        toolbar.className = 'block-align-toolbar';

        const currentAlign = block.align || 'left';

        const alignments = [
            { value: 'left', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>', title: 'Align left' },
            { value: 'center', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>', title: 'Align center' },
            { value: 'right', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>', title: 'Align right' }
        ];

        alignments.forEach(({ value, icon, title }) => {
            const btn = document.createElement('button');
            btn.className = 'block-align-btn' + (currentAlign === value ? ' active' : '');
            btn.innerHTML = icon;
            btn.title = title;
            btn.type = 'button';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                setBlockAlignment(index, value);
            });
            toolbar.appendChild(btn);
        });

        return toolbar;
    }

    /**
     * Set alignment for a block
     * @param {number} index - Block index
     * @param {string} align - 'left', 'center', or 'right'
     */
    function setBlockAlignment(index, align) {
        if (blocks[index]) {
            blocks[index].align = align;
            markDirty();
            renderBlocks();
        }
    }

    /**
     * Render block content based on type
     * @param {object} block - Block data
     * @param {number} index - Block index
     * @returns {HTMLElement}
     */
    function renderBlockContent(block, index) {
        switch (block.type) {
            case 'text':
                return renderTextBlock(block, index);
            case 'image':
                return renderImageBlock(block, index);
            case 'video':
                return renderVideoBlock(block, index);
            case 'code':
                return renderCodeBlock(block, index);
            case 'html':
                return renderHtmlBlock(block, index);
            case 'callout':
                return renderCalloutBlock(block, index);
            case 'row':
                return renderRowBlock(block, index);
            case 'divider':
                return renderDividerBlock(block, index);
            default:
                return renderTextBlock(block, index);
        }
    }

    /**
     * Render text block as line-aware markdown preview + inline editor
     */
    function renderTextBlock(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'text-block-wrapper';
        wrapper.appendChild(createLineEditor(block, index));
        return wrapper;
    }

    /**
     * Create a line-based editor for a text block with inline markdown preview
     * @param {object} block - Block data
     * @param {number|string} index - Block index
     * @returns {HTMLElement}
     */
    function createLineEditor(block, index) {
        const container = document.createElement('div');
        container.className = 'text-block-lines';

        if (block.align) {
            container.style.textAlign = block.align;
        }

        let lines = (block.content || '').split('\n');
        if (!lines.length) lines = [''];

        let activeLineIndex = null;

        const updateBlockContent = () => {
            block.content = lines.join('\n');
            markDirty();
        };

        const renderLines = (focusLineIndex = null, focusCaret = null) => {
            container.innerHTML = '';
            lines.forEach((lineText, lineIndex) => {
                const row = buildLineRow(lineText, lineIndex);
                container.appendChild(row);
            });

            requestAnimationFrame(() => {
                container.querySelectorAll('.text-block-line').forEach((row) => {
                    syncLineHeight(row);
                });
            });

            if (focusLineIndex != null) {
                const row = container.querySelector(`.text-block-line[data-line-index="${focusLineIndex}"]`);
                if (row) {
                    activateLine(row, focusCaret);
                }
            }
        };

        const attachLinkPreviewHandlers = (preview, row) => {
            preview.querySelectorAll('a[data-link-url-start]').forEach((linkEl) => {
                linkEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const start = parseInt(linkEl.dataset.linkUrlStart, 10);
                    const end = parseInt(linkEl.dataset.linkUrlEnd, 10);
                    if (!Number.isNaN(start) && !Number.isNaN(end)) {
                        activateLine(row, { start, end });
                    } else {
                        activateLine(row);
                    }
                });
            });
        };

        const buildLineRow = (lineText, lineIndex) => {
            const row = document.createElement('div');
            row.className = 'text-block-line';
            row.dataset.lineIndex = lineIndex;

            const preview = document.createElement('div');
            preview.className = 'text-block-line-preview';

            const isSingleEmptyLine = lines.length === 1 && !lines[0].trim();
            if (isSingleEmptyLine) {
                preview.classList.add('text-block-line-placeholder');
                preview.textContent = 'Type something... (type / for commands)';
            } else {
                preview.appendChild(renderLinePreview(lineText));
            }

            attachLinkPreviewHandlers(preview, row);

            const textarea = document.createElement('textarea');
            textarea.className = 'text-line-input';
            textarea.value = lineText;
            textarea.rows = 1;
            textarea.placeholder = 'Type something... (type / for commands)';

            preview.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                activateLine(row);
            });

            row.addEventListener('click', (e) => {
                if (!row.classList.contains('is-editing')) {
                    e.preventDefault();
                    e.stopPropagation();
                    activateLine(row);
                }
            });

            textarea.addEventListener('input', () => {
                const newValue = textarea.value;

                EditSlash.handleTextareaInput(textarea, index);

                if (newValue.includes('\n')) {
                    const splitLines = newValue.split('\n');
                    lines.splice(lineIndex, 1, ...splitLines);
                    updateBlockContent();
                    renderLines(lineIndex + splitLines.length - 1, splitLines[splitLines.length - 1].length);
                    return;
                }

                lines[lineIndex] = newValue;
                updateBlockContent();
                syncLineHeight(row);
            });

            textarea.addEventListener('keydown', (e) => {
                // Slash command navigation
                if (EditSlash.isActive()) {
                    if (EditSlash.handleKeydown(e)) return;
                }

                // Formatting shortcuts
                if (EditUtils.handleFormattingShortcuts(e, textarea, markDirty)) {
                    lines[lineIndex] = textarea.value;
                    updateBlockContent();
                    syncLineHeight(row);
                    return;
                }

                // List indentation shortcuts
                if (EditUtils.handleListShortcuts(e, textarea, markDirty)) return;

                if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    handleLineSplit(textarea, lineIndex);
                    return;
                }

                if (e.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
                    if (lineIndex > 0) {
                        e.preventDefault();
                        mergeWithPreviousLine(lineIndex);
                    }
                    return;
                }

                if (e.key === 'Delete' && textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length) {
                    if (lineIndex < lines.length - 1) {
                        e.preventDefault();
                        mergeWithNextLine(lineIndex);
                    }
                    return;
                }

                if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
                    if (lineIndex > 0) {
                        e.preventDefault();
                        renderLines(lineIndex - 1, lines[lineIndex - 1].length);
                    }
                    return;
                }

                if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length) {
                    if (lineIndex < lines.length - 1) {
                        e.preventDefault();
                        renderLines(lineIndex + 1, 0);
                    }
                }
            });

            textarea.addEventListener('blur', () => {
                if (activeLineIndex !== lineIndex) return;
                deactivateLine(row);
            });

            row.appendChild(preview);
            row.appendChild(textarea);
            return row;
        };

        const activateLine = (row, selection = null) => {
            const lineIndex = Number(row.dataset.lineIndex);

            if (activeLineIndex !== null && activeLineIndex !== lineIndex) {
                const previousRow = container.querySelector(`.text-block-line[data-line-index="${activeLineIndex}"]`);
                if (previousRow) deactivateLine(previousRow);
            }

            activeLineIndex = lineIndex;
            row.classList.add('is-editing');

            const textarea = row.querySelector('.text-line-input');
            textarea.focus();
            if (selection && typeof selection === 'object') {
                textarea.selectionStart = selection.start;
                textarea.selectionEnd = selection.end ?? selection.start;
            } else if (typeof selection === 'number') {
                textarea.selectionStart = selection;
                textarea.selectionEnd = selection;
            } else {
                textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
            }

            syncLineHeight(row);
        };

        const deactivateLine = (row) => {
            const lineIndex = Number(row.dataset.lineIndex);
            const textarea = row.querySelector('.text-line-input');
            const preview = row.querySelector('.text-block-line-preview');

            row.classList.remove('is-editing');

            const currentText = textarea.value;
            preview.classList.remove('text-block-line-placeholder');
            preview.innerHTML = '';

            const isSingleEmptyLine = lines.length === 1 && !lines[0].trim();
            if (isSingleEmptyLine && !currentText.trim()) {
                preview.classList.add('text-block-line-placeholder');
                preview.textContent = 'Type something... (type / for commands)';
            } else {
                preview.appendChild(renderLinePreview(currentText));
                attachLinkPreviewHandlers(preview, row);
            }

            activeLineIndex = null;
            syncLineHeight(row);
        };

        const handleLineSplit = (textarea, lineIndex) => {
            const value = textarea.value;
            const cursor = textarea.selectionStart;
            const before = value.slice(0, cursor);
            const after = value.slice(cursor);

            const listContinuation = getListContinuation(before);

            lines[lineIndex] = before;
            const nextLine = listContinuation ? listContinuation + after.replace(/^\s+/, '') : after;
            lines.splice(lineIndex + 1, 0, nextLine);
            updateBlockContent();

            const caret = listContinuation ? listContinuation.length : 0;
            renderLines(lineIndex + 1, caret);
        };

        const mergeWithPreviousLine = (lineIndex) => {
            if (lineIndex <= 0) return;
            const previous = lines[lineIndex - 1];
            const current = lines[lineIndex];
            const merged = previous + current;
            lines.splice(lineIndex - 1, 2, merged);
            updateBlockContent();
            renderLines(lineIndex - 1, previous.length);
        };

        const mergeWithNextLine = (lineIndex) => {
            if (lineIndex >= lines.length - 1) return;
            const current = lines[lineIndex];
            const next = lines[lineIndex + 1];
            const merged = current + next;
            lines.splice(lineIndex, 2, merged);
            updateBlockContent();
            renderLines(lineIndex, current.length);
        };

        const syncLineHeight = (row) => {
            const preview = row.querySelector('.text-block-line-preview');
            const textarea = row.querySelector('.text-line-input');

            requestAnimationFrame(() => {
                const previewHeight = preview ? preview.offsetHeight : 0;
                const inputHeight = textarea ? textarea.scrollHeight : 0;
                const minHeight = Math.max(27, previewHeight);
                row.style.minHeight = `${minHeight}px`;
                if (row.classList.contains('is-editing')) {
                    row.style.height = `${Math.max(minHeight, inputHeight)}px`;
                } else {
                    row.style.height = '';
                }
            });
        };

        const getListContinuation = (lineText) => {
            const unorderedMatch = lineText.match(/^(\s*)([-*+])\s+/);
            if (unorderedMatch) {
                return `${unorderedMatch[1]}${unorderedMatch[2]} `;
            }
            const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s+/);
            if (orderedMatch) {
                const nextNum = parseInt(orderedMatch[2], 10) + 1;
                return `${orderedMatch[1]}${nextNum}. `;
            }
            return null;
        };

        renderLines();
        return container;
    }

    /**
     * Render a single line of markdown into preview HTML
     * @param {string} lineText
     * @returns {HTMLElement}
     */
    function renderLinePreview(lineText) {
        const trimmed = lineText.trim();

        if (!trimmed) {
            const empty = document.createElement('span');
            empty.innerHTML = '&nbsp;';
            return empty;
        }

        if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
            const hr = document.createElement('hr');
            hr.className = 'text-line-divider';
            return hr;
        }

        const headingMatch = lineText.match(/^(\s*)(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[2].length;
            const contentStart = lineText.indexOf(headingMatch[3]);
            const heading = document.createElement(`h${level}`);
            heading.appendChild(renderInlineMarkdown(headingMatch[3], contentStart));
            return heading;
        }

        const quoteMatch = lineText.match(/^(\s*)>\s+(.*)$/);
        if (quoteMatch) {
            const contentStart = lineText.indexOf(quoteMatch[2]);
            const quote = document.createElement('blockquote');
            quote.appendChild(renderInlineMarkdown(quoteMatch[2], contentStart));
            return quote;
        }

        const listMatch = lineText.match(/^(\s*)([-*+])\s+(.*)$/);
        if (listMatch) {
            return renderListLine({
                indent: listMatch[1],
                marker: listMatch[2],
                content: listMatch[3],
                ordered: false,
                baseOffset: lineText.indexOf(listMatch[3])
            });
        }

        const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (orderedMatch) {
            return renderListLine({
                indent: orderedMatch[1],
                marker: orderedMatch[2],
                content: orderedMatch[3],
                ordered: true,
                baseOffset: lineText.indexOf(orderedMatch[3])
            });
        }

        const span = document.createElement('span');
        span.appendChild(renderInlineMarkdown(lineText, 0));
        return span;
    }

    /**
     * Render a list-like preview line
     * @param {object} params
     * @returns {HTMLElement}
     */
    function renderListLine(params) {
        const listLine = document.createElement('div');
        listLine.className = 'text-line-list' + (params.ordered ? ' text-line-list-ordered' : ' text-line-list-unordered');

        const indentLevel = getIndentLevel(params.indent);
        if (indentLevel > 0) {
            listLine.style.marginLeft = `${indentLevel * 18}px`;
        }

        let contentText = params.content || '';
        let contentOffset = params.baseOffset || 0;
        let isTask = false;
        let isChecked = false;

        const taskMatch = contentText.match(/^\[( |x|X)\]\s*(.*)$/);
        if (taskMatch) {
            isTask = true;
            isChecked = taskMatch[1].toLowerCase() === 'x';
            const prefixLength = taskMatch[0].length - taskMatch[2].length;
            contentOffset += prefixLength;
            contentText = taskMatch[2];
        }

        const marker = document.createElement('span');
        marker.className = 'text-line-list-marker';
        marker.textContent = params.ordered ? `${params.marker}.` : (isTask ? '' : '•');

        if (isTask) {
            const taskBox = document.createElement('span');
            taskBox.className = 'text-line-task-box' + (isChecked ? ' checked' : '');
            taskBox.setAttribute('aria-hidden', 'true');
            marker.appendChild(taskBox);
        }

        const content = document.createElement('div');
        content.className = 'text-line-list-content' + (isChecked ? ' checked' : '');
        const leadingSpaces = (contentText.match(/^\s*/) || [''])[0].length;
        if (leadingSpaces) {
            contentOffset += leadingSpaces;
            contentText = contentText.slice(leadingSpaces);
        }
        const trimmedContent = contentText.trimEnd();
        if (trimmedContent.trim()) {
            content.appendChild(renderInlineMarkdown(trimmedContent, contentOffset));
        } else {
            const empty = document.createElement('span');
            empty.innerHTML = '&nbsp;';
            content.appendChild(empty);
        }

        listLine.appendChild(marker);
        listLine.appendChild(content);
        return listLine;
    }

    /**
     * Convert indentation whitespace into a list indent level
     * @param {string} indent
     * @returns {number}
     */
    function getIndentLevel(indent) {
        if (!indent) return 0;
        const normalized = indent.replace(/\t/g, '   ');
        return Math.floor(normalized.length / 3);
    }

    /**
     * Render inline markdown into a fragment (links + basic formatting)
     * @param {string} text
     * @param {number} baseOffset
     * @returns {DocumentFragment}
     */
    function renderInlineMarkdown(text, baseOffset = 0) {
        const fragment = document.createDocumentFragment();
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let lastIndex = 0;
        let match;

        while ((match = linkRegex.exec(text)) !== null) {
            const [fullMatch, label, url] = match;
            const offset = match.index;

            if (offset > lastIndex) {
                appendInlineFormatted(fragment, text.slice(lastIndex, offset));
            }

            const safeUrl = sanitizeUrl(url);
            if (safeUrl) {
                const link = document.createElement('a');
                link.href = safeUrl;
                link.rel = 'noopener';
                link.target = '_blank';
                const linkStart = offset + baseOffset;
                const urlStart = linkStart + 1 + label.length + 2;
                link.dataset.linkUrlStart = String(urlStart);
                link.dataset.linkUrlEnd = String(urlStart + url.length);
                appendInlineFormatted(link, label);
                fragment.appendChild(link);
            } else {
                fragment.appendChild(document.createTextNode(fullMatch));
            }

            lastIndex = offset + fullMatch.length;
        }

        if (lastIndex < text.length) {
            appendInlineFormatted(fragment, text.slice(lastIndex));
        }

        return fragment;
    }

    /**
     * Append formatted inline content into a container
     * @param {HTMLElement|DocumentFragment} container
     * @param {string} text
     */
    function appendInlineFormatted(container, text) {
        container.appendChild(parseInlineTokens(text));
    }

    /**
     * Parse inline markdown tokens (bold, italic, underline, code, strikethrough)
     * @param {string} text
     * @returns {DocumentFragment}
     */
    function parseInlineTokens(text) {
        const fragment = document.createDocumentFragment();
        let index = 0;

        while (index < text.length) {
            const token = findNextInlineToken(text, index);
            if (!token) {
                fragment.appendChild(document.createTextNode(text.slice(index)));
                break;
            }

            if (token.index > index) {
                fragment.appendChild(document.createTextNode(text.slice(index, token.index)));
            }

            index = token.index;

            if (token.type === 'code') {
                const closeIndex = findTokenIndex(text, token.delimiter, index + token.length);
                if (closeIndex === -1) {
                    fragment.appendChild(document.createTextNode(token.delimiter));
                    index += token.length;
                    continue;
                }
                const codeText = text.slice(index + token.length, closeIndex);
                if (!codeText) {
                    fragment.appendChild(document.createTextNode(token.delimiter));
                    index += token.length;
                    continue;
                }
                const code = document.createElement('code');
                code.textContent = codeText;
                fragment.appendChild(code);
                index = closeIndex + token.length;
                continue;
            }

            if (token.type === 'underline') {
                const closeIndex = text.indexOf('</u>', index + token.length);
                if (closeIndex === -1) {
                    fragment.appendChild(document.createTextNode(token.delimiter));
                    index += token.length;
                    continue;
                }
                const inner = text.slice(index + token.length, closeIndex);
                if (!inner.trim()) {
                    fragment.appendChild(document.createTextNode(token.delimiter));
                    index += token.length;
                    continue;
                }
                const underline = document.createElement('u');
                underline.appendChild(parseInlineTokens(inner));
                fragment.appendChild(underline);
                index = closeIndex + 4;
                continue;
            }

            const closeIndex = findTokenIndex(text, token.delimiter, index + token.length);
            if (closeIndex === -1) {
                fragment.appendChild(document.createTextNode(token.delimiter));
                index += token.length;
                continue;
            }

            const inner = text.slice(index + token.length, closeIndex);
            if (!inner.trim()) {
                fragment.appendChild(document.createTextNode(token.delimiter));
                index += token.length;
                continue;
            }

            let element = null;
            if (token.type === 'bold') {
                element = document.createElement('strong');
            } else if (token.type === 'italic') {
                element = document.createElement('em');
            } else if (token.type === 'strikethrough') {
                element = document.createElement('s');
            }

            if (!element) {
                fragment.appendChild(document.createTextNode(token.delimiter));
                index += token.length;
                continue;
            }

            element.appendChild(parseInlineTokens(inner));
            fragment.appendChild(element);
            index = closeIndex + token.length;
        }

        return fragment;
    }

    /**
     * Find the next inline token candidate
     * @param {string} text
     * @param {number} startIndex
     * @returns {Object|null}
     */
    function findNextInlineToken(text, startIndex) {
        const tokens = [
            { type: 'code', delimiter: '`' },
            { type: 'underline', delimiter: '<u>' },
            { type: 'bold', delimiter: '**' },
            { type: 'bold', delimiter: '__' },
            { type: 'strikethrough', delimiter: '~~' },
            { type: 'italic', delimiter: '*' },
            { type: 'italic', delimiter: '_' }
        ];

        let best = null;

        tokens.forEach((token) => {
            const idx = findTokenIndex(text, token.delimiter, startIndex);
            if (idx === -1) return;
            const length = token.delimiter.length;
            if (!best || idx < best.index || (idx === best.index && length > best.length)) {
                best = {
                    ...token,
                    index: idx,
                    length
                };
            }
        });

        return best;
    }

    /**
     * Find token index, skipping escaped delimiters
     * @param {string} text
     * @param {string} delimiter
     * @param {number} startIndex
     * @returns {number}
     */
    function findTokenIndex(text, delimiter, startIndex) {
        let idx = text.indexOf(delimiter, startIndex);
        while (idx !== -1) {
            if (idx > 0 && text[idx - 1] === '\\') {
                idx = text.indexOf(delimiter, idx + delimiter.length);
                continue;
            }
            return idx;
        }
        return -1;
    }

    /**
     * Basic URL sanitizer for preview links
     * @param {string} url
     * @returns {string|null}
     */
    function sanitizeUrl(url) {
        const trimmed = (url || '').trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
            return trimmed;
        }

        try {
            const parsed = new URL(trimmed, window.location.origin);
            if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
                return parsed.href;
            }
        } catch (err) {
            return null;
        }

        return null;
    }

    /**
     * Render image block
     */
    function renderImageBlock(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'image-block-wrapper';

        if (block.src) {
            const img = EditUtils.createImageElement(block, (element) => {
                if (window.EditMedia && EditMedia.select) {
                    EditMedia.select(element, block);
                }
            });
            img.className = 'block-image';
            wrapper.appendChild(img);

            // Alt text input
            const altInput = document.createElement('input');
            altInput.type = 'text';
            altInput.className = 'image-alt-input';
            altInput.placeholder = 'Image description...';
            altInput.value = block.alt || '';
            altInput.addEventListener('input', () => {
                blocks[index].alt = altInput.value;
                markDirty();
            });
            wrapper.appendChild(altInput);
        } else {
            // Upload zone
            wrapper.appendChild(createUploadZone(index, 'image'));
        }

        return wrapper;
    }

    /**
     * Render video block
     */
    function renderVideoBlock(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'video-block-wrapper';

        if (block.src) {
            const video = EditUtils.createVideoElement(block);
            video.className = 'block-video';
            wrapper.appendChild(video);
        } else {
            // Upload zone
            wrapper.appendChild(createUploadZone(index, 'video'));
        }

        return wrapper;
    }

    /**
     * Render code block
     */
    function renderCodeBlock(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';

        // Apply alignment to wrapper
        if (block.align) {
            EditUtils.applyAlignment(wrapper, block.align);
        }

        // Language selector
        const langSelect = document.createElement('select');
        langSelect.className = 'code-language-select';
        const languages = ['javascript', 'python', 'html', 'css', 'bash', 'json', 'sql', 'go', 'rust', 'text'];
        languages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang;
            option.textContent = lang;
            if (lang === (block.language || 'javascript')) option.selected = true;
            langSelect.appendChild(option);
        });
        langSelect.addEventListener('change', () => {
            blocks[index].language = langSelect.value;
            markDirty();
        });
        wrapper.appendChild(langSelect);

        // Code textarea
        const textarea = document.createElement('textarea');
        textarea.className = 'code-textarea';
        textarea.value = block.code || '';
        textarea.placeholder = 'Enter code...';
        textarea.spellcheck = false;

        EditUtils.setupAutoResizeTextarea(textarea, (value) => {
            blocks[index].code = value;
            markDirty();
        });

        // Tab handling for code
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                EditUtils.insertTextWithUndo(textarea, '    ');
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        wrapper.appendChild(textarea);
        return wrapper;
    }

    /**
     * Render callout block
     */
    function renderCalloutBlock(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'callout-block-wrapper';

        const textarea = document.createElement('textarea');
        textarea.className = 'callout-textarea';
        textarea.value = block.content || '';
        textarea.placeholder = 'Callout content...';

        // Apply text alignment
        if (block.align) {
            textarea.style.textAlign = block.align;
        }

        EditUtils.setupAutoResizeTextarea(textarea, (value) => {
            blocks[index].content = value;
            markDirty();
        });

        wrapper.appendChild(textarea);
        return wrapper;
    }

    /**
     * Render row block (two columns)
     */
    function renderRowBlock(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'row-block-wrapper';

        const leftCol = document.createElement('div');
        leftCol.className = 'row-column row-column-left';
        leftCol.appendChild(renderBlockContent(block.left, `${index}-left`));

        const rightCol = document.createElement('div');
        rightCol.className = 'row-column row-column-right';
        rightCol.appendChild(renderBlockContent(block.right, `${index}-right`));

        wrapper.appendChild(leftCol);
        wrapper.appendChild(rightCol);

        return wrapper;
    }

    /**
     * Render divider block
     */
    function renderDividerBlock(block, index) {
        const hr = document.createElement('hr');
        hr.className = 'block-divider';
        return hr;
    }

    /**
     * Render HTML block (raw HTML content)
     */
    function renderHtmlBlock(block, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'html-block-wrapper';

        // Apply alignment
        if (block.align) {
            wrapper.style.textAlign = block.align;
        }

        // Preview area (shows rendered HTML)
        const preview = document.createElement('div');
        preview.className = 'html-block-preview';
        preview.innerHTML = block.html || '<p style="color: #666;">Empty HTML block</p>';
        wrapper.appendChild(preview);

        // Toggle button to show/hide source
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'html-toggle-btn';
        toggleBtn.textContent = 'Edit HTML';
        toggleBtn.type = 'button';
        wrapper.appendChild(toggleBtn);

        // Textarea for editing HTML (hidden by default)
        const textarea = document.createElement('textarea');
        textarea.className = 'html-textarea';
        textarea.value = block.html || '';
        textarea.placeholder = 'Enter raw HTML...';
        textarea.style.display = 'none';
        wrapper.appendChild(textarea);

        // Toggle between preview and edit
        let isEditing = false;
        toggleBtn.addEventListener('click', () => {
            isEditing = !isEditing;
            if (isEditing) {
                preview.style.display = 'none';
                textarea.style.display = 'block';
                toggleBtn.textContent = 'Preview';
                textarea.focus();
            } else {
                preview.style.display = 'block';
                textarea.style.display = 'none';
                toggleBtn.textContent = 'Edit HTML';
                preview.innerHTML = textarea.value || '<p style="color: #666;">Empty HTML block</p>';
            }
        });

        // Auto-resize and update
        EditUtils.setupAutoResizeTextarea(textarea, (value) => {
            blocks[index].html = value;
            markDirty();
        });

        return wrapper;
    }

    // ========== MERGE DIVIDER & ADD BLOCK ==========

    /**
     * Create divider between blocks with add button
     * @param {number} afterIndex - Index of block after which this divider appears
     * @returns {HTMLElement}
     */
    function createMergeDivider(afterIndex) {
        const divider = document.createElement('div');
        divider.className = 'merge-divider';
        divider.dataset.afterIndex = afterIndex;

        // Add block button (centered)
        const addBtn = document.createElement('button');
        addBtn.className = 'merge-add-btn';
        addBtn.innerHTML = '+';
        addBtn.title = 'Add block';
        addBtn.addEventListener('click', (e) => {
            const rect = addBtn.getBoundingClientRect();
            EditSlash.showFromButton(rect, afterIndex, addBtn);
        });
        divider.appendChild(addBtn);

        return divider;
    }

    /**
     * Create final "+" button to add a block at the end
     * @param {number} insertIndex - Index where new block will be inserted
     * @returns {HTMLElement}
     */
    function createAddBlockButton(insertIndex) {
        const wrapper = document.createElement('div');
        wrapper.className = 'add-block-wrapper';

        const btn = document.createElement('button');
        btn.className = 'merge-add-btn';
        btn.innerHTML = '+';
        btn.title = 'Add block';
        btn.addEventListener('click', (e) => {
            const rect = btn.getBoundingClientRect();
            EditSlash.showFromButton(rect, insertIndex, btn);
        });
        wrapper.appendChild(btn);

        return wrapper;
    }

    /**
     * Create upload zone for image/video blocks
     * @param {number} index - Block index
     * @param {string} type - 'image' or 'video'
     * @returns {HTMLElement}
     */
    function createUploadZone(index, type) {
        const zone = document.createElement('div');
        zone.className = 'upload-zone';
        zone.innerHTML = `
            <div class="upload-icon">${type === 'image' ? '🖼' : '🎬'}</div>
            <div class="upload-text">Drop ${type} here or click to upload</div>
            <input type="file" class="upload-input" accept="${type === 'image' ? 'image/*' : 'video/*'}">
        `;

        const input = zone.querySelector('.upload-input');
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (type === 'image') {
                    await EditMedia.handleImageUploadForBlock(file, index);
                } else {
                    await EditMedia.handleVideoUploadForBlock(file, index);
                }
            }
        });

        zone.addEventListener('click', (e) => {
            if (e.target !== input) input.click();
        });

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', async (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) {
                if (type === 'image') {
                    await EditMedia.handleImageUploadForBlock(file, index);
                } else {
                    await EditMedia.handleVideoUploadForBlock(file, index);
                }
            }
        });

        return zone;
    }

    // ========== DRAG & DROP ==========

    /**
     * Handle drag start
     */
    function handleDragStart(e, index) {
        dragState.sourceIndex = index;
        dragState.isDragging = true;

        const wrapper = container.querySelector(`[data-block-index="${index}"]`);
        if (wrapper) {
            wrapper.classList.add('dragging');
        }

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
    }

    /**
     * Handle drag end
     */
    function handleDragEnd(e) {
        dragState.isDragging = false;
        dragState.sourceIndex = null;
        dragState.currentDropIndex = null;

        // Remove all drag classes
        container.querySelectorAll('.dragging, .drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
        });
    }

    /**
     * Handle drag over
     */
    function handleDragOver(e, index) {
        e.preventDefault();
        if (!dragState.isDragging) return;

        const wrapper = e.currentTarget;
        const rect = wrapper.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        // Remove previous drag-over classes
        container.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // Add appropriate class based on mouse position
        if (e.clientY < midpoint) {
            wrapper.classList.add('drag-over-top');
            dragState.currentDropIndex = index;
        } else {
            wrapper.classList.add('drag-over-bottom');
            dragState.currentDropIndex = index + 1;
        }
    }

    /**
     * Handle drag leave
     */
    function handleDragLeave(e) {
        e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
    }

    /**
     * Handle drop
     */
    function handleDrop(e, index) {
        e.preventDefault();
        if (!dragState.isDragging || dragState.sourceIndex === null) return;

        const fromIndex = dragState.sourceIndex;
        let toIndex = dragState.currentDropIndex;

        if (toIndex === null) return;

        // Adjust for moving down
        if (fromIndex < toIndex) {
            toIndex--;
        }

        if (fromIndex !== toIndex) {
            // Move block
            const [movedBlock] = blocks.splice(fromIndex, 1);
            blocks.splice(toIndex, 0, movedBlock);
            markDirty();
            renderBlocks();
        }

        handleDragEnd(e);
    }

    // ========== BLOCK OPERATIONS ==========

    /**
     * Insert a new block at the specified index
     * @param {number} index - Where to insert
     * @param {string} type - Block type
     */
    function insertBlock(index, type) {
        const newBlock = EditBlocks.createBlock(type);

        blocks.splice(index, 0, newBlock);
        markDirty();
        renderBlocks();

        // Focus the new block if it's a text block
        if (type === 'text' || type === 'callout') {
            setTimeout(() => {
                const textarea = container.querySelector(
                    `[data-block-index="${index}"] .text-line-input, ` +
                    `[data-block-index="${index}"] .block-textarea, ` +
                    `[data-block-index="${index}"] .callout-textarea`
                );
                if (textarea) textarea.focus();
            }, 50);
        }
    }

    /**
     * Insert block after the specified index
     * @param {string} blockId - Block ID to insert after
     * @param {string} type - Block type
     */
    function insertBlockAfter(blockId, type) {
        const index = blocks.findIndex(b => b.id === blockId);
        if (index !== -1) {
            insertBlock(index + 1, type);
        }
    }

    /**
     * Delete a block
     * @param {number} index - Block index
     */
    function deleteBlock(index) {
        if (blocks.length <= 1) {
            // Don't delete the last block, just clear it
            blocks[0] = EditBlocks.createBlock('text');
        } else {
            blocks.splice(index, 1);
        }
        markDirty();
        renderBlocks();
    }

    // ========== SLASH COMMAND HANDLER ==========

    /**
     * Handle slash command execution
     * @param {string} action - 'execute' or 'updateContent'
     * @param {object} data - Command data
     */
    function handleSlashCommand(action, data) {
        if (action === 'execute') {
            if (data.replaceBlockIndex != null) {
                // Source text block became empty after removing "/"—replace it
                const focusIndex = data.replaceBlockIndex;
                blocks[focusIndex] = EditBlocks.createBlock(data.commandId);
                markDirty();
                renderBlocks();
                // Focus the replacement block if applicable
                if (data.commandId === 'text' || data.commandId === 'callout') {
                    setTimeout(() => {
                        const textarea = container.querySelector(
                            `[data-block-index="${focusIndex}"] .text-line-input, ` +
                            `[data-block-index="${focusIndex}"] .block-textarea, ` +
                            `[data-block-index="${focusIndex}"] .callout-textarea`
                        );
                        if (textarea) textarea.focus();
                    }, 50);
                }
            } else {
                insertBlock(data.insertIndex, data.commandId);
            }
        } else if (action === 'updateContent') {
            blocks[data.index].content = data.content;
            // Don't re-render for content updates during slash command
        }
    }

    // ========== KEYBOARD HANDLER ==========

    /**
     * Global keyboard handler
     */
    function handleGlobalKeydown(e) {
        if (!isActive) return;

        // Forward to slash menu if active (handles Esc, arrows, Enter)
        if (EditSlash.isActive()) {
            if (EditSlash.handleKeydown(e)) return;
        }

        // Cmd/Ctrl + S - Save
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            handleSave();
        }

        // Escape - Cancel edit mode
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            handleCancel();
        }
    }

    // ========== SAVE/CANCEL ==========

    /**
     * Mark content as dirty (unsaved changes) and schedule auto-save
     */
    function markDirty() {
        isDirty = true;
        setSaveState(SaveState.PENDING);
        scheduleAutoSave();
    }

    /**
     * Handle manual save (Cmd+S or button click)
     */
    async function handleSave() {
        // If no changes, just exit edit mode
        if (!isDirty && saveState !== SaveState.ERROR) {
            cleanup();
            window.location.reload();
            return;
        }

        // Cancel pending auto-save timer
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }

        // Cancel retry timer
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        // Cancel in-flight request
        if (abortController) {
            abortController.abort();
        }

        setSaveState(SaveState.SAVING);

        try {
            const markdown = EditBlocks.blocksToMarkdown(blocks);

            let response;
            if (editMode === 'about') {
                // Save about page
                response = await fetch('/api/save-about', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ markdown })
                });
            } else {
                // Save project - preserve all existing metadata
                const saveData = {
                    slug: projectSlug,
                    name: projectData.name,
                    date: projectData.date,
                    pinned: projectData.pinned,
                    draft: projectData.draft,
                    youtube: projectData.youtube,
                    video: projectData.video,
                    markdown: markdown
                };

                response = await fetch('/api/save-project', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(saveData)
                });
            }

            if (!response.ok) {
                throw new Error(`Save failed: ${response.status}`);
            }

            isDirty = false;
            setSaveState(SaveState.SAVED);

            // Exit edit mode and reload after manual save
            cleanup();
            window.location.reload();

        } catch (error) {
            console.error('Save error:', error);
            setSaveState(SaveState.ERROR);
            EditUtils.showNotification('Failed to save', 'error');
        }
    }

    /**
     * Handle cancel
     */
    function handleCancel() {
        if (isDirty) {
            if (!confirm('You have unsaved changes. Discard them?')) {
                return;
            }
        }
        cleanup();
        // Reload the page to exit edit mode
        window.location.reload();
    }

    // ========== UPDATE BLOCK ==========

    /**
     * Update a block's data (used by EditMedia)
     * @param {number} index - Block index
     * @param {object} updates - Properties to update
     */
    function updateBlock(index, updates) {
        if (blocks[index]) {
            Object.assign(blocks[index], updates);
            markDirty();
            renderBlocks();
        }
    }

    // ========== PUBLIC API ==========

    return {
        // Initialization
        init,
        initAbout,
        cleanup,

        // State
        get blocks() { return blocks; },
        get isActive() { return isActive; },
        get isDirty() { return isDirty; },
        get projectSlug() { return projectSlug; },
        get editMode() { return editMode; },

        // Block operations
        insertBlock,
        insertBlockAfter,
        deleteBlock,
        updateBlock,
        renderBlocks,
        markDirty,

        // Save/Cancel
        save: handleSave,
        cancel: handleCancel
    };
})();


/**
 * Project Creation Modal
 */
window.ProjectCreate = {
    modal: null,

    /**
     * Show create project modal
     */
    show() {
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
        const nameInput = this.modal.querySelector('#project-name');
        const slugInput = this.modal.querySelector('#project-slug');
        nameInput.addEventListener('input', () => {
            slugInput.value = this.generateSlug(nameInput.value);
        });

        // Focus name input
        nameInput.focus();
    },

    /**
     * Generate slug from name
     */
    generateSlug(name) {
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
    setupEventListeners() {
        // Close button
        this.modal.querySelector('.edit-create-close').addEventListener('click', () => {
            this.hide();
        });

        // Overlay click
        this.modal.querySelector('.edit-create-overlay').addEventListener('click', () => {
            this.hide();
        });

        // Cancel button
        this.modal.querySelector('#create-cancel').addEventListener('click', () => {
            this.hide();
        });

        // Form submit
        this.modal.querySelector('#create-project-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createProject();
        });

        // Escape key
        const escHandler = (e) => {
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
    async createProject() {
        const form = this.modal.querySelector('#create-project-form');
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
            const response = await EditUtils.fetchJSON('/api/create-project', {
                method: 'POST',
                body: JSON.stringify(data),
            });

            EditUtils.showNotification('Project created!', 'success');
            this.hide();

            // Navigate to the new project
            window.location.href = EditUtils.withShowDrafts(`/${data.slug}`);
        } catch (error) {
            console.error('Create project error:', error);
            EditUtils.showNotification('Failed to create project', 'error');
        }
    },

    /**
     * Hide modal
     */
    hide() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        document.body.classList.remove('modal-open');
    },
};


/**
 * Project Settings Modal
 * Includes integrated hero video upload view (no separate modal)
 */
window.ProjectSettings = {
    modal: null,
    projectSlug: null,
    projectData: null,

    // Video view state
    currentView: 'settings', // 'settings' or 'video'
    videoFile: null,
    spriteStart: 0,
    spriteDuration: 3,
    objectUrl: null,
    activeXhr: null,
    videoEl: null,
    videoDuration: 0,
    _isDraggingSprite: false,
    _dragStartX: 0,
    _dragStartTime: 0,
    _mouseMoveHandler: null,
    _mouseUpHandler: null,
    _keyHandler: null,
    _beforeUnloadHandler: null,
    _pollTimer: null,
    _spriteLooping: false,
    _thumbVideo: null,
    _thumbCanvas: null,

    /**
     * Show settings modal for a project
     */
    async show(slug) {
        this.projectSlug = slug;

        try {
            this.projectData = await EditUtils.fetchJSON(`/api/project/${slug}`);
            this.createModal();
        } catch (error) {
            console.error('Failed to load project:', error);
            EditUtils.showNotification('Failed to load project settings', 'error');
        }
    },

    /**
     * Create the modal
     */
    createModal() {
        this.currentView = 'settings';
        this.modal = document.createElement('div');
        this.modal.className = 'edit-settings-modal';
        this.modal.innerHTML = `
            <div class="edit-settings-overlay"></div>
            <div class="edit-settings-content"></div>
        `;

        document.body.appendChild(this.modal);
        document.body.classList.add('modal-open');

        this.renderSettingsView();
        this.setupBaseListeners();
    },

    /**
     * Setup base listeners (overlay, escape)
     */
    setupBaseListeners() {
        // Overlay click
        this.modal.querySelector('.edit-settings-overlay').addEventListener('click', () => {
            if (this.currentView === 'video') {
                this.showSettingsView();
            } else {
                this.hide();
            }
        });

        // Escape key
        this.escHandler = (e) => {
            if (e.key === 'Escape' && this.modal) {
                e.preventDefault();
                e.stopPropagation();
                if (this.currentView === 'video') {
                    this.cancelUpload();
                } else {
                    this.hide();
                }
            }
        };
        document.addEventListener('keydown', this.escHandler, true);
    },

    /**
     * Render the settings form view
     */
    renderSettingsView() {
        this.currentView = 'settings';
        const data = this.projectData;
        const content = this.modal.querySelector('.edit-settings-content');

        // Remove video class
        content.classList.remove('edit-settings-content--video');

        content.innerHTML = `
            <div class="edit-settings-header">
                <h2>Project Settings</h2>
                <button class="edit-settings-close">&times;</button>
            </div>
            <form class="edit-settings-form" id="settings-form">
                <div class="edit-form-group">
                    <label for="settings-name">Project Name</label>
                    <input type="text" id="settings-name" name="name" value="${this.escAttr(data.name || '')}" required>
                </div>
                <div class="edit-form-group">
                    <label for="settings-slug">URL Slug</label>
                    <input type="text" id="settings-slug" name="slug" value="${this.escAttr(data.slug || '')}" required pattern="[a-z0-9\\-]+">
                </div>
                <div class="edit-form-group">
                    <label for="settings-date">Date</label>
                    <input type="date" id="settings-date" name="date" value="${data.date || ''}" required>
                </div>
                <div class="edit-form-group">
                    <label for="settings-youtube">YouTube Link</label>
                    <input type="url" id="settings-youtube" name="youtube" value="${this.escAttr(data.youtube || '')}" placeholder="https://youtube.com/watch?v=...">
                </div>
                <div class="edit-form-row">
                    <div class="edit-form-group edit-form-checkbox">
                        <label>
                            <input type="checkbox" id="settings-draft" name="draft" ${data.draft ? 'checked' : ''}>
                            Draft
                        </label>
                    </div>
                    <div class="edit-form-group edit-form-checkbox">
                        <label>
                            <input type="checkbox" id="settings-pinned" name="pinned" ${data.pinned ? 'checked' : ''}>
                            Pinned
                        </label>
                    </div>
                </div>

                <div class="edit-form-section">
                    <h3>Hero Video</h3>
                    <div class="edit-form-group">
                        <label>Current Video</label>
                        ${data.video?.hls
                            ? `<div class="edit-video-info">
                                <span>HLS: ${data.video.hls.split('/').pop()}</span>
                                <button type="button" class="edit-btn-small" id="upload-hero-video">Replace</button>
                               </div>`
                            : `<button type="button" class="edit-btn edit-btn-secondary" id="upload-hero-video">Upload Hero Video</button>`
                        }
                        <input type="file" id="hero-video-input" accept="video/*" style="display: none;">
                    </div>
                </div>

                <div class="edit-settings-actions">
                    <button type="button" class="edit-btn edit-btn-danger" id="delete-project">Delete Project</button>
                    <div class="edit-settings-actions-right">
                        <button type="button" class="edit-btn edit-btn-secondary" id="settings-cancel">Cancel</button>
                        <button type="submit" class="edit-btn edit-btn-primary">Save Settings</button>
                    </div>
                </div>
            </form>
        `;

        this.setupSettingsListeners();
    },

    /**
     * Setup settings-specific listeners
     */
    setupSettingsListeners() {
        const content = this.modal.querySelector('.edit-settings-content');

        content.querySelector('.edit-settings-close').addEventListener('click', () => this.hide());
        content.querySelector('#settings-cancel').addEventListener('click', () => this.hide());

        content.querySelector('#settings-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveSettings();
        });

        content.querySelector('#delete-project').addEventListener('click', async () => {
            if (confirm(`Are you sure you want to delete "${this.projectData.name}"? This cannot be undone.`)) {
                await this.deleteProject();
            }
        });

        // Hero video upload
        const uploadBtn = content.querySelector('#upload-hero-video');
        const fileInput = content.querySelector('#hero-video-input');

        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => fileInput.click());
        }

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                if (!file.type.startsWith('video/')) {
                    EditUtils.showNotification('Please select a video file', 'error');
                    return;
                }
                this.showVideoView(file);
            }
        });
    },

    /**
     * Show the video processing view (replaces settings form in-place)
     */
    showVideoView(file) {
        this.currentView = 'video';
        this.videoFile = file;
        this.spriteStart = 0;
        this.videoDuration = 0;
        this._spriteLooping = false;

        const content = this.modal.querySelector('.edit-settings-content');
        content.classList.add('edit-settings-content--video');

        const fileSize = (file.size / (1024 * 1024)).toFixed(1);

        content.innerHTML = `
            <div class="edit-settings-header">
                <h2>Process Hero Video</h2>
                <button class="edit-settings-close">&times;</button>
            </div>
            <div class="edit-hero-video-preview">
                <video class="edit-hero-video-player" controls playsinline></video>
            </div>
            <div class="edit-hero-file-info">${this.escHtml(file.name)} (${fileSize} MB)</div>
            <div class="edit-hero-timeline">
                <div class="edit-hero-timeline-track">
                    <canvas class="edit-hero-timeline-thumbs"></canvas>
                    <div class="edit-hero-timeline-dim-left"></div>
                    <div class="edit-hero-timeline-dim-right"></div>
                    <div class="edit-hero-sprite-range"></div>
                    <div class="edit-hero-playhead"></div>
                </div>
            </div>
            <div class="edit-hero-time-display">
                <span class="edit-hero-current-time">0:00</span>
                <span class="edit-hero-sprite-info">Sprite: 0:00 - 0:03</span>
                <span class="edit-hero-total-time">0:00</span>
            </div>
            <div class="edit-hero-progress" style="display: none;">
                <div class="edit-hero-progress-bar">
                    <div class="edit-hero-progress-fill"></div>
                </div>
                <div class="edit-hero-progress-text">Uploading...</div>
            </div>
            <div class="edit-hero-actions">
                <button type="button" class="edit-btn edit-btn-secondary" id="hero-video-cancel">Cancel</button>
                <button type="button" class="edit-btn edit-btn-primary" id="hero-video-process">Upload & Process</button>
            </div>
        `;

        // Close goes back to settings
        content.querySelector('.edit-settings-close').addEventListener('click', () => this.cancelUpload());

        // Action buttons
        content.querySelector('#hero-video-cancel').addEventListener('click', () => this.cancelUpload());
        content.querySelector('#hero-video-process').addEventListener('click', () => this.processVideo());

        // Load video preview
        this.objectUrl = URL.createObjectURL(file);
        this.videoEl = content.querySelector('.edit-hero-video-player');
        this.videoEl.src = this.objectUrl;

        this.videoEl.addEventListener('loadedmetadata', () => {
            this.videoDuration = this.videoEl.duration;
            content.querySelector('.edit-hero-total-time').textContent = this.formatTime(this.videoDuration);
            this.updateSpriteRange();

            // Check if browser can decode the video track (e.g. ProRes/HEVC .mov files)
            if (this.videoEl.videoWidth === 0) {
                this._noVideoTrack = true;
                const preview = content.querySelector('.edit-hero-video-preview');
                preview.innerHTML = '<div class="edit-hero-no-preview">Preview unavailable for this codec. Sprite selection and processing will still work.</div>';
            } else {
                this._noVideoTrack = false;
                this.generateTimelineThumbnails();
            }
        });

        this.videoEl.addEventListener('timeupdate', () => {
            this.updatePlayhead();
            content.querySelector('.edit-hero-current-time').textContent = this.formatTime(this.videoEl.currentTime);

            // Sprite loop: wrap back to start when reaching end of sprite range
            if (this._spriteLooping && this.videoEl.currentTime >= this.spriteStart + this.spriteDuration) {
                this.videoEl.currentTime = this.spriteStart;
            }
        });

        // Timeline click — click on sprite range to loop, outside to seek freely
        const track = content.querySelector('.edit-hero-timeline-track');
        track.addEventListener('click', (e) => {
            if (this._isDraggingSprite) return;
            const rect = track.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const time = pct * this.videoDuration;

            // Check if click landed inside the sprite range
            const spriteEnd = this.spriteStart + this.spriteDuration;
            if (time >= this.spriteStart && time <= spriteEnd) {
                // Activate sprite loop and play from clicked position within range
                this._spriteLooping = true;
                this.videoEl.currentTime = time;
                this.videoEl.play();
            } else {
                // Click outside sprite range: move sprite position, disable loop
                this._spriteLooping = false;
                this.spriteStart = Math.max(0, Math.min(time, this.videoDuration - this.spriteDuration));
                this.videoEl.currentTime = this.spriteStart;
                this.updateSpriteRange();
            }
            this.updateSpriteLoopUI();
        });

        // Sprite range drag
        const spriteRange = content.querySelector('.edit-hero-sprite-range');
        spriteRange.addEventListener('mousedown', (e) => {
            this._isDraggingSprite = true;
            this._dragStartX = e.clientX;
            this._dragStartTime = this.spriteStart;
            e.preventDefault();
            e.stopPropagation();
        });

        // Double-click sprite range to toggle loop playback
        spriteRange.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._spriteLooping = !this._spriteLooping;
            if (this._spriteLooping) {
                this.videoEl.currentTime = this.spriteStart;
                this.videoEl.play();
            }
            this.updateSpriteLoopUI();
        });

        this._mouseMoveHandler = (e) => {
            if (!this._isDraggingSprite) return;
            const rect = this.modal.querySelector('.edit-hero-timeline-track').getBoundingClientRect();
            const dx = e.clientX - this._dragStartX;
            const dt = (dx / rect.width) * this.videoDuration;
            this.spriteStart = Math.max(0, Math.min(this._dragStartTime + dt, this.videoDuration - this.spriteDuration));
            this.videoEl.currentTime = this.spriteStart;
            this.updateSpriteRange();
        };
        document.addEventListener('mousemove', this._mouseMoveHandler);

        this._mouseUpHandler = () => {
            this._isDraggingSprite = false;
        };
        document.addEventListener('mouseup', this._mouseUpHandler);

        // Arrow key adjustment
        this._keyHandler = (e) => {
            if (this.currentView !== 'video' || !this.modal) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.spriteStart = Math.max(0, this.spriteStart - 0.5);
                this.videoEl.currentTime = this.spriteStart;
                this.updateSpriteRange();
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.spriteStart = Math.min(this.videoDuration - this.spriteDuration, this.spriteStart + 0.5);
                this.videoEl.currentTime = this.spriteStart;
                this.updateSpriteRange();
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    /**
     * Generate thumbnail filmstrip for the timeline track.
     * Uses a hidden video element + canvas to extract frames without
     * interfering with the user's playback.
     */
    generateTimelineThumbnails() {
        const canvas = this.modal.querySelector('.edit-hero-timeline-thumbs');
        if (!canvas) return;

        const track = canvas.parentElement;
        const trackWidth = track.clientWidth;
        const trackHeight = track.clientHeight;

        // Size canvas to match track at device pixel ratio for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        canvas.width = trackWidth * dpr;
        canvas.height = trackHeight * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // Determine how many thumbnails to generate (~1 per 20px)
        const numThumbs = Math.min(Math.max(Math.floor(trackWidth / 20), 10), 60);
        const sliceWidth = trackWidth / numThumbs;

        // Create a hidden video for seeking without disturbing playback
        const thumbVid = document.createElement('video');
        thumbVid.muted = true;
        thumbVid.preload = 'auto';
        thumbVid.src = this.objectUrl;
        this._thumbVideo = thumbVid;
        this._thumbCanvas = canvas;

        let current = 0;

        const drawNext = () => {
            if (current >= numThumbs || !this._thumbVideo) {
                // All frames drawn
                canvas.classList.add('loaded');
                if (this._thumbVideo) {
                    this._thumbVideo.src = '';
                    this._thumbVideo = null;
                }
                return;
            }

            const time = (current + 0.5) / numThumbs * this.videoDuration;
            thumbVid.currentTime = time;
        };

        thumbVid.addEventListener('seeked', () => {
            if (!this._thumbVideo) return;
            const x = current * sliceWidth;
            // Draw the video frame scaled to fill the slice height, cropped to slice width
            const vw = thumbVid.videoWidth || 1;
            const vh = thumbVid.videoHeight || 1;
            const aspect = vw / vh;
            const drawHeight = trackHeight;
            const drawWidth = drawHeight * aspect;
            const offsetX = x + (sliceWidth - drawWidth) / 2;
            // Clip to this slice
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, 0, sliceWidth, trackHeight);
            ctx.clip();
            ctx.drawImage(thumbVid, offsetX, 0, drawWidth, drawHeight);
            ctx.restore();
            current++;
            // Use requestAnimationFrame to avoid blocking
            requestAnimationFrame(drawNext);
        });

        // Start once video is ready
        thumbVid.addEventListener('loadeddata', () => {
            drawNext();
        }, { once: true });
    },

    /**
     * Update the sprite loop UI indicator
     */
    updateSpriteLoopUI() {
        if (!this.modal) return;
        const info = this.modal.querySelector('.edit-hero-sprite-info');
        if (!info) return;
        if (this._spriteLooping) {
            info.classList.add('looping');
        } else {
            info.classList.remove('looping');
        }
    },

    /**
     * Restore the settings form view, cleaning up video state
     */
    showSettingsView() {
        this.cleanupVideoState();
        this.renderSettingsView();
    },

    /**
     * Clean up video-related state and listeners
     */
    cleanupVideoState() {
        if (this._thumbVideo) {
            this._thumbVideo.src = '';
            this._thumbVideo = null;
        }
        this._thumbCanvas = null;
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
        if (this._mouseMoveHandler) {
            document.removeEventListener('mousemove', this._mouseMoveHandler);
            this._mouseMoveHandler = null;
        }
        if (this._mouseUpHandler) {
            document.removeEventListener('mouseup', this._mouseUpHandler);
            this._mouseUpHandler = null;
        }
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        if (this._beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this._beforeUnloadHandler);
            this._beforeUnloadHandler = null;
        }
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this.videoEl = null;
        this.videoFile = null;
        this._isDraggingSprite = false;
        this._spriteLooping = false;
        this._noVideoTrack = false;
    },

    /**
     * Update the sprite range indicator and dim overlays on the timeline
     */
    updateSpriteRange() {
        if (!this.modal || !this.videoDuration) return;
        const range = this.modal.querySelector('.edit-hero-sprite-range');
        const info = this.modal.querySelector('.edit-hero-sprite-info');
        const dimLeft = this.modal.querySelector('.edit-hero-timeline-dim-left');
        const dimRight = this.modal.querySelector('.edit-hero-timeline-dim-right');
        if (!range) return;

        const startPct = (this.spriteStart / this.videoDuration) * 100;
        const widthPct = (this.spriteDuration / this.videoDuration) * 100;
        range.style.left = `${startPct}%`;
        range.style.width = `${widthPct}%`;

        // Position dim overlays
        if (dimLeft) {
            dimLeft.style.width = `${startPct}%`;
        }
        if (dimRight) {
            dimRight.style.left = `${startPct + widthPct}%`;
            dimRight.style.width = `${100 - startPct - widthPct}%`;
        }

        if (info) {
            const end = this.spriteStart + this.spriteDuration;
            info.textContent = `Sprite: ${this.formatTime(this.spriteStart)} - ${this.formatTime(end)}`;
        }
    },

    /**
     * Update the playhead position on the timeline
     */
    updatePlayhead() {
        if (!this.modal || !this.videoEl || !this.videoDuration) return;
        const playhead = this.modal.querySelector('.edit-hero-playhead');
        if (!playhead) return;
        const pct = (this.videoEl.currentTime / this.videoDuration) * 100;
        playhead.style.left = `${pct}%`;
    },

    /**
     * Upload and process the video using XHR for progress tracking
     */
    processVideo() {
        const processBtn = this.modal.querySelector('#hero-video-process');
        const cancelBtn = this.modal.querySelector('#hero-video-cancel');
        const progressDiv = this.modal.querySelector('.edit-hero-progress');
        const progressFill = this.modal.querySelector('.edit-hero-progress-fill');
        const progressText = this.modal.querySelector('.edit-hero-progress-text');

        processBtn.disabled = true;
        processBtn.textContent = 'Uploading...';
        progressDiv.style.display = 'block';

        // beforeunload warning
        this._beforeUnloadHandler = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', this._beforeUnloadHandler);

        const formData = new FormData();
        formData.append('file', this.videoFile);
        formData.append('project_slug', this.projectSlug);
        formData.append('sprite_start', this.spriteStart);
        formData.append('sprite_duration', this.spriteDuration);

        const xhr = new XMLHttpRequest();
        this.activeXhr = xhr;

        // Upload progress: 0-40%
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const pct = (e.loaded / e.total) * 40;
                progressFill.style.width = `${pct}%`;
                const mb = (e.loaded / (1024 * 1024)).toFixed(1);
                const totalMb = (e.total / (1024 * 1024)).toFixed(1);
                progressText.textContent = `Uploading: ${mb} / ${totalMb} MB`;
            }
        });

        xhr.addEventListener('load', () => {
            this.activeXhr = null;
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const result = JSON.parse(xhr.responseText);
                    if (result.success) {
                        // Upload done, now poll for processing progress
                        progressFill.style.width = '40%';
                        progressText.textContent = 'Processing on server...';
                        this.pollProcessingProgress(progressFill, progressText, cancelBtn, processBtn);
                    } else {
                        throw new Error(result.detail || 'Processing failed');
                    }
                } catch (e) {
                    this.handleProcessingError(e.message, processBtn, progressDiv);
                }
            } else {
                let msg = 'Upload failed';
                try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (_) {}
                this.handleProcessingError(msg, processBtn, progressDiv);
            }
        });

        xhr.addEventListener('error', () => {
            this.activeXhr = null;
            this.handleProcessingError('Network error during upload', processBtn, progressDiv);
        });

        xhr.addEventListener('abort', () => {
            this.activeXhr = null;
        });

        xhr.open('POST', '/api/process-hero-video');
        xhr.send(formData);
    },

    /**
     * Poll the server for processing progress after upload completes
     */
    pollProcessingProgress(progressFill, progressText, cancelBtn, processBtn) {
        this._pollTimer = setInterval(async () => {
            try {
                const res = await fetch(`/api/process-hero-video/progress/${this.projectSlug}`);
                if (!res.ok) return;

                const data = await res.json();
                const pct = 40 + (data.progress || 0) * 0.6; // 40-100%
                progressFill.style.width = `${pct}%`;
                progressText.textContent = data.stage || 'Processing...';

                if (data.status === 'complete') {
                    clearInterval(this._pollTimer);
                    this._pollTimer = null;
                    progressFill.style.width = '100%';
                    progressText.textContent = 'Complete!';

                    // Update project data with new video info
                    if (data.video) {
                        this.projectData.video = data.video;
                        await this.saveVideoData(data.video);
                    }

                    EditUtils.showNotification('Video processed successfully!', 'success');

                    // Return to settings view after a brief pause
                    setTimeout(() => this.showSettingsView(), 800);
                }

                if (data.status === 'error') {
                    clearInterval(this._pollTimer);
                    this._pollTimer = null;
                    this.handleProcessingError(data.error || 'Processing failed', processBtn, progressFill.closest('.edit-hero-progress'));
                }
            } catch (_) {
                // Polling error, keep trying
            }
        }, 1000);
    },

    /**
     * Handle a processing error
     */
    handleProcessingError(message, processBtn, progressDiv) {
        if (this._beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this._beforeUnloadHandler);
            this._beforeUnloadHandler = null;
        }
        EditUtils.showNotification(`Video processing failed: ${message}`, 'error');
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.textContent = 'Upload & Process';
        }
        if (progressDiv) {
            progressDiv.style.display = 'none';
        }
    },

    /**
     * Cancel upload or return to settings from video view
     */
    cancelUpload() {
        if (this.activeXhr) {
            this.activeXhr.abort();
            this.activeXhr = null;
        }
        if (this._pollTimer) {
            // Server processing continues in background, just stop polling
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this.showSettingsView();
    },

    /**
     * Format time as M:SS
     */
    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    },

    /**
     * Escape HTML attribute value
     */
    escAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    /**
     * Escape HTML text content
     */
    escHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    /**
     * Save settings
     */
    async saveSettings() {
        const form = this.modal.querySelector('#settings-form');
        const formData = new FormData(form);

        const data = {
            name: formData.get('name'),
            slug: formData.get('slug'),
            date: formData.get('date'),
            youtube: formData.get('youtube') || null,
            draft: formData.get('draft') === 'on',
            pinned: formData.get('pinned') === 'on',
            video: this.projectData.video,
            markdown: this.projectData.markdown,
        };

        try {
            await EditUtils.fetchJSON('/api/save-project', {
                method: 'POST',
                body: JSON.stringify(data),
            });

            EditUtils.showNotification('Settings saved!', 'success');

            // If slug changed, redirect
            if (data.slug !== this.projectSlug) {
                window.location.href = EditUtils.withShowDrafts(`/${data.slug}`);
            } else {
                this.hide();
                window.location.reload();
            }
        } catch (error) {
            console.error('Save settings error:', error);
            EditUtils.showNotification('Failed to save settings', 'error');
        }
    },

    /**
     * Save video data only
     */
    async saveVideoData(videoData) {
        const data = {
            ...this.projectData,
            video: videoData,
        };

        try {
            await EditUtils.fetchJSON('/api/save-project', {
                method: 'POST',
                body: JSON.stringify(data),
            });
        } catch (error) {
            console.error('Save video data error:', error);
        }
    },

    /**
     * Delete project
     */
    async deleteProject() {
        try {
            await EditUtils.fetchJSON(`/api/project/${this.projectSlug}`, {
                method: 'DELETE',
            });

            EditUtils.showNotification('Project deleted', 'success');
            this.hide();
            window.location.href = EditUtils.withShowDrafts('/');
        } catch (error) {
            console.error('Delete project error:', error);
            EditUtils.showNotification('Failed to delete project', 'error');
        }
    },

    /**
     * Hide modal
     */
    hide() {
        this.cleanupVideoState();
        if (this.escHandler) {
            document.removeEventListener('keydown', this.escHandler, true);
            this.escHandler = null;
        }
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        document.body.classList.remove('modal-open');
    },
};
