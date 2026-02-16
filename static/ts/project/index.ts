/**
 * Project Bundle Entry Point
 * Loaded on all pages - handles project interactions and navigation
 */

import ProjectLoader from './loader';
import ProjectInteractions from './interactions';

// Initialize modules
ProjectInteractions.init();
ProjectLoader.init();

// Export for window globals
export { ProjectLoader, ProjectInteractions };

// Re-export types
export type * from '../types/events';
