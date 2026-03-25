/**
 * Project Runtime Entry Point
 * Loaded on pages that use project-detail hydration and interactions.
 */

import ProjectInteractions from './interactions';
import { hydrateProjectDetail } from './detail-runtime';

ProjectInteractions.init();
hydrateProjectDetail();
