/**
 * Three.js Visualization Bundle Entry Point
 * Provides point cloud and depth mesh visualizations for sprite sheets
 */

import * as THREE from 'three';
import type {
  SpriteSet,
  SpriteMetadata,
  PointCloudConfig,
  DepthMeshConfig,
  ThumbnailRect,
  ManagedListener,
  PointCloudInitOptions,
  DepthMeshInitOptions,
} from './types';
import { PointShape, ColorMode } from './types';
import {
  SPRITE_BASE_PATH,
  DEFAULT_RESOLUTION,
  DEFAULT_POINT_CLOUD_CONFIG,
  DEFAULT_DEPTH_MESH_CONFIG,
  RENDER_MARGIN,
  DEBUG_UI_UPDATE_MS,
  DENSITY_REBUILD_DEBOUNCE_MS,
  ACTIVE_SCROLL_RECT_REFRESH_MS,
  STARTUP_STABILIZE_MS,
  SCROLL_SPEED_SMOOTHING,
  createPointCloudConfig,
  createDepthMeshConfig,
  applyReducedMotion,
  toCamelCase,
  parsePointShape,
  parseColorMode,
} from './config';
import { SharedRenderer, supportsWebGL, clearGeometryCache } from './shared-renderer';
import { PointCloudThumbnail } from './point-cloud';
import { DepthMeshThumbnail } from './depth-mesh';

// ========== Global State ==========

const spriteSets: Record<string, SpriteSet> = {};
const managedListeners: ManagedListener[] = [];
let pointCloudThumbnails: PointCloudThumbnail[] = [];
let depthMeshThumbnails: DepthMeshThumbnail[] = [];
let sharedRenderer: SharedRenderer | null = null;
let config: PointCloudConfig = { ...DEFAULT_POINT_CLOUD_CONFIG };
let hasWebGL = true;
let isDisposed = false;

// Observer references
let resizeObserver: ResizeObserver | null = null;
let intersectionObserver: IntersectionObserver | null = null;

// Animation state
let renderFrameId: number | null = null;
let animationFrameId: number | null = null;
let animationProgress = 0;
let animationSpeed = 0;
let lastScrollTop = 0;
let lastScrollEventTime = Date.now();
let startupStabilizeUntilMs = Date.now() + STARTUP_STABILIZE_MS;
let lastAnimationFrameTime = Date.now();
let rectsNeedUpdate = true;
let lastGlobalStatsUpdateMs = 0;
let densityRebuildTimer: ReturnType<typeof setTimeout> | null = null;

// Input state
let globalMouseX = 0;
let globalMouseY = 0;
let deviceX = 0;
let deviceY = 0;
let hasDeviceOrientation = false;

// Motion preference
const prefersReducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
let prefersReducedMotion = prefersReducedMotionMedia.matches;
let prefersReducedMotionListener: ((event: MediaQueryListEvent) => void) | null = null;

// Container tracking
const thumbnailByContainer = new Map<HTMLElement, PointCloudThumbnail>();

// ========== Event Listener Management ==========

function addManagedEventListener(
  target: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
): void {
  target.addEventListener(type, handler, options);
  managedListeners.push({ target, type, handler, options });
}

function removeManagedEventListeners(): void {
  managedListeners.forEach(({ target, type, handler, options }) => {
    target.removeEventListener(type, handler, options);
  });
  managedListeners.length = 0;
}

// ========== Sprite Loading ==========

async function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

async function loadSpriteSet(spriteId: string, basePath = SPRITE_BASE_PATH): Promise<SpriteSet | null> {
  const spritePath = `${basePath}/${spriteId}`;

  let metadata: SpriteMetadata;
  try {
    const response = await fetch(`${spritePath}/metadata.json`);
    metadata = await response.json();
  } catch (err) {
    console.error(`Failed to load metadata for ${spriteId}:`, err);
    return null;
  }

  const loader = new THREE.TextureLoader();
  const res = metadata.resolutions[DEFAULT_RESOLUTION];

  if (!res) {
    console.error(`Resolution ${DEFAULT_RESOLUTION} not found for ${spriteId}`);
    return null;
  }

  const [rgbTexture, depthTexture] = await Promise.all([
    loadTexture(loader, `${spritePath}/${res.rgb_file}`),
    loadTexture(loader, `${spritePath}/${res.depth_file}`),
  ]);

  [rgbTexture, depthTexture].forEach(tex => {
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
  });

  console.log(`Loaded sprite set: ${spriteId} (${metadata.frames} frames)`);
  return { metadata, rgbTexture, depthTexture };
}

