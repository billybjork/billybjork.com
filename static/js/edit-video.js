/**
 * Edit Video
 * Video trimmer UI for hero video processing
 */

const EditVideo = {
    modal: null,
    video: null,
    file: null,
    duration: 0,
    trimStart: 0,
    spriteStart: 0,
    spriteDuration: 3,
    projectSlug: null,
    onComplete: null,

    /**
     * Open video trimmer modal
     */
    open(file, projectSlug, onComplete) {
        this.file = file;
        this.projectSlug = projectSlug;
        this.onComplete = onComplete;
        this.trimStart = 0;
        this.spriteStart = 0;

        this.createModal();
        this.loadVideo();
    },

    /**
     * Create modal UI
     */
    createModal() {
        this.modal = document.createElement('div');
        this.modal.className = 'edit-video-modal';
        this.modal.innerHTML = `
            <div class="edit-video-overlay"></div>
            <div class="edit-video-content">
                <div class="edit-video-header">
                    <h2>Process Hero Video</h2>
                    <button class="edit-video-close">&times;</button>
                </div>

                <div class="edit-video-preview">
                    <video class="edit-video-player" controls></video>
                </div>

                <div class="edit-video-controls">
                    <div class="edit-video-section">
                        <h3>Sprite Sheet Range</h3>
                        <p class="edit-video-help">Select a 3-second range for the thumbnail animation</p>

                        <div class="edit-video-timeline">
                            <div class="edit-video-timeline-track">
                                <div class="edit-video-sprite-range"></div>
                                <div class="edit-video-playhead"></div>
                            </div>
                        </div>

                        <div class="edit-video-time-display">
                            <span class="edit-video-current-time">0:00</span>
                            <span class="edit-video-sprite-info">Sprite: 0:00 - 0:03</span>
                            <span class="edit-video-total-time">0:00</span>
                        </div>
                    </div>

                    <div class="edit-video-actions">
                        <button class="edit-btn edit-btn-secondary" id="edit-video-cancel">Cancel</button>
                        <button class="edit-btn edit-btn-primary" id="edit-video-process">
                            <span class="edit-video-process-text">Process Video</span>
                            <span class="edit-video-process-spinner" style="display: none;">Processing...</span>
                        </button>
                    </div>
                </div>

                <div class="edit-video-progress" style="display: none;">
                    <div class="edit-video-progress-bar">
                        <div class="edit-video-progress-fill"></div>
                    </div>
                    <div class="edit-video-progress-text">Uploading...</div>
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);
        document.body.classList.add('modal-open');

        // Setup event listeners
        this.setupEventListeners();
    },

    /**
     * Load video into preview
     */
    loadVideo() {
        this.video = this.modal.querySelector('.edit-video-player');
        const url = URL.createObjectURL(this.file);
        this.video.src = url;

        this.video.addEventListener('loadedmetadata', () => {
            this.duration = this.video.duration;
            this.updateTimeDisplay();
            this.updateSpriteRange();
        });

        this.video.addEventListener('timeupdate', () => {
            this.updatePlayhead();
            this.updateCurrentTime();
        });
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Close button
        this.modal.querySelector('.edit-video-close').addEventListener('click', () => {
            this.close();
        });

        // Overlay click
        this.modal.querySelector('.edit-video-overlay').addEventListener('click', () => {
            this.close();
        });

        // Cancel button
        this.modal.querySelector('#edit-video-cancel').addEventListener('click', () => {
            this.close();
        });

        // Process button
        this.modal.querySelector('#edit-video-process').addEventListener('click', () => {
            this.process();
        });

        // Timeline click to set sprite start
        const timeline = this.modal.querySelector('.edit-video-timeline-track');
        timeline.addEventListener('click', (e) => {
            const rect = timeline.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const time = percent * this.duration;

            // Ensure sprite range stays within video
            this.spriteStart = Math.min(time, this.duration - this.spriteDuration);
            this.spriteStart = Math.max(0, this.spriteStart);

            this.video.currentTime = this.spriteStart;
            this.updateSpriteRange();
        });

        // Drag sprite range
        const spriteRange = this.modal.querySelector('.edit-video-sprite-range');
        let isDragging = false;
        let dragStartX = 0;
        let dragStartTime = 0;

        spriteRange.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartTime = this.spriteStart;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const timeline = this.modal.querySelector('.edit-video-timeline-track');
            const rect = timeline.getBoundingClientRect();
            const deltaX = e.clientX - dragStartX;
            const deltaTime = (deltaX / rect.width) * this.duration;

            let newStart = dragStartTime + deltaTime;
            newStart = Math.max(0, Math.min(newStart, this.duration - this.spriteDuration));

            this.spriteStart = newStart;
            this.video.currentTime = this.spriteStart;
            this.updateSpriteRange();
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (!this.modal) return;

            if (e.key === 'Escape') {
                this.close();
            }

            // Arrow keys to adjust sprite position
            if (e.key === 'ArrowLeft') {
                this.spriteStart = Math.max(0, this.spriteStart - 0.5);
                this.video.currentTime = this.spriteStart;
                this.updateSpriteRange();
            }
            if (e.key === 'ArrowRight') {
                this.spriteStart = Math.min(this.duration - this.spriteDuration, this.spriteStart + 0.5);
                this.video.currentTime = this.spriteStart;
                this.updateSpriteRange();
            }
        });
    },

    /**
     * Update time display
     */
    updateTimeDisplay() {
        const total = this.modal.querySelector('.edit-video-total-time');
        total.textContent = this.formatTime(this.duration);
    },

    /**
     * Update current time display
     */
    updateCurrentTime() {
        const current = this.modal.querySelector('.edit-video-current-time');
        current.textContent = this.formatTime(this.video.currentTime);
    },

    /**
     * Update playhead position
     */
    updatePlayhead() {
        const playhead = this.modal.querySelector('.edit-video-playhead');
        const percent = (this.video.currentTime / this.duration) * 100;
        playhead.style.left = `${percent}%`;
    },

    /**
     * Update sprite range indicator
     */
    updateSpriteRange() {
        const range = this.modal.querySelector('.edit-video-sprite-range');
        const startPercent = (this.spriteStart / this.duration) * 100;
        const widthPercent = (this.spriteDuration / this.duration) * 100;

        range.style.left = `${startPercent}%`;
        range.style.width = `${widthPercent}%`;

        // Update info text
        const info = this.modal.querySelector('.edit-video-sprite-info');
        const endTime = this.spriteStart + this.spriteDuration;
        info.textContent = `Sprite: ${this.formatTime(this.spriteStart)} - ${this.formatTime(endTime)}`;
    },

    /**
     * Format time as M:SS
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    /**
     * Process video
     */
    async process() {
        const processBtn = this.modal.querySelector('#edit-video-process');
        const processText = processBtn.querySelector('.edit-video-process-text');
        const processSpinner = processBtn.querySelector('.edit-video-process-spinner');
        const progressDiv = this.modal.querySelector('.edit-video-progress');
        const progressFill = this.modal.querySelector('.edit-video-progress-fill');
        const progressText = this.modal.querySelector('.edit-video-progress-text');

        processBtn.disabled = true;
        processText.style.display = 'none';
        processSpinner.style.display = 'inline';
        progressDiv.style.display = 'block';

        try {
            // Upload video file
            progressText.textContent = 'Uploading video...';
            progressFill.style.width = '20%';

            const formData = new FormData();
            formData.append('file', this.file);
            formData.append('project_slug', this.projectSlug);
            formData.append('sprite_start', this.spriteStart);
            formData.append('sprite_duration', this.spriteDuration);

            const response = await fetch('/api/process-hero-video', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Processing failed: ${response.status}`);
            }

            // Monitor progress
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let result = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                result += chunk;

                // Try to parse progress updates
                const lines = result.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.progress) {
                                progressFill.style.width = `${data.progress}%`;
                                progressText.textContent = data.status || 'Processing...';
                            }
                            if (data.complete) {
                                this.handleComplete(data);
                                return;
                            }
                            if (data.error) {
                                throw new Error(data.error);
                            }
                        } catch (e) {
                            // Not JSON, ignore
                        }
                    }
                }
            }

            // Try to parse final result
            try {
                const finalResult = JSON.parse(result);
                this.handleComplete(finalResult);
            } catch (e) {
                throw new Error('Invalid response from server');
            }

        } catch (error) {
            console.error('Video processing error:', error);
            EditUtils.showNotification(`Processing failed: ${error.message}`, 'error');

            processBtn.disabled = false;
            processText.style.display = 'inline';
            processSpinner.style.display = 'none';
            progressDiv.style.display = 'none';
        }
    },

    /**
     * Handle processing complete
     */
    handleComplete(result) {
        if (this.onComplete) {
            this.onComplete(result);
        }

        EditUtils.showNotification('Video processed successfully!', 'success');
        this.close();
    },

    /**
     * Close modal
     */
    close() {
        if (this.video && this.video.src) {
            URL.revokeObjectURL(this.video.src);
            this.video.src = '';
        }

        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }

        document.body.classList.remove('modal-open');

        this.video = null;
        this.file = null;
        this.projectSlug = null;
        this.onComplete = null;
    },
};

window.EditVideo = EditVideo;
