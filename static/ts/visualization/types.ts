/**
 * Three.js Visualization Types
 * Type definitions for point cloud and depth mesh rendering
 */

import type * as THREE from 'three';

// ========== Sprite Sheet Types ==========

export interface SpriteResolution {
  frame_width: number;
  frame_height: number;
  sheet_width: number;
  sheet_height: number;
  rgb_file: string;
  depth_file: string;
}

export interface SpriteMetadata {
  name: string;
  frames: number;
  columns: number;
  rows: number;
  resolutions: Record<string, SpriteResolution>;
}

export interface SpriteSet {
  metadata: SpriteMetadata;
  rgbTexture: THREE.Texture;
  depthTexture: THREE.Texture;
}

// ========== Point Cloud Config Types ==========

export interface PointCloudConfig {
  // Base settings (these are the "edge" / exploded values)
  pointDensity: number;
  pointSize: number;
  depthAmount: number;          // Depth at edges (exploded)
  tiltRange: number;
  mouseParallax: number;

  // Viewport coherence - interpolation between edge (exploded) and center (coherent)
  depthAmountCenter: number;    // Depth at center (coherent) - flatter, clearer
  edgeScatterCenter: number;    // Scatter at center (coherent) - no scatter, clean
  opacityEdge: number;          // Opacity at edges - slightly transparent/ethereal
  transitionCurve: number;      // Power curve: <1 = wider center zone, >1 = narrower

  // Point cloud style
  pointShape: PointShape;       // 0 = soft, 1 = circle, 2 = square
  sizeAttenuation: boolean;
  depthSizing: number;
  opacity: number;              // Opacity at center (coherent) - full opacity
  depthOpacity: boolean;

  // Creative effects (these are the "edge" / exploded values)
  edgeScatter: number;          // Scatter at edges (exploded) - high dispersion
  edgeThreshold: number;
  dofEnable: boolean;
  dofFocal: number;
  dofStrength: number;

  // Color mode
  colorMode: ColorMode;         // 0 = original, 1 = depth, 2 = normal, 3 = blend

  // Debug
  showDepth: boolean;
  showEdges: boolean;
  showDensity: boolean;
}

export enum PointShape {
  Soft = 0,
  Circle = 1,
  Square = 2,
}

export enum ColorMode {
  Original = 0,
  Depth = 1,
  Normal = 2,
  Blend = 3,
}

// ========== Depth Mesh Config Types ==========

export interface DepthMeshConfig {
  depthAmount: number;
  tiltRange: number;
  meshSegments: number;

  // Edge handling
  edgeThreshold: number;
  edgeSoftness: number;
  edgeAwareExtrusion: boolean;
  edgeFade: boolean;
  normalShading: boolean;

  // Debug
  showDepth: boolean;
  showEdges: boolean;
  showNormals: boolean;
}

// ========== Render State Types ==========

export interface RenderState {
  width: number;
  height: number;
  renderedCount: number;
}

export interface ThumbnailRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

// ========== Debug Element Types ==========

export interface DebugElements {
  tiltAngle: HTMLElement | null;
  frameNum: HTMLElement | null;
  frameTotal: HTMLElement | null;
  coherenceVal?: HTMLElement | null;
}

// ========== Event Listener Management ==========

export interface ManagedListener {
  target: EventTarget;
  type: string;
  handler: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}

// ========== Geometry Cache ==========

export interface GeometryCacheEntry {
  geometry: THREE.BufferGeometry;
  refs: number;
}

// ========== Shader Uniform Types ==========

// Use a more permissive type for uniforms that's compatible with Three.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShaderUniforms = Record<string, { value: any }>;

export interface PointCloudUniforms extends ShaderUniforms {
  rgbAtlas: { value: THREE.Texture | null };
  depthAtlas: { value: THREE.Texture | null };
  frameIndex: { value: number };
  atlasSize: { value: THREE.Vector2 };
  frameSize: { value: THREE.Vector2 };
  columns: { value: number };
  depthAmount: { value: number };
  pointSize: { value: number };
  depthSizing: { value: number };
  attenuationBase: { value: number };
  sizeAttenuation: { value: boolean };
  edgeScatter: { value: number };
  edgeThreshold: { value: number };
  time: { value: number };
  opacity: { value: number };
  depthOpacity: { value: boolean };
  pointShape: { value: number };
  colorMode: { value: number };
  showDepth: { value: boolean };
  showEdges: { value: boolean };
  showDensity: { value: boolean };
  dofEnable: { value: boolean };
  dofFocal: { value: number };
  dofStrength: { value: number };
}

export interface DepthMeshUniforms extends ShaderUniforms {
  rgbAtlas: { value: THREE.Texture | null };
  depthAtlas: { value: THREE.Texture | null };
  frameIndex: { value: number };
  atlasSize: { value: THREE.Vector2 };
  frameSize: { value: THREE.Vector2 };
  columns: { value: number };
  extrusionAmount: { value: number };
  edgeThreshold: { value: number };
  edgeSoftness: { value: number };
  edgeAwareExtrusion: { value: boolean };
  edgeFade: { value: boolean };
  normalShading: { value: boolean };
  lightDir: { value: THREE.Vector3 };
  showDepth: { value: boolean };
  showEdges: { value: boolean };
  showNormals: { value: boolean };
}

// ========== Initialization Options ==========

export interface PointCloudInitOptions {
  canvasId?: string;
  spriteBasePath?: string;
  resolution?: string;
  config?: Partial<PointCloudConfig>;
}

export interface DepthMeshInitOptions {
  spriteBasePath?: string;
  resolution?: string;
  config?: Partial<DepthMeshConfig>;
}
