/**
 * Edit Mode Utilities
 * Shared helper functions for the block editor
 * Ported from GrowthLab with additions for billybjork.com
 */
window.EditUtils = {
    /**
     * Generate a unique ID for blocks
     */
    generateId() {
        return 'block-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Check if we're in dev mode (localhost)
     */
    isDevMode() {
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1';
    },

    /**
     * Check if show drafts is active in the current URL
     * @returns {boolean}
     */
    isShowDraftsActive() {
        const storageKey = 'bb_show_drafts';
        const params = new URLSearchParams(window.location.search);
        if (params.has('show_drafts')) {
            const isActive = params.get('show_drafts') === 'true';
            if (isActive) {
                sessionStorage.setItem(storageKey, 'true');
            } else {
                sessionStorage.removeItem(storageKey);
            }
            return isActive;
        }
        return sessionStorage.getItem(storageKey) === 'true';
    },

    /**
     * Add show_drafts=true to a URL if currently active
     * @param {string} url
     * @returns {string}
     */
    withShowDrafts(url) {
        try {
            const next = new URL(url, window.location.origin);
            if (this.isShowDraftsActive()) {
                next.searchParams.set('show_drafts', 'true');
            }
            return next.toString();
        } catch (error) {
            return url;
        }
    },

    /**
     * Setup auto-resizing textarea
     * @param {HTMLTextAreaElement} textarea
     * @param {Function} onUpdate - Called when content changes with new value
     * @returns {Function} - The autoResize function for manual triggering
     */
    setupAutoResizeTextarea(textarea, onUpdate) {
        const autoResize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        };

        textarea.addEventListener('input', () => {
            autoResize();
            if (onUpdate) onUpdate(textarea.value);
        });

        // Initial resize after DOM settles
        setTimeout(autoResize, 0);

        return autoResize;
    },

    /**
     * Create image element with standard attributes
     * @param {Object} block - Block data with src, alt, style, align
     * @param {Function} onClick - Click handler receives (element, block)
     * @returns {HTMLImageElement}
     */
    createImageElement(block, onClick) {
        const img = document.createElement('img');
        img.src = block.src;
        img.alt = block.alt || '';
        if (block.style) img.setAttribute('style', block.style);
        if (block.align) this.applyAlignment(img, block.align);
        if (onClick) {
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                onClick(img, block);
            });
        }
        return img;
    },

    /**
     * Create video element (for content videos - MP4)
     * @param {Object} block - Block data with src, style, align
     * @param {Function} onClick - Click handler receives (element, block)
     * @returns {HTMLVideoElement}
     */
    createVideoElement(block, onClick) {
        const video = document.createElement('video');
        video.src = block.src;
        video.controls = true;
        video.className = 'content-video';
        if (block.style) video.setAttribute('style', block.style);
        if (block.align) this.applyAlignment(video, block.align);

        if (onClick) {
            video.addEventListener('click', (e) => {
                e.stopPropagation();
                onClick(video, block);
            });
        }
        return video;
    },

    /**
     * Apply alignment CSS to element
     * @param {HTMLElement} element
     * @param {string} align - 'left', 'center', or 'right'
     */
    applyAlignment(element, align) {
        element.style.display = 'block';
        element.style.marginLeft = '';
        element.style.marginRight = '';

        if (align === 'center') {
            element.style.marginLeft = 'auto';
            element.style.marginRight = 'auto';
        } else if (align === 'right') {
            element.style.marginLeft = 'auto';
        }
    },

    /**
     * Get CSS style string for alignment
     * @param {string} align - 'left', 'center', or 'right'
     * @returns {string} - CSS style string
     */
    getAlignmentStyle(align) {
        switch (align) {
            case 'center': return 'margin-left: auto; margin-right: auto';
            case 'right': return 'margin-left: auto';
            default: return '';
        }
    },

    /**
     * Parse alignment from inline style string
     * @param {string|null} style - CSS style string
     * @returns {string} - 'left', 'center', or 'right'
     */
    parseAlignmentFromStyle(style) {
        if (!style) return 'left';
        const hasMarginLeft = style.includes('margin-left: auto') || style.includes('margin-left:auto');
        const hasMarginRight = style.includes('margin-right: auto') || style.includes('margin-right:auto');

        if (hasMarginLeft && hasMarginRight) return 'center';
        if (hasMarginLeft) return 'right';
        return 'left';
    },

    /**
     * Build media style string (for images/videos with size and alignment)
     * Strips existing alignment margins and rebuilds with new alignment
     * @param {Object} block - Block with style and align properties
     * @returns {string} - Complete CSS style string
     */
    buildMediaStyleString(block) {
        let styleParts = ['display: block'];

        if (block.style) {
            const sizeStyle = block.style
                .replace(/margin-left:\s*auto;?\s*/g, '')
                .replace(/margin-right:\s*auto;?\s*/g, '')
                .replace(/display:\s*block;?\s*/g, '')
                .trim();
            if (sizeStyle) styleParts.push(sizeStyle);
        }

        const alignStyle = this.getAlignmentStyle(block.align);
        if (alignStyle) styleParts.push(alignStyle);

        return styleParts.join('; ');
    },

    /**
     * Insert text at cursor position with native undo support
     * Uses execCommand for undo stack, falls back to setRangeText
     * @param {HTMLTextAreaElement} textarea
     * @param {string} text
     */
    insertTextWithUndo(textarea, text) {
        textarea.focus({ preventScroll: true });
        // execCommand preserves native undo stack
        if (!document.execCommand('insertText', false, text)) {
            // Fallback if execCommand fails
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.setRangeText(text, start, end, 'end');
        }
    },

    /**
     * Wrap selected text in textarea with before/after strings
     * @param {HTMLTextAreaElement} textarea
     * @param {string} before - Prefix to add
     * @param {string} after - Suffix to add
     * @param {Function} onUpdate - Called after wrap completes
     */
    wrapSelection(textarea, before, after, onUpdate) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end) || 'text';
        const replacement = before + selectedText + after;

        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(start, end);
        this.insertTextWithUndo(textarea, replacement);

        // Select the inner text
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = start + before.length + selectedText.length;

        if (onUpdate) onUpdate();
    },

    /**
     * Toggle formatting on selection - wraps if not formatted, unwraps if formatted
     * @param {HTMLTextAreaElement} textarea
     * @param {string} before - Opening marker (e.g., '**', '*', '<u>')
     * @param {string} after - Closing marker (e.g., '**', '*', '</u>')
     * @param {Function} onUpdate - Called after toggle completes
     */
    toggleFormat(textarea, before, after, onUpdate) {
        const { value, selectionStart, selectionEnd } = textarea;

        // Check if we can find this format around/containing the selection
        const formatInfo = this._findFormatAroundSelection(value, selectionStart, selectionEnd, before, after);

        if (formatInfo) {
            // Already formatted - unwrap
            const { formatStart, formatEnd, innerStart, innerEnd } = formatInfo;
            const innerText = value.substring(innerStart, innerEnd);

            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(formatStart, formatEnd);
            this.insertTextWithUndo(textarea, innerText);

            // Position cursor/selection on the unwrapped text
            textarea.selectionStart = formatStart;
            textarea.selectionEnd = formatStart + innerText.length;
        } else {
            // Not formatted - wrap
            this.wrapSelection(textarea, before, after, () => {});
        }

        if (onUpdate) onUpdate();
    },

    /**
     * Find format markers around or containing the selection
     * @private
     * @returns {Object|null} - {formatStart, formatEnd, innerStart, innerEnd} or null if not found
     */
    _findFormatAroundSelection(value, selStart, selEnd, before, after) {
        // Constrain search to current line only (inline formatting doesn't span lines)
        const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
        const lineEnd = value.indexOf('\n', selEnd);
        const effectiveLineEnd = lineEnd === -1 ? value.length : lineEnd;

        // Search backwards from selection start for the opening marker
        let openPos = -1;

        for (let i = selStart; i >= lineStart; i--) {
            if (value.substring(i, i + before.length) === before) {
                const charBefore = i > 0 ? value[i - 1] : '';
                const isValidOpen = before !== '**' || charBefore !== '*';
                if (isValidOpen) {
                    openPos = i;
                    break;
                }
            }
        }

        if (openPos === -1) return null;

        // Search forwards from selection end for the closing marker
        let closePos = -1;
        const searchStart = Math.max(openPos + before.length, selEnd);

        for (let i = searchStart; i <= effectiveLineEnd - after.length; i++) {
            if (value.substring(i, i + after.length) === after) {
                const charAfter = i + after.length < value.length ? value[i + after.length] : '';
                const isValidClose = after !== '**' || charAfter !== '*';
                if (isValidClose) {
                    closePos = i;
                    break;
                }
            }
        }

        if (closePos === -1) return null;

        // Verify the selection is actually inside this formatted region
        const innerStart = openPos + before.length;
        const innerEnd = closePos;

        if (selStart >= innerStart && selEnd <= innerEnd) {
            return {
                formatStart: openPos,
                formatEnd: closePos + after.length,
                innerStart,
                innerEnd
            };
        }

        return null;
    },

    /**
     * Handle formatting keyboard shortcuts (Cmd/Ctrl + B/I/U/K)
     * @param {KeyboardEvent} e
     * @param {HTMLTextAreaElement} textarea
     * @param {Function} onUpdate - Called after formatting applied
     * @returns {boolean} - True if shortcut was handled
     */
    handleFormattingShortcuts(e, textarea, onUpdate) {
        if (!(e.metaKey || e.ctrlKey)) return false;

        switch (e.key) {
            case 'b':
                e.preventDefault();
                this.toggleFormat(textarea, '**', '**', onUpdate);
                return true;
            case 'i':
                e.preventDefault();
                this.toggleFormat(textarea, '*', '*', onUpdate);
                return true;
            case 'u':
                e.preventDefault();
                this.toggleFormat(textarea, '<u>', '</u>', onUpdate);
                return true;
            case 'k':
                e.preventDefault();
                this.insertLink(textarea, onUpdate);
                return true;
        }
        return false;
    },

    /**
     * Find markdown link at cursor position
     * @param {HTMLTextAreaElement} textarea
     * @returns {Object|null} - {start, end, text, url, textStart, textEnd, urlStart, urlEnd} or null
     */
    findLinkAtCursor(textarea) {
        const { value, selectionStart } = textarea;

        // Search backwards for '[' that starts a link
        let bracketStart = -1;
        for (let i = selectionStart; i >= Math.max(0, selectionStart - 500); i--) {
            if (value[i] === '[') {
                bracketStart = i;
                break;
            }
            if (value[i] === '\n' || value[i] === ')') break;
        }

        if (bracketStart === -1) return null;

        // Find the full link pattern: [text](url)
        const afterBracket = value.substring(bracketStart);
        const linkMatch = afterBracket.match(/^\[([^\]]*)\]\(([^)]*)\)/);

        if (!linkMatch) return null;

        const fullMatch = linkMatch[0];
        const linkEnd = bracketStart + fullMatch.length;

        if (selectionStart > linkEnd) return null;

        return {
            start: bracketStart,
            end: linkEnd,
            text: linkMatch[1],
            url: linkMatch[2],
            textStart: bracketStart + 1,
            textEnd: bracketStart + 1 + linkMatch[1].length,
            urlStart: bracketStart + linkMatch[1].length + 3,
            urlEnd: linkEnd - 1
        };
    },

    /**
     * Insert or edit markdown link at cursor
     * If cursor is inside existing link, edits the URL
     * @param {HTMLTextAreaElement} textarea
     * @param {Function} onUpdate - Called after link inserted/edited
     */
    async insertLink(textarea, onUpdate) {
        const existingLink = this.findLinkAtCursor(textarea);

        if (existingLink) {
            const newUrl = prompt('Edit link URL (leave empty to remove link):', existingLink.url);
            if (newUrl === null) return; // Cancelled

            if (newUrl === '') {
                // Empty URL = remove link, keep text
                textarea.focus({ preventScroll: true });
                textarea.setSelectionRange(existingLink.start, existingLink.end);
                this.insertTextWithUndo(textarea, existingLink.text);
            } else {
                // Update URL
                const newLink = `[${existingLink.text}](${newUrl})`;
                textarea.focus({ preventScroll: true });
                textarea.setSelectionRange(existingLink.start, existingLink.end);
                this.insertTextWithUndo(textarea, newLink);
            }
        } else {
            // Create new link
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selectedText = textarea.value.substring(start, end) || 'link text';

            const url = prompt('Enter link URL:');
            if (!url) return;

            const linkText = `[${selectedText}](${url})`;
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(start, end);
            this.insertTextWithUndo(textarea, linkText);
        }

        if (onUpdate) onUpdate();
    },

    /**
     * Apply text alignment CSS to element
     * @param {HTMLElement} element
     * @param {string} align - 'left', 'center', or 'right'
     */
    applyTextAlignment(element, align) {
        element.style.textAlign = align || 'left';
    },

    /**
     * Get CSS style string for text alignment
     * @param {string} align - 'left', 'center', or 'right'
     * @returns {string} - CSS style string
     */
    getTextAlignmentStyle(align) {
        if (!align || align === 'left') return '';
        return `text-align: ${align}`;
    },

    /**
     * Parse text alignment from inline style string
     * @param {string|null} style - CSS style string
     * @returns {string} - 'left', 'center', or 'right'
     */
    parseTextAlignmentFromStyle(style) {
        if (!style) return 'left';
        const match = style.match(/text-align:\s*(left|center|right)/);
        return match ? match[1] : 'left';
    },

    /**
     * Handle list-related keyboard shortcuts (Enter, Tab, Shift+Tab)
     * @param {KeyboardEvent} e
     * @param {HTMLTextAreaElement} textarea
     * @param {Function} onUpdate - Called after modification
     * @returns {boolean} - True if shortcut was handled
     */
    handleListShortcuts(e, textarea, onUpdate) {
        // Tab - indent
        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            this._indentLines(textarea, onUpdate);
            return true;
        }

        // Shift+Tab - outdent
        if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            this._outdentLines(textarea, onUpdate);
            return true;
        }

        // Enter - list continuation
        if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            if (this._handleListEnter(e, textarea, onUpdate)) {
                return true;
            }
        }

        return false;
    },

    /**
     * Indent selected lines or current line by 3 spaces
     * @private
     */
    _indentLines(textarea, onUpdate) {
        const { value, selectionStart, selectionEnd } = textarea;
        const indent = '   '; // 3 spaces for list sub-items

        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        let lineEnd = value.indexOf('\n', selectionEnd);
        if (lineEnd === -1) lineEnd = value.length;

        const beforeLines = value.substring(0, lineStart);
        const selectedLines = value.substring(lineStart, lineEnd);
        const afterLines = value.substring(lineEnd);

        const indentedLines = selectedLines.split('\n').map(line => {
            const numberedMatch = line.match(/^(\s*)\d+\.\s(.*)$/);
            if (numberedMatch) {
                return indent + numberedMatch[1] + '- ' + numberedMatch[2];
            }
            return indent + line;
        }).join('\n');

        textarea.value = beforeLines + indentedLines + afterLines;

        const addedChars = indentedLines.length - selectedLines.length;
        textarea.selectionStart = selectionStart + indent.length;
        textarea.selectionEnd = selectionEnd + addedChars;

        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        if (onUpdate) onUpdate();
    },

    /**
     * Outdent selected lines or current line by up to 4 spaces
     * @private
     */
    _outdentLines(textarea, onUpdate) {
        const { value, selectionStart, selectionEnd } = textarea;

        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        let lineEnd = value.indexOf('\n', selectionEnd);
        if (lineEnd === -1) lineEnd = value.length;

        const beforeLines = value.substring(0, lineStart);
        const selectedLines = value.substring(lineStart, lineEnd);
        const afterLines = value.substring(lineEnd);

        let firstLineRemoved = 0;
        let totalRemoved = 0;

        const outdentedLines = selectedLines.split('\n').map((line, idx) => {
            const match = line.match(/^( {1,4}|\t)/);
            if (match) {
                const removed = match[0].length;
                if (idx === 0) firstLineRemoved = removed;
                totalRemoved += removed;
                return line.substring(removed);
            }
            return line;
        }).join('\n');

        textarea.value = beforeLines + outdentedLines + afterLines;

        textarea.selectionStart = Math.max(lineStart, selectionStart - firstLineRemoved);
        textarea.selectionEnd = selectionEnd - totalRemoved;

        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        if (onUpdate) onUpdate();
    },

    /**
     * Handle Enter key in list context - continue or end list
     * @private
     * @returns {boolean} - True if handled as list operation
     */
    _handleListEnter(e, textarea, onUpdate) {
        const { value, selectionStart, selectionEnd } = textarea;

        if (selectionStart !== selectionEnd) return false;

        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        const lineEnd = value.indexOf('\n', selectionStart);
        const currentLine = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);

        // Check for unordered list: -, *, +
        const unorderedMatch = currentLine.match(/^(\s*)([-*+])\s(.*)$/);
        if (unorderedMatch) {
            const [, indent, marker, content] = unorderedMatch;

            if (content.trim() === '') {
                e.preventDefault();
                const before = value.substring(0, lineStart);
                const after = value.substring(lineEnd === -1 ? value.length : lineEnd);
                textarea.value = before + after;
                textarea.selectionStart = textarea.selectionEnd = lineStart;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                if (onUpdate) onUpdate();
                return true;
            }

            e.preventDefault();
            const newLine = `\n${indent}${marker} `;
            this.insertTextWithUndo(textarea, newLine);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            if (onUpdate) onUpdate();
            return true;
        }

        // Check for ordered list: 1., 2., etc.
        const orderedMatch = currentLine.match(/^(\s*)(\d+)\.\s(.*)$/);
        if (orderedMatch) {
            const [, indent, num, content] = orderedMatch;

            if (content.trim() === '') {
                e.preventDefault();
                const before = value.substring(0, lineStart);
                const after = value.substring(lineEnd === -1 ? value.length : lineEnd);
                textarea.value = before + after;
                textarea.selectionStart = textarea.selectionEnd = lineStart;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                if (onUpdate) onUpdate();
                return true;
            }

            e.preventDefault();
            const nextNum = parseInt(num, 10) + 1;
            const newLine = `\n${indent}${nextNum}. `;
            this.insertTextWithUndo(textarea, newLine);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            if (onUpdate) onUpdate();
            return true;
        }

        return false;
    },

    /**
     * Show notification toast
     */
    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `edit-notification edit-notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        requestAnimationFrame(() => {
            notification.classList.add('show');
        });

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    },

    /**
     * Deep clone an object
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Check if element is empty or contains only whitespace/br
     */
    isElementEmpty(element) {
        const text = element.textContent.trim();
        const html = element.innerHTML.trim();
        return text === '' || html === '' || html === '<br>';
    },

    /**
     * Move caret to end of element
     */
    moveCaretToEnd(element) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    },

    /**
     * Fetch with error handling
     */
    async fetchJSON(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Fetch error:', error);
            throw error;
        }
    },

    /**
     * Debounce function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
};