// ========== Motion Preference ==========

function applyMotionPreference(isReduced: boolean): void {
  prefersReducedMotion = isReduced;

  if (isReduced) {
    config = applyReducedMotion(config, true);
    animationSpeed = 0;
  } else {
    config = applyReducedMotion(config, false);
  }

  pointCloudThumbnails.forEach(thumb => {
    thumb.setReducedMotion(isReduced);
    thumb.updateConfig(config);
  });
}

// ========== Input Tracking ==========

function setupGlobalMouseTracking(): void {
  addManagedEventListener(window, 'mousemove', ((e: MouseEvent) => {
    globalMouseX = (e.clientX / window.innerWidth) * 2 - 1;
    globalMouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }) as EventListener, { passive: true });

  addManagedEventListener(window, 'mouseleave', () => {
    globalMouseX = 0;
    globalMouseY = 0;
  }, { passive: true });
}

function enableDeviceOrientation(): void {
  addManagedEventListener(window, 'deviceorientation', ((e: DeviceOrientationEvent) => {
    if (e.gamma !== null && e.beta !== null && (Math.abs(e.gamma) > 1 || Math.abs(e.beta) > 1)) {
      hasDeviceOrientation = true;
      deviceX = Math.max(-1, Math.min(1, (e.gamma || 0) / 45));
      deviceY = Math.max(-1, Math.min(1, (e.beta || 0) / 45));
    }
  }) as EventListener);
}

function setupDeviceOrientation(): void {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouchDevice) return;

  if (window.DeviceOrientationEvent) {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      const requestPermission = (): void => {
        (DeviceOrientationEvent as any).requestPermission()
          .then((response: string) => {
            if (response === 'granted') {
              enableDeviceOrientation();
            }
          })
          .catch(console.error);
      };
      addManagedEventListener(document.body, 'click', requestPermission, { once: true });
    } else {
      enableDeviceOrientation();
    }
  }
}

// ========== Viewport Observation ==========

function refreshRenderableThumbnails(): void {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  pointCloudThumbnails.forEach((thumb) => {
    if (intersectionObserver && !thumb.isInViewportMargin) {
      thumb.isRenderable = false;
      return;
    }

    const rect = thumb.container.getBoundingClientRect();
    thumb.cachedRect = rect as ThumbnailRect;
    thumb.isRenderable =
      rect.bottom > -RENDER_MARGIN &&
      rect.top < viewportHeight + RENDER_MARGIN &&
      rect.right > -RENDER_MARGIN &&
      rect.left < viewportWidth + RENDER_MARGIN;
  });

  rectsNeedUpdate = false;
}

function setupThumbnailObservers(): void {
  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const thumb = thumbnailByContainer.get(entry.target as HTMLElement);
        if (!thumb) return;

        thumb.isInViewportMargin = entry.isIntersecting;
        if (entry.isIntersecting) {
          thumb.cachedRect = entry.boundingClientRect as ThumbnailRect;
        } else {
          thumb.isRenderable = false;
        }
      });
      rectsNeedUpdate = true;
    }, {
      root: null,
      rootMargin: `${RENDER_MARGIN}px 0px ${RENDER_MARGIN}px 0px`,
      threshold: 0,
    });

    pointCloudThumbnails.forEach((thumb) => intersectionObserver?.observe(thumb.container));
  } else {
    pointCloudThumbnails.forEach((thumb) => {
      thumb.isInViewportMargin = true;
    });
  }

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const thumb = thumbnailByContainer.get(entry.target as HTMLElement);
        if (!thumb) return;
        thumb.cachedRect = thumb.container.getBoundingClientRect() as ThumbnailRect;
      });
      rectsNeedUpdate = true;
    });
    pointCloudThumbnails.forEach((thumb) => resizeObserver?.observe(thumb.container));
  }
}

// ========== Animation Loop ==========

function startAnimationLoop(): void {
  if (isDisposed) return;
  if (animationFrameId !== null || document.hidden) return;
  lastAnimationFrameTime = Date.now();
  animationFrameId = requestAnimationFrame(animationLoop);
}

