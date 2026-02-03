/**
 * Edit Undo/Redo
 * Handles undo/redo history for the block editor
 */

const EditUndo = {
    history: [],
    currentIndex: -1,
    maxHistory: 50,
    isUndoing: false,
    debounceTimer: null,
    DEBOUNCE_MS: 500,

    /**
     * Initialize undo system
     */
    init() {
        this.history = [];
        this.currentIndex = -1;
    },

    /**
     * Save current state to history
     */
    saveState() {
        if (this.isUndoing) return;

        // Debounce rapid changes
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this._doSaveState();
        }, this.DEBOUNCE_MS);
    },

    /**
     * Actually save state (after debounce)
     */
    _doSaveState() {
        const state = this.captureState();

        // If we're in the middle of history, remove future states
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }

        // Add new state
        this.history.push(state);
        this.currentIndex = this.history.length - 1;

        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.currentIndex--;
        }
    },

    /**
     * Capture current editor state
     */
    captureState() {
        return {
            blocks: EditUtils.deepClone(EditMode.blocks),
            timestamp: Date.now(),
        };
    },

    /**
     * Restore a state
     */
    restoreState(state) {
        if (!state) return;

        this.isUndoing = true;
        EditMode.blocks = EditUtils.deepClone(state.blocks);
        EditMode.renderBlocks();
        EditMode.markDirty();
        this.isUndoing = false;
    },

    /**
     * Undo last action
     */
    undo() {
        if (this.currentIndex <= 0) {
            EditUtils.showNotification('Nothing to undo', 'info');
            return;
        }

        // Save current state if not already saved
        if (this.currentIndex === this.history.length - 1) {
            this._doSaveState();
        }

        this.currentIndex--;
        this.restoreState(this.history[this.currentIndex]);
        EditUtils.showNotification('Undo', 'info', 1000);
    },

    /**
     * Redo last undone action
     */
    redo() {
        if (this.currentIndex >= this.history.length - 1) {
            EditUtils.showNotification('Nothing to redo', 'info');
            return;
        }

        this.currentIndex++;
        this.restoreState(this.history[this.currentIndex]);
        EditUtils.showNotification('Redo', 'info', 1000);
    },

    /**
     * Clear history
     */
    clear() {
        this.history = [];
        this.currentIndex = -1;
    },

    /**
     * Check if undo is available
     */
    canUndo() {
        return this.currentIndex > 0;
    },

    /**
     * Check if redo is available
     */
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    },
};

window.EditUndo = EditUndo;
