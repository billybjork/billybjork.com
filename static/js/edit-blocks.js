/**
 * Edit Blocks Module
 * Block parsing and markdown conversion for the block editor
 * Ported from GrowthLab with adaptations for billybjork.com
 */
window.EditBlocks = (function() {
    'use strict';

    // ========== CONSTANTS ==========

    const BLOCK_SEPARATOR = '<!-- block -->';
    const ROW_START = '<!-- row -->';
    const ROW_END = '<!-- /row -->';
    const COL_SEPARATOR = '<!-- col -->';

    // ========== BLOCK DETECTION ==========

    // HTML block markers
    const HTML_START = '<!-- html -->';
    const HTML_END = '<!-- /html -->';

    /**
     * Detect and set block type based on content
     * @param {object} block - Block object to modify
     * @param {string} trimmed - Trimmed content string
     */
    function detectBlockType(block, trimmed) {
        // Check for HTML block first (<!-- html --> ... <!-- /html -->)
        if (trimmed.startsWith(HTML_START) && trimmed.endsWith(HTML_END)) {
            block.type = 'html';
            block.html = trimmed.slice(HTML_START.length, -HTML_END.length).trim();
            return;
        }

        // Check for code block first (```language)
        if (trimmed.startsWith('```')) {
            block.type = 'code';
            const match = trimmed.match(/^```(\w*)\n?([\s\S]*?)\n?```$/);
            if (match) {
                block.language = match[1] || 'text';
                block.code = match[2] || '';
            } else {
                block.language = 'text';
                block.code = trimmed.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
            }
            return;
        }

        // Check for image: ![alt](url) or <img>
        if (trimmed.startsWith('<img') || /^!\[.*?\]\(.*?\)$/.test(trimmed)) {
            block.type = 'image';
            if (trimmed.startsWith('<img')) {
                const srcMatch = trimmed.match(/src="([^"]*)"/);
                const altMatch = trimmed.match(/alt="([^"]*)"/);
                const styleMatch = trimmed.match(/style="([^"]*)"/);
                block.src = srcMatch ? srcMatch[1] : '';
                block.alt = altMatch ? altMatch[1] : '';
                block.style = styleMatch ? styleMatch[1] : null;
                block.align = EditUtils.parseAlignmentFromStyle(block.style);
            } else {
                const mdMatch = trimmed.match(/!\[(.*?)\]\((.*?)\)/);
                block.src = mdMatch ? mdMatch[2] : '';
                block.alt = mdMatch ? mdMatch[1] : '';
                block.style = null;
                block.align = 'left';
            }
            return;
        }

        // Check for video: <video> tag
        if (trimmed.startsWith('<video')) {
            block.type = 'video';
            const srcMatch = trimmed.match(/src="([^"]*)"/);
            const styleMatch = trimmed.match(/style="([^"]*)"/);
            block.src = srcMatch ? srcMatch[1] : '';
            block.style = styleMatch ? styleMatch[1] : null;
            block.align = EditUtils.parseAlignmentFromStyle(block.style);
            return;
        }

        // Check for callout: <div class="callout"> with optional style
        if (trimmed.startsWith('<div class="callout"')) {
            block.type = 'callout';
            // Match with or without style attribute
            const contentMatch = trimmed.match(/<div class="callout"(?:\s+style="([^"]*)")?>([\s\S]*?)<\/div>/);
            if (contentMatch) {
                block.align = contentMatch[1] ? EditUtils.parseTextAlignmentFromStyle(contentMatch[1]) : 'left';
                block.content = contentMatch[2].trim();
            } else {
                block.content = '';
                block.align = 'left';
            }
            return;
        }

        // Check for divider: ---, ***, ___
        if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
            block.type = 'divider';
            return;
        }

        // Check for text block with paired comment-based alignment markers
        if (trimmed.startsWith('<!-- align:')) {
            block.type = 'text';
            const alignMatch = trimmed.match(/^<!-- align:(center|right) -->\n?([\s\S]*?)\n?<!-- \/align -->$/);
            if (alignMatch) {
                block.align = alignMatch[1];
                block.content = alignMatch[2].trim();
            } else {
                block.align = 'left';
            }
            return;
        }

        // Legacy: text block with div alignment wrapper (backward compatibility)
        if (trimmed.startsWith('<div style="text-align:') || trimmed.startsWith('<div style="text-align :')) {
            block.type = 'text';
            const styleMatch = trimmed.match(/<div style="([^"]*)">([\s\S]*?)<\/div>/);
            if (styleMatch) {
                block.align = EditUtils.parseTextAlignmentFromStyle(styleMatch[1]);
                block.content = styleMatch[2].trim();
            } else {
                block.align = 'left';
            }
            return;
        }

        // Default to text block
        block.type = 'text';
        block.align = 'left';
    }

    /**
     * Generate unique block ID
     * @param {number} index - Block index
     * @returns {string}
     */
    function generateBlockId(index) {
        return `block-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`;
    }

    /**
     * Parse a single block from raw content
     * @param {string} content - Raw block content
     * @param {number} index - Block index for ID generation
     * @returns {object} - Parsed block object
     */
    function parseSingleBlock(content, index) {
        const trimmed = content.trim();
        const block = {
            id: generateBlockId(index),
            content: content.trim()
        };
        detectBlockType(block, trimmed);
        return block;
    }

    // ========== PARSING ==========

    /**
     * Parse markdown content into blocks separated by <!-- block -->
     * Detects block types: text, image, video, code, row, callout, divider
     * @param {string} markdown - Raw markdown content
     * @returns {Array} - Array of parsed block objects
     */
    function parseIntoBlocks(markdown) {
        if (!markdown || !markdown.trim()) {
            return [{ id: generateBlockId(0), type: 'text', content: '', align: 'left' }];
        }

        // Split on block separator with flexible whitespace (1+ newlines on each side)
        const rawBlocks = markdown.split(new RegExp(`\\n+${BLOCK_SEPARATOR}\\n+`));

        const blocks = rawBlocks.map((content, index) => {
            const trimmed = content.trim();

            // Check for row block
            if (trimmed.startsWith(ROW_START) && trimmed.endsWith(ROW_END)) {
                // Extract content between row markers
                const innerContent = trimmed
                    .slice(ROW_START.length, -ROW_END.length)
                    .trim();

                // Split on column separator
                const columns = innerContent.split(new RegExp(`\\n*${COL_SEPARATOR}\\n*`));

                if (columns.length >= 2) {
                    return {
                        id: generateBlockId(index),
                        type: 'row',
                        left: parseSingleBlock(columns[0], index * 10),
                        right: parseSingleBlock(columns[1], index * 10 + 1)
                    };
                }
            }

            // Regular block parsing
            return parseSingleBlock(content, index);
        });

        return blocks.length ? blocks : [{ id: generateBlockId(0), type: 'text', content: '', align: 'left' }];
    }

    // ========== FORMATTING ==========

    /**
     * Format image block as markdown/HTML
     * Uses HTML img tag if sized or aligned, markdown syntax otherwise
     * @param {object} block
     * @returns {string}
     */
    function formatImageMarkdown(block) {
        const hasSize = block.style && (block.style.includes('width') || block.style.includes('max-width'));
        const hasAlignment = block.align && block.align !== 'left';

        if (hasSize || hasAlignment) {
            const finalStyle = EditUtils.buildMediaStyleString(block);
            return `<img src="${block.src}" alt="${block.alt || ''}" style="${finalStyle}">`;
        }
        // Use markdown syntax for unsized, left-aligned images
        return `![${block.alt || ''}](${block.src})`;
    }

    /**
     * Format video block as HTML
     * @param {object} block
     * @returns {string}
     */
    function formatVideoMarkdown(block) {
        const hasSize = block.style && (block.style.includes('width') || block.style.includes('max-width'));
        const hasAlignment = block.align && block.align !== 'left';

        if (hasSize || hasAlignment) {
            const finalStyle = EditUtils.buildMediaStyleString(block);
            return `<video src="${block.src}" controls style="${finalStyle}"></video>`;
        }
        return `<video src="${block.src}" controls></video>`;
    }

    /**
     * Format code block
     * @param {object} block
     * @returns {string}
     */
    function formatCodeMarkdown(block) {
        return '```' + (block.language || '') + '\n' + (block.code || '') + '\n```';
    }

    /**
     * Format callout block as HTML
     * @param {object} block
     * @returns {string}
     */
    function formatCalloutHtml(block) {
        const hasAlignment = block.align && block.align !== 'left';
        if (hasAlignment) {
            const alignStyle = EditUtils.getTextAlignmentStyle(block.align);
            return `<div class="callout" style="${alignStyle}">${block.content}</div>`;
        }
        return `<div class="callout">${block.content}</div>`;
    }

    /**
     * Format row block as markdown with row/col markers
     * @param {object} block
     * @returns {string}
     */
    function formatRowMarkdown(block) {
        const leftContent = blockToMarkdown(block.left);
        const rightContent = blockToMarkdown(block.right);
        return `${ROW_START}\n${leftContent}\n${COL_SEPARATOR}\n${rightContent}\n${ROW_END}`;
    }

    /**
     * Format HTML block (raw HTML preserved)
     * @param {object} block
     * @returns {string}
     */
    function formatHtmlBlock(block) {
        const htmlContent = block.html || '';
        // Wrap in alignment div if not left-aligned
        if (block.align && block.align !== 'left') {
            const alignStyle = EditUtils.getTextAlignmentStyle(block.align);
            return `${HTML_START}\n<div style="${alignStyle}">\n${htmlContent}\n</div>\n${HTML_END}`;
        }
        return `${HTML_START}\n${htmlContent}\n${HTML_END}`;
    }

    /**
     * Convert a single block to markdown string
     * @param {object} block
     * @returns {string}
     */
    function blockToMarkdown(block) {
        switch (block.type) {
            case 'text':
                const content = (block.content || '').trim();
                // Use paired comment markers for alignment (doesn't interfere with markdown parsing)
                if (block.align && block.align !== 'left') {
                    return `<!-- align:${block.align} -->\n${content}\n<!-- /align -->`;
                }
                return content;
            case 'image':
                return formatImageMarkdown(block);
            case 'video':
                return formatVideoMarkdown(block);
            case 'code':
                return formatCodeMarkdown(block);
            case 'html':
                return formatHtmlBlock(block);
            case 'row':
                return formatRowMarkdown(block);
            case 'callout':
                return formatCalloutHtml(block);
            case 'divider':
                return '---';
            default:
                return (block.content || '').trim();
        }
    }

    /**
     * Convert blocks array back to markdown string
     * Uses double newlines around separator for proper markdown parsing
     * @param {Array} blocks
     * @returns {string}
     */
    function blocksToMarkdown(blocks) {
        return blocks.map(block => blockToMarkdown(block)).join(`\n\n${BLOCK_SEPARATOR}\n\n`);
    }

    /**
     * Create a new empty block of specified type
     * @param {string} type - Block type
     * @param {object} props - Additional properties
     * @returns {object}
     */
    function createBlock(type, props = {}) {
        const base = {
            id: generateBlockId(Date.now()),
            type: type
        };

        switch (type) {
            case 'text':
                return { ...base, content: '', align: 'left', ...props };
            case 'image':
                return { ...base, src: '', alt: '', style: null, align: 'left', ...props };
            case 'video':
                return { ...base, src: '', style: null, align: 'left', ...props };
            case 'code':
                return { ...base, language: 'javascript', code: '', align: 'left', ...props };
            case 'html':
                return { ...base, html: '', align: 'left', ...props };
            case 'callout':
                return { ...base, content: '', align: 'left', ...props };
            case 'row':
                return {
                    ...base,
                    left: createBlock('text'),
                    right: createBlock('text'),
                    ...props
                };
            case 'divider':
                return { ...base, ...props };
            default:
                return { ...base, content: '', align: 'left', ...props };
        }
    }

    // Backwards compatibility alias
    function parseMarkdown(markdown) {
        return parseIntoBlocks(markdown);
    }

    // ========== PUBLIC API ==========

    return {
        // Constants
        BLOCK_SEPARATOR,
        ROW_START,
        ROW_END,
        COL_SEPARATOR,
        HTML_START,
        HTML_END,

        // Parsing
        parseIntoBlocks,
        parseMarkdown, // Alias for backwards compatibility
        parseSingleBlock,

        // Formatting
        blockToMarkdown,
        blocksToMarkdown,
        formatImageMarkdown,
        formatVideoMarkdown,
        formatCodeMarkdown,
        formatHtmlBlock,
        formatCalloutHtml,
        formatRowMarkdown,

        // Factory
        createBlock,
        createEmptyBlock: createBlock, // Alias for backwards compatibility
        generateBlockId
    };
})();