function stopAnimationLoop(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function animationLoop(): void {
  if (isDisposed || document.hidden) {
    stopAnimationLoop();
    return;
  }

  const now = Date.now();
  const deltaTime = (now - lastAnimationFrameTime) / 1000;
  lastAnimationFrameTime = now;

  const baseDeceleration = 15;
  const speedFactor = Math.abs(animationSpeed) * 0.1;
  const dynamicDeceleration = baseDeceleration + speedFactor;

  if (animationSpeed > 0) {
    animationSpeed = Math.max(0, animationSpeed - dynamicDeceleration * deltaTime);
  } else if (animationSpeed < 0) {
    animationSpeed = Math.min(0, animationSpeed + dynamicDeceleration * deltaTime);
  }

  animationProgress += animationSpeed * deltaTime;
  if (animationProgress > 1e6) animationProgress -= 1e6;
  if (animationProgress < -1e6) animationProgress += 1e6;

  if (Math.abs(animationSpeed) > 0.01) {
    animationFrameId = requestAnimationFrame(animationLoop);
  } else {
    animationSpeed = 0;
    stopAnimationLoop();
  }
}

function renderLoop(): void {
  if (isDisposed) return;
  renderFrameId = requestAnimationFrame(renderLoop);

  if (!hasWebGL || !sharedRenderer || pointCloudThumbnails.length === 0) return;

  const now = Date.now();
  const shouldForceRectRefresh =
    now < startupStabilizeUntilMs ||
    (now - lastScrollEventTime) < ACTIVE_SCROLL_RECT_REFRESH_MS;

  if (rectsNeedUpdate || shouldForceRectRefresh) {
    refreshRenderableThumbnails();
  }

  const time = performance.now() / 1000;
  const renderables: { thumb: PointCloudThumbnail; rect: ThumbnailRect }[] = [];

  pointCloudThumbnails.forEach((thumb) => {
    if (thumb.isRenderable && thumb.cachedRect) {
      renderables.push({ thumb, rect: thumb.cachedRect });
    } else {
      thumb.setVisible(false);
    }
  });

  // Render with input state
  renderables.forEach(({ thumb, rect }) => {
    thumb.setVisible(true);
    thumb.update(
      animationProgress,
      time,
      rect,
      globalMouseX,
      globalMouseY,
      hasDeviceOrientation,
      deviceX,
      deviceY
    );
  });

  if (sharedRenderer) {
    sharedRenderer.renderer.render(sharedRenderer.scene, sharedRenderer.camera);
  }

  // Update global stats
  const nowMs = performance.now();
  if (nowMs - lastGlobalStatsUpdateMs >= DEBUG_UI_UPDATE_MS) {
    setGlobalStat('global-speed', animationSpeed.toFixed(1));
    setGlobalStat('render-count', String(renderables.length));
    lastGlobalStatsUpdateMs = nowMs;
  }
}

// ========== Event Handlers ==========

function handleScroll(): void {
  rectsNeedUpdate = true;

  if (prefersReducedMotion) {
    lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    lastScrollEventTime = Date.now();
    return;
  }

  const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const now = Date.now();
  const deltaTime = (now - lastScrollEventTime) / 1000;

  if (deltaTime > 0) {
    const scrollVelocity = (currentScrollTop - lastScrollTop) / deltaTime;
    const pixelsPerFrame = 15;
    const targetSpeed = Math.max(-30, Math.min(30, scrollVelocity / pixelsPerFrame));
    animationSpeed += (targetSpeed - animationSpeed) * SCROLL_SPEED_SMOOTHING;
  }

  lastScrollTop = currentScrollTop;
  lastScrollEventTime = now;

  if (Math.abs(animationSpeed) > 0.01) {
    startAnimationLoop();
  }
}

function handleResize(): void {
  rectsNeedUpdate = true;
  if (sharedRenderer) sharedRenderer.resize();
}

// ========== UI Helpers ==========

function setGlobalStat(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ========== Cleanup ==========

function cleanup(): void {
  if (isDisposed) return;
  isDisposed = true;

  stopAnimationLoop();
  if (renderFrameId !== null) {
    cancelAnimationFrame(renderFrameId);
    renderFrameId = null;
  }

  if (densityRebuildTimer !== null) {
    clearTimeout(densityRebuildTimer);
    densityRebuildTimer = null;
  }

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (intersectionObserver) {
    intersectionObserver.disconnect();
    intersectionObserver = null;
  }

  if (prefersReducedMotionListener) {
    prefersReducedMotionMedia.removeEventListener('change', prefersReducedMotionListener);
    prefersReducedMotionListener = null;
  }

  removeManagedEventListeners();

  pointCloudThumbnails.forEach((thumb) => thumb.destroy());
  pointCloudThumbnails = [];
  thumbnailByContainer.clear();

  depthMeshThumbnails.forEach((thumb) => thumb.dispose());
  depthMeshThumbnails = [];

  Object.values(spriteSets).forEach((set) => {
    set.rgbTexture.dispose();
    set.depthTexture.dispose();
  });
  Object.keys(spriteSets).forEach((key) => {
    delete spriteSets[key];
  });

  clearGeometryCache();

  if (sharedRenderer) {
    sharedRenderer.dispose();
    sharedRenderer = null;
  }
}

// ========== Initialization ==========

export async function initPointCloud(options: PointCloudInitOptions = {}): Promise<void> {
  const {
    canvasId = 'shared-depth-canvas',
    spriteBasePath = SPRITE_BASE_PATH,
    resolution = DEFAULT_RESOLUTION,
    config: configOverrides,
  } = options;

  config = createPointCloudConfig(configOverrides);
  applyMotionPreference(prefersReducedMotion);

  addManagedEventListener(window, 'pagehide', cleanup);
  addManagedEventListener(window, 'beforeunload', cleanup);

  if (!supportsWebGL()) {
    hasWebGL = false;
    document.body.classList.add('no-webgl');
    setGlobalStat('global-speed', 'n/a');
    setGlobalStat('render-count', '0');
    setGlobalStat('gl-context-count', '0');
    console.warn('WebGL is unavailable. Falling back to static thumbnail containers.');
    return;
  }

  try {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) {
      throw new Error(`Canvas element #${canvasId} not found`);
    }
    sharedRenderer = new SharedRenderer(canvas);
  } catch (err) {
    hasWebGL = false;
    document.body.classList.add('no-webgl');
    setGlobalStat('global-speed', 'n/a');
    setGlobalStat('render-count', '0');
    setGlobalStat('gl-context-count', '0');
    console.error('Failed to initialize shared WebGL renderer:', err);
    return;
  }

  // Find all project items with sprite data
  const projectItems = document.querySelectorAll<HTMLElement>('.project-item[data-sprite]');
  const spriteIds = [...new Set([...projectItems].map(el => el.dataset.sprite!))];

  // Load sprite sets
  console.log(`Loading ${spriteIds.length} sprite sets...`);
  const loadPromises = spriteIds.map(async id => {
    const data = await loadSpriteSet(id, spriteBasePath);
    if (data) spriteSets[id] = data;
  });
  await Promise.all(loadPromises);

  console.log(`Loaded ${Object.keys(spriteSets).length} sprite sets`);

  // Create thumbnails
  projectItems.forEach((item) => {
    const container = item.querySelector<HTMLElement>('.thumbnail-container');
    const spriteId = item.dataset.sprite;

    if (!container || !spriteId || !spriteSets[spriteId]) {
      console.warn(`Sprite set not loaded: ${spriteId}`);
      return;
    }

    const thumbnail = new PointCloudThumbnail(
      container,
      spriteId,
      sharedRenderer!,
      spriteSets,
      config,
      resolution,
      prefersReducedMotion
    );
    thumbnail.createPointCloud();
    pointCloudThumbnails.push(thumbnail);
    thumbnailByContainer.set(container, thumbnail);
  });

  console.log(`Created ${pointCloudThumbnails.length} point cloud thumbnails`);
  setGlobalStat('gl-context-count', '1');

  // Setup input tracking
  setupGlobalMouseTracking();
  setupDeviceOrientation();
  setupThumbnailObservers();
  refreshRenderableThumbnails();

  // Setup event listeners
  addManagedEventListener(window, 'resize', handleResize);
  addManagedEventListener(window, 'scroll', handleScroll, { passive: true });

  // Setup motion preference listener
  prefersReducedMotionListener = (event: MediaQueryListEvent): void => {
    applyMotionPreference(event.matches);
  };
  prefersReducedMotionMedia.addEventListener('change', prefersReducedMotionListener);

  // Setup visibility change
  addManagedEventListener(document, 'visibilitychange', () => {
    if (document.hidden) {
      stopAnimationLoop();
    } else if (Math.abs(animationSpeed) > 0.01) {
      startAnimationLoop();
    }
  });

  // Initialize scroll position
  lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;

  // Start render loop
  renderLoop();
}

export async function initDepthMesh(options: DepthMeshInitOptions = {}): Promise<void> {
  const {
    spriteBasePath = SPRITE_BASE_PATH,
    resolution = DEFAULT_RESOLUTION,
    config: configOverrides,
  } = options;

  const meshConfig = createDepthMeshConfig(configOverrides);

  // Find all project items with sprite data
  const projectItems = document.querySelectorAll<HTMLElement>('.project-item[data-sprite]');
  const spriteIds = [...new Set([...projectItems].map(el => el.dataset.sprite!))];

  // Load sprite sets
  console.log(`Loading ${spriteIds.length} sprite sets...`);
  const loadPromises = spriteIds.map(async id => {
    const data = await loadSpriteSet(id, spriteBasePath);
    if (data) spriteSets[id] = data;
  });
  await Promise.all(loadPromises);

  console.log(`Loaded ${Object.keys(spriteSets).length} sprite sets`);

  // Create thumbnails
  projectItems.forEach((item) => {
    const canvas = item.querySelector<HTMLCanvasElement>('.depth-canvas');
    const spriteId = item.dataset.sprite;

    if (!canvas || !spriteId || !spriteSets[spriteId]) {
      console.warn(`Sprite set not loaded: ${spriteId}`);
      return;
    }

    const thumbnail = new DepthMeshThumbnail(
      canvas,
      spriteId,
      spriteSets,
      meshConfig,
      resolution
    );
    thumbnail.createMesh();
    depthMeshThumbnails.push(thumbnail);
  });

  console.log(`Created ${depthMeshThumbnails.length} depth mesh thumbnails`);

  // Setup event listeners
  window.addEventListener('resize', () => {
    depthMeshThumbnails.forEach(thumb => thumb.updateSize());
  });

  window.addEventListener('scroll', handleScroll);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAnimationLoop();
    } else if (Math.abs(animationSpeed) > 0.01) {
      startAnimationLoop();
    }
  });

  // Initialize scroll position
  lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;

  // Start animation
  function animate(): void {
    requestAnimationFrame(animate);

    if (depthMeshThumbnails.length === 0) return;

    depthMeshThumbnails.forEach(thumb => thumb.update(animationProgress));
    setGlobalStat('global-speed', animationSpeed.toFixed(1));
  }

  animate();
}

