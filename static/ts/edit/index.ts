/**
 * Edit Bundle Entry Point
 * Loaded in dev mode only - handles edit mode functionality
 */

import { EditUtils } from '../core/utils';
import EditBlocks from './blocks';
import EditMode from './mode';
import EditMedia from './media';
import EditSlash from './slash';
import EditUndo from './undo';
import EditBootstrap from './bootstrap';
import ProjectSettings from './project-settings';
import ProjectCreate from './project-create';

// Expose modules to window for backwards compatibility
if (typeof window !== 'undefined') {
  window.EditMode = EditMode;
  window.ProjectSettings = ProjectSettings;
  window.ProjectCreate = ProjectCreate;
}

// Initialize bootstrap (which handles edit mode activation)
EditBootstrap.init();

// Export modules
export {
  EditUtils,
  EditBlocks,
  EditMode,
  EditMedia,
  EditSlash,
  EditUndo,
  EditBootstrap,
  ProjectSettings,
  ProjectCreate,
};

// Re-export types
export type * from '../types/blocks';
export type * from '../types/api';
