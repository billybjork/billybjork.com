/**
 * Shared Renderer
 * Single WebGL context shared across multiple point cloud thumbnails
 */

import * as THREE from 'three';
import type { RenderState, ThumbnailRect } from './types';
import { CAMERA_FOV, CAMERA_Z } from './config';

// ========== Types ==========

export interface RenderableItem {
  thumb: {
    setVisible(visible: boolean): void;
    update(globalProgress: number, time: number, rect: ThumbnailRect): void;
  };
  rect: ThumbnailRect;
}

// ========== SharedRenderer Class ==========

export class SharedRenderer {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;

  private renderState: RenderState = {
    width: 0,
    height: 0,
    renderedCount: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000);
    this.camera.position.set(0, 0, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.resize();
  }

  /**
   * Get current render state
   */
  getRenderState(): RenderState {
    return { ...this.renderState };
  }

  /**
   * Get rendered count from last frame
   */
  getRenderedCount(): number {
    return this.renderState.renderedCount;
  }

  /**
   * Resize the renderer to match window dimensions
   */
  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    if (
      this.renderState.width !== width ||
      this.renderState.height !== height ||
      this.renderer.getPixelRatio() !== pixelRatio
    ) {
      this.renderState.width = width;
      this.renderState.height = height;
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / Math.max(height, 1);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Render all visible thumbnails
   */
  render(renderables: RenderableItem[], globalProgress: number, time: number): void {
    this.resize();

    const renderer = this.renderer;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.renderState.width, this.renderState.height);
    renderer.clear(true, true, true);
    this.camera.updateMatrixWorld(true);

    if (renderables.length === 0) {
      this.renderState.renderedCount = 0;
      return;
    }

    renderables.forEach(({ thumb, rect }) => {
      thumb.setVisible(true);
      thumb.update(globalProgress, time, rect);
    });

    renderer.render(this.scene, this.camera);
    this.renderState.renderedCount = renderables.length;
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    // Clear the scene
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0];
      if (child) {
        this.scene.remove(child);
      }
    }

    // Force context loss to release WebGL resources
    if (typeof this.renderer.forceContextLoss === 'function') {
      this.renderer.forceContextLoss();
    }
    this.renderer.dispose();
  }
}

// ========== WebGL Support Detection ==========

/**
 * Check if WebGL is supported
 */
export function supportsWebGL(): boolean {
  const canvas = document.createElement('canvas');
  return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
}

// ========== Geometry Cache ==========

import type { GeometryCacheEntry } from './types';

const geometryCache = new Map<string, GeometryCacheEntry>();

/**
 * Generate a cache key for geometry based on dimensions and density
 */
export function getGeometryCacheKey(frameWidth: number, frameHeight: number, density: number): string {
  const stride = Math.max(1, Math.round(1 / density));
  return `${frameWidth}x${frameHeight}@${stride}`;
}

/**
 * Build point geometry for a given resolution and density
 */
export function buildPointGeometry(frameWidth: number, frameHeight: number, density: number): THREE.BufferGeometry {
  const stride = Math.max(1, Math.round(1 / density));
  const pointsX = Math.ceil(frameWidth / stride);
  const pointsY = Math.ceil(frameHeight / stride);
  const pointCount = pointsX * pointsY;

  const uvs = new Float32Array(pointCount * 2);
  let idx = 0;
  for (let y = 0; y < pointsY; y++) {
    for (let x = 0; x < pointsX; x++) {
      uvs[idx++] = (x * stride + stride / 2) / frameWidth;
      uvs[idx++] = (y * stride + stride / 2) / frameHeight;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('pixelUV', new THREE.BufferAttribute(uvs, 2));
  const positions = new Float32Array(pointCount * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  return geometry;
}

/**
 * Acquire a shared geometry from the cache, creating if necessary
 */
export function acquireSharedGeometry(
  frameWidth: number,
  frameHeight: number,
  density: number
): { key: string; geometry: THREE.BufferGeometry } {
  const key = getGeometryCacheKey(frameWidth, frameHeight, density);
  let entry = geometryCache.get(key);

  if (!entry) {
    entry = {
      geometry: buildPointGeometry(frameWidth, frameHeight, density),
      refs: 0,
    };
    geometryCache.set(key, entry);
  }

  entry.refs += 1;
  return { key, geometry: entry.geometry };
}

/**
 * Release a shared geometry back to the cache
 */
export function releaseSharedGeometry(key: string | null): void {
  if (!key) return;

  const entry = geometryCache.get(key);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.geometry.dispose();
    geometryCache.delete(key);
  }
}

/**
 * Clear all cached geometries
 */
export function clearGeometryCache(): void {
  geometryCache.forEach((entry) => {
    entry.geometry.dispose();
  });
  geometryCache.clear();
}
