/**
 * Edit Media
 * Handles image and video uploads, processing, and S3 integration
 * Ported from GrowthLab with adaptations for billybjork.com
 */
window.EditMedia = {
    MAX_IMAGE_WIDTH: 2000,
    IMAGE_QUALITY: 0.8,
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/quicktime', 'video/webm'],
    RESIZE_CONFIG: {
        MIN_WIDTH_PERCENT: 20,
        MAX_WIDTH_PERCENT: 100,
        HANDLE_POSITIONS: ['nw', 'ne', 'sw', 'se'],
        FULL_WIDTH_THRESHOLD: 2
    },

    // Resize/selection state
    selectedMedia: null, // { element, block }
    resizeHandles: [],
    isResizing: false,
    resizeState: null,
    _resizeListenersBound: false,
    _boundHandleResize: null,
    _boundStopResize: null,
    _boundUpdateHandlePositions: null,
    _boundDocumentClick: null,

    /**
     * Initialize media handling for the editor
     */
    init() {
        this.setupPasteHandler();
        this.setupResizeHandlers();
    },

    /**
     * Setup paste handler for clipboard images
     */
    setupPasteHandler() {
        document.addEventListener('paste', async (e) => {
            if (!EditMode.isActive) return;

            const items = Array.from(e.clipboardData.items);
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    const activeBlock = document.activeElement.closest('.block-wrapper');
                    const blockIndex = activeBlock ? parseInt(activeBlock.dataset.blockIndex) : null;
                    if (blockIndex !== null) {
                        await this.handleImageUploadForBlock(file, blockIndex);
                    }
                    break;
                }
            }
        });
    },

    /**
     * Setup resize handlers for media selection
     */
    setupResizeHandlers() {
        if (this._resizeListenersBound) return;

        this._boundHandleResize = (e) => this.handleResize(e);
        this._boundStopResize = () => this.stopResize();
        this._boundUpdateHandlePositions = () => this.updateHandlePositions();
        this._boundDocumentClick = (e) => {
            if (!window.EditMode || !EditMode.isActive) return;
            if (!this.selectedMedia) return;
            if (this.isResizing) return;

            const inImageBlock = e.target.closest('.image-block-wrapper');
            const onHandle = e.target.closest('.resize-handle');
            if (inImageBlock || onHandle) return;

            this.deselect();
        };

        document.addEventListener('click', this._boundDocumentClick);
        window.addEventListener('resize', this._boundUpdateHandlePositions);
        window.addEventListener('scroll', this._boundUpdateHandlePositions, true);

        this._resizeListenersBound = true;
    },

    /**
     * Select a media element for resize
     * @param {HTMLElement} element
     * @param {Object} block
     */
    select(element, block) {
        if (!element || !block) return;
        if (!this._resizeListenersBound) this.setupResizeHandlers();

        if (this.selectedMedia && this.selectedMedia.element === element) {
            return;
        }

        this.deselect();

        this.selectedMedia = { element, block };
        element.classList.add('media-selected');
        this.createResizeHandles(element);
        this.updateHandlePositions();
    },

    /**
     * Deselect current media element
     */
    deselect() {
        if (this.isResizing) {
            this.stopResize();
        }

        if (!this.selectedMedia) return;
        this.selectedMedia.element.classList.remove('media-selected');
        this.removeResizeHandles();
        this.selectedMedia = null;
    },

    /**
     * Create resize handles around element
     * @param {HTMLElement} element
     */
    createResizeHandles(element) {
        this.removeResizeHandles();
        const rect = element.getBoundingClientRect();

        this.RESIZE_CONFIG.HANDLE_POSITIONS.forEach((position) => {
            const handle = document.createElement('div');
            handle.className = `resize-handle ${position}`;
            handle.dataset.position = position;
            this.positionHandle(handle, position, rect);
            handle.addEventListener('mousedown', (e) => this.startResize(e, position));
            document.body.appendChild(handle);
            this.resizeHandles.push(handle);
        });
    },

    /**
     * Position a single resize handle
     * @param {HTMLElement} handle
     * @param {string} position
     * @param {DOMRect} rect
     */
    positionHandle(handle, position, rect) {
        const offset = 6;
        handle.style.position = 'fixed';
        switch (position) {
            case 'nw':
                handle.style.top = `${rect.top - offset}px`;
                handle.style.left = `${rect.left - offset}px`;
                break;
            case 'ne':
                handle.style.top = `${rect.top - offset}px`;
                handle.style.left = `${rect.right - offset}px`;
                break;
            case 'sw':
                handle.style.top = `${rect.bottom - offset}px`;
                handle.style.left = `${rect.left - offset}px`;
                break;
            case 'se':
                handle.style.top = `${rect.bottom - offset}px`;
                handle.style.left = `${rect.right - offset}px`;
                break;
        }
    },

    /**
     * Update all handle positions
     */
    updateHandlePositions() {
        if (!this.selectedMedia || this.resizeHandles.length === 0) return;
        const rect = this.selectedMedia.element.getBoundingClientRect();
        this.resizeHandles.forEach((handle) => {
            this.positionHandle(handle, handle.dataset.position, rect);
        });
    },

    /**
     * Remove all resize handles
     */
    removeResizeHandles() {
        this.resizeHandles.forEach(handle => handle.remove());
        this.resizeHandles = [];
    },

    /**
     * Start resize operation
     * @param {MouseEvent} e
     * @param {string} position
     */
    startResize(e, position) {
        if (!this.selectedMedia) return;

        e.preventDefault();
        e.stopPropagation();

        const element = this.selectedMedia.element;
        const rect = element.getBoundingClientRect();
        if (!rect.width) return;

        const container = element.closest('.row-column')
            || element.closest('.block-content')
            || element.closest('.image-block-wrapper')
            || element.parentElement;
        const containerRect = container ? container.getBoundingClientRect() : rect;

        const minWidth = Math.max(80, (containerRect.width * this.RESIZE_CONFIG.MIN_WIDTH_PERCENT) / 100);
        const maxWidth = (containerRect.width * this.RESIZE_CONFIG.MAX_WIDTH_PERCENT) / 100;

        this.isResizing = true;
        element.classList.add('media-resizing');
        this.resizeState = {
            position,
            startX: e.clientX,
            startWidth: rect.width,
            minWidth,
            maxWidth,
            lastWidth: rect.width
        };

        document.addEventListener('mousemove', this._boundHandleResize);
        document.addEventListener('mouseup', this._boundStopResize);
        document.body.style.userSelect = 'none';
    },

    /**
     * Handle resize drag
     * @param {MouseEvent} e
     */
    handleResize(e) {
        if (!this.isResizing || !this.selectedMedia || !this.resizeState) return;

        const { position, startX, startWidth, minWidth, maxWidth } = this.resizeState;
        let deltaX = e.clientX - startX;
        if (position === 'nw' || position === 'sw') {
            deltaX = -deltaX;
        }

        let newWidth = startWidth + deltaX;
        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        this.resizeState.lastWidth = newWidth;

        const element = this.selectedMedia.element;
        const block = this.selectedMedia.block;

        element.style.width = `${Math.round(newWidth)}px`;
        element.style.height = 'auto';

        this.applyWidthToBlock(block, newWidth, maxWidth);
        this.updateHandlePositions();
    },

    /**
     * Stop resize operation
     */
    stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;

        if (this.selectedMedia) {
            this.selectedMedia.element.classList.remove('media-resizing');

            const { lastWidth, maxWidth } = this.resizeState || {};
            if (lastWidth && maxWidth) {
                this.applyWidthToBlock(this.selectedMedia.block, lastWidth, maxWidth);
                if (!this.styleHasWidth(this.selectedMedia.block.style)) {
                    this.selectedMedia.element.style.width = '';
                    this.selectedMedia.element.style.height = '';
                }
                if (window.EditMode && EditMode.isActive) {
                    EditMode.markDirty();
                }
            }
        }

        document.removeEventListener('mousemove', this._boundHandleResize);
        document.removeEventListener('mouseup', this._boundStopResize);
        document.body.style.userSelect = '';
        this.resizeState = null;
    },

    /**
     * Parse a style string into a property map
     * @param {string|null} style
     * @returns {Object}
     */
    parseStyle(style) {
        const styles = {};
        if (!style) return styles;

        style.split(';').forEach((part) => {
            const [prop, ...rest] = part.split(':');
            if (!prop) return;
            const value = rest.join(':').trim();
            if (!value) return;
            styles[prop.trim().toLowerCase()] = value;
        });
        return styles;
    },

    /**
     * Serialize a style map into a string
     * @param {Object} styles
     * @returns {string}
     */
    serializeStyle(styles) {
        return Object.entries(styles)
            .filter(([, value]) => value !== null && value !== undefined && value !== '')
            .map(([prop, value]) => `${prop}: ${value}`)
            .join('; ');
    },

    /**
     * Apply width to block style while preserving unrelated properties
     * @param {Object} block
     * @param {number} width
     * @param {number} maxWidth
     */
    applyWidthToBlock(block, width, maxWidth) {
        if (!block) return;

        const styles = this.parseStyle(block.style);

        delete styles['margin-left'];
        delete styles['margin-right'];
        delete styles['display'];
        delete styles['height'];
        delete styles['max-height'];
        delete styles['max-width'];
        delete styles['min-width'];
        delete styles['min-height'];

        if (Math.abs(width - maxWidth) <= this.RESIZE_CONFIG.FULL_WIDTH_THRESHOLD) {
            delete styles['width'];
        } else {
            styles['width'] = `${Math.round(width)}px`;
        }

        const styleString = this.serializeStyle(styles);
        block.style = styleString || null;
    },

    /**
     * Check if style string contains width
     * @param {string|null} style
     * @returns {boolean}
     */
    styleHasWidth(style) {
        if (!style) return false;
        return /(^|;)\s*width\s*:/.test(style);
    },

    /**
     * Handle image upload for a specific block index
     * @param {File} file - Image file
     * @param {number} blockIndex - Block index to update
     */
    async handleImageUploadForBlock(file, blockIndex) {
        EditUtils.showNotification('Processing image...', 'info');

        try {
            // Process image (resize, convert to WebP)
            const processedBlob = await this.processImage(file);

            // Upload to server
            const url = await this.uploadFile(processedBlob, 'image');

            // Update block with new image
            EditMode.updateBlock(blockIndex, {
                src: url,
                alt: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
            });

            EditUtils.showNotification('Image uploaded!', 'success');
        } catch (error) {
            console.error('Image upload failed:', error);
            EditUtils.showNotification(error.message || 'Image upload failed', 'error');
        }
    },

    /**
     * Handle video upload for a specific block index
     * @param {File} file - Video file
     * @param {number} blockIndex - Block index to update
     */
    async handleVideoUploadForBlock(file, blockIndex) {
        EditUtils.showNotification('Processing video...', 'info');

        try {
            // Server compresses and uploads the video
            const url = await this.uploadFile(file, 'video');

            // Update block with new video
            EditMode.updateBlock(blockIndex, {
                src: url,
            });

            EditUtils.showNotification('Video processed!', 'success');
        } catch (error) {
            console.error('Video upload failed:', error);
            EditUtils.showNotification(error.message || 'Video processing failed', 'error');
        }
    },

    /**
     * Process image: resize and convert to WebP
     */
    async processImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            img.onload = () => {
                // Calculate new dimensions
                let width = img.width;
                let height = img.height;

                if (width > this.MAX_IMAGE_WIDTH) {
                    height = Math.round((height * this.MAX_IMAGE_WIDTH) / width);
                    width = this.MAX_IMAGE_WIDTH;
                }

                canvas.width = width;
                canvas.height = height;

                // Draw image
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to WebP
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to create blob'));
                        }
                    },
                    'image/webp',
                    this.IMAGE_QUALITY
                );

                // Clean up object URL
                URL.revokeObjectURL(img.src);
            };

            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('Failed to load image'));
            };

            img.src = URL.createObjectURL(file);
        });
    },

    /**
     * Upload file to server
     */
    async uploadFile(file, type) {
        const formData = new FormData();
        formData.append('file', file);

        // Use appropriate endpoint based on type
        const endpoint = type === 'video' ? '/api/process-content-video' : '/api/upload-media';

        if (type === 'image') {
            formData.append('type', 'image');
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Upload failed: ${response.status}`);
        }

        const data = await response.json();
        return data.url;
    },

    /**
     * Handle image upload and insert as new block after specified index
     * @param {File} file - Image file
     * @param {string} afterBlockId - Block ID to insert after
     */
    async handleImageUpload(file, afterBlockId = null) {
        EditUtils.showNotification('Processing image...', 'info');

        try {
            const processedBlob = await this.processImage(file);
            const url = await this.uploadFile(processedBlob, 'image');
            this.insertImageBlock(url, file.name, afterBlockId);
            EditUtils.showNotification('Image uploaded!', 'success');
        } catch (error) {
            console.error('Image upload failed:', error);
            EditUtils.showNotification('Image upload failed', 'error');
        }
    },

    /**
     * Handle video upload and insert as new block
     * @param {File} file - Video file
     * @param {string} afterBlockId - Block ID to insert after
     */
    async handleVideoUpload(file, afterBlockId = null) {
        EditUtils.showNotification('Processing video...', 'info');

        try {
            const url = await this.uploadFile(file, 'video');
            this.insertVideoBlock(url, afterBlockId);
            EditUtils.showNotification('Video processed!', 'success');
        } catch (error) {
            console.error('Video upload failed:', error);
            EditUtils.showNotification(error.message || 'Video processing failed', 'error');
        }
    },

    /**
     * Insert image block into editor
     */
    insertImageBlock(url, alt = '', afterBlockId = null) {
        const newBlock = EditBlocks.createBlock('image', {
            src: url,
            alt: alt.replace(/\.[^/.]+$/, ''),
        });

        if (afterBlockId) {
            EditMode.insertBlockAfter(afterBlockId, 'image');
            // Update the last block with the image data
            const blocks = EditMode.blocks;
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock && lastBlock.type === 'image') {
                lastBlock.src = url;
                lastBlock.alt = alt.replace(/\.[^/.]+$/, '');
                EditMode.renderBlocks();
            }
        } else {
            // Add to end
            const blocks = EditMode.blocks;
            blocks.push(newBlock);
            EditMode.renderBlocks();
            EditMode.markDirty();
        }
    },

    /**
     * Insert video block into editor
     */
    insertVideoBlock(url, afterBlockId = null) {
        const newBlock = EditBlocks.createBlock('video', {
            src: url,
        });

        if (afterBlockId) {
            EditMode.insertBlockAfter(afterBlockId, 'video');
            // Update the last block with the video data
            const blocks = EditMode.blocks;
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock && lastBlock.type === 'video') {
                lastBlock.src = url;
                EditMode.renderBlocks();
            }
        } else {
            const blocks = EditMode.blocks;
            blocks.push(newBlock);
            EditMode.renderBlocks();
            EditMode.markDirty();
        }
    },

    /**
     * Replace image in existing image block by index
     * @param {number} blockIndex - Block index
     */
    async replaceImageByIndex(blockIndex) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.handleImageUploadForBlock(file, blockIndex);
            }
        });

        input.click();
    },

    /**
     * Replace video in existing video block by index
     * @param {number} blockIndex - Block index
     */
    async replaceVideoByIndex(blockIndex) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.handleVideoUploadForBlock(file, blockIndex);
            }
        });

        input.click();
    },
};

// Initialize when edit mode is active
document.addEventListener('DOMContentLoaded', () => {
    if (window.EditUtils && EditUtils.isDevMode()) {
        EditMedia.init();
    }
});
