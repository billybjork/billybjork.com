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

    /**
     * Initialize media handling for the editor
     */
    init() {
        this.setupPasteHandler();
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
