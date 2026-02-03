/**
 * Edit Slash Command Module
 * Handles slash command menu for inserting blocks
 * Ported from GrowthLab with adaptations for billybjork.com
 */
window.EditSlash = (function() {
    'use strict';

    // ========== CONFIGURATION ==========

    const CONFIG = {
        MENU_WIDTH: 240
    };

    const COMMANDS = [
        { id: 'text', label: 'Text', icon: 'T', description: 'Plain text paragraph' },
        { id: 'image', label: 'Image', icon: '🖼', description: 'Upload or select an image' },
        { id: 'video', label: 'Video', icon: '🎬', description: 'Upload a video file' },
        { id: 'code', label: 'Code', icon: '💻', description: 'Code block with syntax highlighting' },
        { id: 'html', label: 'HTML', icon: '<>', description: 'Raw HTML (scripts, embeds, custom)' },
        { id: 'callout', label: 'Callout', icon: '📌', description: 'Highlighted message box' },
        { id: 'divider', label: 'Divider', icon: '⁂', description: 'Section break' }
    ];

    // ========== STATE ==========

    let menuElement = null;
    let isActive = false;
    let triggeredFromTextarea = false;
    let query = '';
    let selectedIndex = 0;
    let onExecuteCallback = null;
    let activeTextareaIndex = null;
    let anchorElement = null;
    let scrollHandler = null;
    let clickOutsideHandler = null;

    // ========== MENU CREATION ==========

    /**
     * Create the slash command menu element if it doesn't exist
     * @returns {HTMLElement}
     */
    function createMenu() {
        if (menuElement) return menuElement;

        const menu = document.createElement('div');
        menu.className = 'slash-command-menu';
        menu.style.display = 'none';
        document.body.appendChild(menu);
        menuElement = menu;
        return menu;
    }

    /**
     * Position menu relative to an anchor element
     * Handles viewport overflow by positioning above if needed
     * @param {DOMRect} anchorRect
     */
    function positionMenu(anchorRect) {
        if (!menuElement) return;

        menuElement.style.display = 'block';
        menuElement.style.width = `${CONFIG.MENU_WIDTH}px`;
        menuElement.style.left = `${Math.min(anchorRect.left, window.innerWidth - CONFIG.MENU_WIDTH - 20)}px`;

        const menuHeight = menuElement.offsetHeight || 200;
        const spaceBelow = window.innerHeight - anchorRect.bottom - 10;
        const spaceAbove = anchorRect.top - 10;

        if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
            menuElement.style.top = 'auto';
            menuElement.style.bottom = `${window.innerHeight - anchorRect.top + 5}px`;
            menuElement.style.maxHeight = `${Math.min(300, spaceAbove)}px`;
        } else {
            menuElement.style.top = `${anchorRect.bottom + 5}px`;
            menuElement.style.bottom = 'auto';
            menuElement.style.maxHeight = `${Math.min(300, spaceBelow)}px`;
        }
    }

    // ========== FILTERING ==========

    /**
     * Filter commands based on query string
     * @param {string} queryStr
     * @returns {Array}
     */
    function getFilteredCommands(queryStr) {
        if (!queryStr) return COMMANDS;
        const lowerQuery = queryStr.toLowerCase();
        return COMMANDS.filter(cmd =>
            cmd.label.toLowerCase().includes(lowerQuery) ||
            cmd.id.toLowerCase().includes(lowerQuery) ||
            cmd.description.toLowerCase().includes(lowerQuery)
        );
    }

    // ========== RENDERING ==========

    /**
     * Render the menu with filtered commands
     * @param {Array} commands
     * @param {number} selected
     */
    function renderMenu(commands, selected = 0) {
        if (!menuElement) createMenu();

        selectedIndex = Math.max(0, Math.min(selected, commands.length - 1));

        menuElement.innerHTML = commands.map((cmd, index) => {
            const isSelected = index === selectedIndex;
            return `
                <button
                    class="slash-menu-item ${isSelected ? 'selected' : ''}"
                    data-command="${cmd.id}"
                >
                    <span class="slash-menu-icon">${cmd.icon}</span>
                    <div class="slash-menu-content">
                        <span class="slash-menu-label">${cmd.label}</span>
                        <span class="slash-menu-description">${cmd.description}</span>
                    </div>
                </button>
            `;
        }).join('');

        // Add click handlers
        menuElement.querySelectorAll('.slash-menu-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                executeCommand(commands[index].id);
            });
        });
    }

    /**
     * Scroll selected item into view
     */
    function scrollSelectedIntoView() {
        if (!menuElement) return;
        const selected = menuElement.querySelector('.slash-menu-item.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // ========== SHOW/HIDE ==========

    /**
     * Show the slash command menu triggered by typing "/" in textarea
     * @param {HTMLTextAreaElement} textarea
     * @param {number} textareaIndex
     */
    function showFromTextarea(textarea, textareaIndex) {
        if (!menuElement) createMenu();

        isActive = true;
        triggeredFromTextarea = true;
        query = '';
        selectedIndex = 0;
        activeTextareaIndex = textareaIndex;
        anchorElement = textarea;

        renderMenu(COMMANDS, 0);
        positionMenu(textarea.getBoundingClientRect());
        attachListeners();
    }

    /**
     * Show the slash command menu from "+" button
     * @param {DOMRect} anchorRect
     * @param {number} insertIndex
     * @param {HTMLElement} [buttonEl] - The button element for scroll tracking
     */
    function showFromButton(anchorRect, insertIndex, buttonEl) {
        if (!menuElement) createMenu();

        isActive = true;
        triggeredFromTextarea = false;
        query = '';
        selectedIndex = 0;
        activeTextareaIndex = insertIndex;
        anchorElement = buttonEl || null;

        renderMenu(COMMANDS, 0);
        positionMenu(anchorRect);
        attachListeners();
    }

    /**
     * Attach scroll and click-outside listeners while menu is open
     */
    function attachListeners() {
        detachListeners();

        // Reposition on scroll (use capture to catch scroll on any element)
        scrollHandler = () => {
            if (!isActive || !anchorElement) return;
            positionMenu(anchorElement.getBoundingClientRect());
        };
        window.addEventListener('scroll', scrollHandler, true);

        // Close on click outside
        clickOutsideHandler = (e) => {
            if (!isActive || !menuElement) return;
            if (menuElement.contains(e.target)) return;
            // Don't close if clicking the anchor itself (it toggles)
            if (anchorElement && anchorElement.contains(e.target)) return;
            hide();
        };
        // Delay attachment so the opening click doesn't immediately close it
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', clickOutsideHandler, true);
        });
    }

    /**
     * Detach scroll and click-outside listeners
     */
    function detachListeners() {
        if (scrollHandler) {
            window.removeEventListener('scroll', scrollHandler, true);
            scrollHandler = null;
        }
        if (clickOutsideHandler) {
            document.removeEventListener('mousedown', clickOutsideHandler, true);
            clickOutsideHandler = null;
        }
    }

    /**
     * Hide the slash command menu
     */
    function hide() {
        detachListeners();
        if (menuElement) {
            menuElement.style.display = 'none';
        }
        isActive = false;
        triggeredFromTextarea = false;
        query = '';
        selectedIndex = 0;
        anchorElement = null;
    }

    // ========== COMMAND EXECUTION ==========

    /**
     * Execute a slash command
     * @param {string} commandId
     */
    function executeCommand(commandId) {
        const sourceIndex = activeTextareaIndex !== null ? activeTextareaIndex : 0;
        const wasFromTextarea = triggeredFromTextarea;
        let blockBecameEmpty = false;

        // Clean up "/" from textarea if triggered from typing
        if (triggeredFromTextarea && activeTextareaIndex !== null) {
            const textarea = document.querySelector(
                `.block-wrapper[data-block-index="${activeTextareaIndex}"] .block-textarea`
            );
            if (textarea) {
                const cursorPos = textarea.selectionStart;
                const text = textarea.value;

                // Find the "/" that triggered the slash command (must be at start of line)
                const textBeforeCursor = text.substring(0, cursorPos);
                const lastNewline = textBeforeCursor.lastIndexOf('\n');
                const lineStart = lastNewline + 1;

                // Only remove if "/" is at the start of the current line
                // This prevents accidentally removing "/" from URLs
                if (text[lineStart] === '/') {
                    const slashIndex = lineStart;
                    const newText = (text.substring(0, slashIndex) + text.substring(cursorPos)).replace(/\n+$/, '');
                    textarea.value = newText;
                    blockBecameEmpty = !newText.trim();
                    // Notify callback to update block content
                    if (onExecuteCallback) {
                        onExecuteCallback('updateContent', {
                            index: activeTextareaIndex,
                            content: newText
                        });
                    }
                }
            }
        }

        hide();

        // Execute the command via callback
        if (onExecuteCallback) {
            if (wasFromTextarea) {
                // If the source block is now empty, replace it with the new block.
                // Otherwise insert the new block after it.
                onExecuteCallback('execute', {
                    commandId,
                    insertIndex: blockBecameEmpty ? sourceIndex : sourceIndex + 1,
                    replaceBlockIndex: blockBecameEmpty ? sourceIndex : null
                });
            } else {
                onExecuteCallback('execute', {
                    commandId,
                    insertIndex: sourceIndex
                });
            }
        }
    }

    // ========== KEYBOARD HANDLING ==========

    /**
     * Handle keydown events when menu is active
     * @param {KeyboardEvent} e
     * @returns {boolean} - True if event was handled
     */
    function handleKeydown(e) {
        if (!isActive) return false;

        const filteredCommands = getFilteredCommands(query);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                e.stopPropagation();
                selectedIndex = (selectedIndex + 1) % filteredCommands.length;
                renderMenu(filteredCommands, selectedIndex);
                scrollSelectedIntoView();
                return true;

            case 'ArrowUp':
                e.preventDefault();
                e.stopPropagation();
                selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
                renderMenu(filteredCommands, selectedIndex);
                scrollSelectedIntoView();
                return true;

            case 'Enter':
            case 'Tab':
                e.preventDefault();
                e.stopPropagation();
                if (filteredCommands.length > 0) {
                    executeCommand(filteredCommands[selectedIndex].id);
                }
                return true;

            case 'Escape':
                e.preventDefault();
                e.stopPropagation();
                hide();
                return true;
        }
        return false;
    }

    /**
     * Handle textarea input to detect "/" and filter commands
     * @param {HTMLTextAreaElement} textarea
     * @param {number} textareaIndex
     */
    function handleTextareaInput(textarea, textareaIndex) {
        const cursorPos = textarea.selectionStart;
        const text = textarea.value;
        const textBeforeCursor = text.substring(0, cursorPos);

        // Check if "/" was typed at start of line
        const lastNewline = textBeforeCursor.lastIndexOf('\n');
        const lineStart = lastNewline + 1;
        const lineBeforeCursor = textBeforeCursor.substring(lineStart);

        if (lineBeforeCursor === '/') {
            showFromTextarea(textarea, textareaIndex);
            return;
        }

        // If slash command is active, update query
        if (isActive) {
            const slashIndex = textBeforeCursor.lastIndexOf('/');
            if (slashIndex !== -1) {
                const beforeSlash = textBeforeCursor.substring(0, slashIndex);
                const isAtLineStart = beforeSlash === '' || beforeSlash.endsWith('\n');
                if (isAtLineStart) {
                    query = textBeforeCursor.substring(slashIndex + 1);
                    const filteredCommands = getFilteredCommands(query);
                    if (filteredCommands.length === 0) {
                        hide();
                    } else {
                        renderMenu(filteredCommands, 0);
                    }
                } else {
                    hide();
                }
            } else {
                hide();
            }
        }
    }

    // ========== INITIALIZATION ==========

    /**
     * Initialize the slash command system
     * @param {Function} callback - Called with (action, data) when commands execute
     */
    function init(callback) {
        onExecuteCallback = callback;
        createMenu();
    }

    /**
     * Cleanup and destroy the menu
     */
    function cleanup() {
        detachListeners();
        if (menuElement) {
            menuElement.remove();
            menuElement = null;
        }
        isActive = false;
        anchorElement = null;
        onExecuteCallback = null;
    }

    // ========== PUBLIC API ==========

    return {
        // Initialization
        init,
        cleanup,

        // Show/Hide
        showFromTextarea,
        showFromButton,
        hide,

        // Event handlers
        handleKeydown,
        handleTextareaInput,

        // State accessors
        isActive: () => isActive,
        isVisible: () => isActive,
        getActiveIndex: () => activeTextareaIndex,

        // Config
        COMMANDS
    };
})();
