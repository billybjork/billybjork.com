/**
 * Three.js Configuration
 * Default configuration values and constants for point cloud and depth mesh rendering
 */

import type { PointCloudConfig, DepthMeshConfig } from './types';
import { PointShape, ColorMode } from './types';

// ========== Constants ==========

export const SPRITE_BASE_PATH = '/static/test/rgbd-sprites';
export const DEFAULT_RESOLUTION = '640x360';

// Camera and scene constants
export const PLANE_WIDTH = 80.0;
export const PLANE_HEIGHT = 45.0;
export const CAMERA_FOV = 50;
export const CAMERA_Z = 100;

// Rendering constants
export const TILT_ORBIT_VERTICAL_SCALE = 1.0;
export const PAN_Y_CAMERA_INFLUENCE = 0.25;
export const PAN_Y_LOOK_INFLUENCE = 0.15;
export const CLOUD_FILL_FACTOR = 0.96;
export const RENDER_MARGIN = 180;

// Animation constants
export const DEBUG_UI_UPDATE_MS = 100;
export const DENSITY_REBUILD_DEBOUNCE_MS = 120;
export const ACTIVE_SCROLL_RECT_REFRESH_MS = 140;
export const STARTUP_STABILIZE_MS = 900;
export const SCROLL_SPEED_SMOOTHING = 0.35;

// ========== Default Configurations ==========

export const DEFAULT_POINT_CLOUD_CONFIG: PointCloudConfig = {
  // Base settings (these are the "edge" / exploded values)
  pointDensity: 0.5,
  pointSize: 2.0,
  depthAmount: 25,          // Depth at edges (exploded)
  tiltRange: 20,
  mouseParallax: 12,

  // Viewport coherence - interpolation between edge (exploded) and center (coherent)
  depthAmountCenter: 8,     // Depth at center (coherent) - flatter, clearer
  edgeScatterCenter: 0,     // Scatter at center (coherent) - no scatter, clean
  opacityEdge: 0.85,        // Opacity at edges - slightly transparent/ethereal
  transitionCurve: 0.6,     // Power curve: <1 = wider center zone, >1 = narrower

  // Point cloud style
  pointShape: PointShape.Soft,
  sizeAttenuation: true,
  depthSizing: 1.2,
  opacity: 1.0,             // Opacity at center (coherent) - full opacity
  depthOpacity: false,

  // Creative effects (these are the "edge" / exploded values)
  edgeScatter: 0.8,         // Scatter at edges (exploded) - high dispersion
  edgeThreshold: 0.15,
  dofEnable: false,
  dofFocal: 0.5,
  dofStrength: 1.0,

  // Color mode
  colorMode: ColorMode.Original,

  // Debug
  showDepth: false,
  showEdges: false,
  showDensity: false,
};

export const DEFAULT_DEPTH_MESH_CONFIG: DepthMeshConfig = {
  depthAmount: 25,
  tiltRange: 20,
  meshSegments: 150,

  // Edge handling
  edgeThreshold: 0.15,
  edgeSoftness: 2.0,
  edgeAwareExtrusion: false,
  edgeFade: false,
  normalShading: false,

  // Debug
  showDepth: false,
  showEdges: false,
  showNormals: false,
};

// ========== Reduced Motion Config ==========

export const REDUCED_MOTION_OVERRIDES: Partial<PointCloudConfig> = {
  tiltRange: 0,
  mouseParallax: 0,
  edgeScatter: 0,
  edgeScatterCenter: 0,
  opacityEdge: 1,
};

// ========== Config Utilities ==========

/**
 * Create a config object with defaults merged with overrides
 */
export function createPointCloudConfig(overrides?: Partial<PointCloudConfig>): PointCloudConfig {
  return { ...DEFAULT_POINT_CLOUD_CONFIG, ...overrides };
}

/**
 * Create a depth mesh config with defaults merged with overrides
 */
export function createDepthMeshConfig(overrides?: Partial<DepthMeshConfig>): DepthMeshConfig {
  return { ...DEFAULT_DEPTH_MESH_CONFIG, ...overrides };
}

/**
 * Apply reduced motion preferences to config
 */
export function applyReducedMotion(config: PointCloudConfig, isReduced: boolean): PointCloudConfig {
  if (isReduced) {
    return {
      ...config,
      ...REDUCED_MOTION_OVERRIDES,
      // Also set depth to center value for reduced motion
      depthAmount: config.depthAmountCenter,
    };
  }
  return config;
}

/**
 * Convert kebab-case string to camelCase
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Point shape string to enum value
 */
export function parsePointShape(shape: string): PointShape {
  const shapes: Record<string, PointShape> = {
    soft: PointShape.Soft,
    circle: PointShape.Circle,
    square: PointShape.Square,
  };
  return shapes[shape] ?? PointShape.Soft;
}

/**
 * Color mode string to enum value
 */
export function parseColorMode(mode: string): ColorMode {
  const modes: Record<string, ColorMode> = {
    original: ColorMode.Original,
    depth: ColorMode.Depth,
    normal: ColorMode.Normal,
    blend: ColorMode.Blend,
  };
  return modes[mode] ?? ColorMode.Original;
}