// ========== Public API ==========

export function getConfig(): PointCloudConfig {
  return { ...config };
}

export function updateConfig(updates: Partial<PointCloudConfig>): void {
  config = { ...config, ...updates };
  pointCloudThumbnails.forEach(thumb => thumb.updateConfig(config));
}

export function rebuildPointClouds(): void {
  pointCloudThumbnails.forEach(thumb => thumb.rebuildPointCloud());
}

export function scheduleRebuild(): void {
  if (densityRebuildTimer !== null) {
    clearTimeout(densityRebuildTimer);
  }
  densityRebuildTimer = setTimeout(() => {
    densityRebuildTimer = null;
    rebuildPointClouds();
  }, DENSITY_REBUILD_DEBOUNCE_MS);
}

// ========== Exports ==========

export { PointCloudThumbnail } from './point-cloud';
export { DepthMeshThumbnail } from './depth-mesh';
export { SharedRenderer, supportsWebGL, clearGeometryCache } from './shared-renderer';
export * from './types';
export * from './config';
export * from './shaders';

// Window exposure for inline scripts
if (typeof window !== 'undefined') {
  (window as any).ThreeVisualization = {
    initPointCloud,
    initDepthMesh,
    getConfig,
    updateConfig,
    rebuildPointClouds,
    scheduleRebuild,
    PointShape,
    ColorMode,
    parsePointShape,
    parseColorMode,
    toCamelCase,
  };
}
