/**
 * Point Cloud Thumbnail
 * Individual point cloud visualization for a sprite set
 */

import * as THREE from 'three';
import type {
  SpriteSet,
  PointCloudConfig,
  ThumbnailRect,
  DebugElements,
  PointCloudUniforms,
  ManagedListener,
  SpriteMetadata,
} from './types';
import { pointCloudVertexShader, pointCloudFragmentShader } from './shaders';
import {
  DEFAULT_RESOLUTION,
  PLANE_WIDTH,
  PLANE_HEIGHT,
  CAMERA_FOV,
  CAMERA_Z,
  TILT_ORBIT_VERTICAL_SCALE,
  PAN_Y_CAMERA_INFLUENCE,
  PAN_Y_LOOK_INFLUENCE,
  CLOUD_FILL_FACTOR,
  DEBUG_UI_UPDATE_MS,
  createPointCloudConfig,
} from './config';
import {
  SharedRenderer,
  acquireSharedGeometry,
  releaseSharedGeometry,
} from './shared-renderer';

// ========== PointCloudThumbnail Class ==========

export class PointCloudThumbnail {
  public container: HTMLElement;
  public spriteId: string;
  public currentTilt = 0;
  public currentPanX = 0;
  public currentPanY = 0;
  public viewportPosition = 0.5;
  public pointCount = 0;
  public currentCoherence: number;
  public isRenderable = false;
  public isInViewportMargin = true;
  public cachedRect: ThumbnailRect | null = null;

  private sharedRenderer: SharedRenderer;
  private spriteSets: Record<string, SpriteSet>;
  private config: PointCloudConfig;
  private resolution: string;
  private prefersReducedMotion: boolean;

  private geometryKey: string | null = null;
  private lastDebugUpdateMs = 0;
  private lastLayoutWidth = -1;
  private lastLayoutHeight = -1;
  private lastLayoutLeft = Number.NaN;
  private lastLayoutTop = Number.NaN;
  private lastLayoutCanvasWidth = -1;
  private lastLayoutCanvasHeight = -1;

  private debugElements: DebugElements | null = null;
  private group: THREE.Group;
  private motionGroup: THREE.Group;
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private virtualCamera: THREE.PerspectiveCamera;
  private virtualLookTarget: THREE.Vector3;

  constructor(
    container: HTMLElement,
    spriteId: string,
    sharedRenderer: SharedRenderer,
    spriteSets: Record<string, SpriteSet>,
    config?: Partial<PointCloudConfig>,
    resolution = DEFAULT_RESOLUTION,
    prefersReducedMotion = false
  ) {
    this.container = container;
    this.spriteId = spriteId;
    this.sharedRenderer = sharedRenderer;
    this.spriteSets = spriteSets;
    this.config = createPointCloudConfig(config);
    this.resolution = resolution;
    this.prefersReducedMotion = prefersReducedMotion;
    this.currentCoherence = prefersReducedMotion ? 1 : 0;

    // Initialize debug elements
    const debug = this.container.querySelector('.thumbnail-debug');
    if (debug) {
      this.debugElements = {
        tiltAngle: debug.querySelector<HTMLElement>('.tilt-angle'),
        frameNum: debug.querySelector<HTMLElement>('.frame-num'),
        frameTotal: debug.querySelector<HTMLElement>('.frame-total'),
        coherenceVal: debug.querySelector<HTMLElement>('.coherence-val'),
      };
    }

    // Create Three.js groups
    this.group = new THREE.Group();
    this.group.visible = false;

    this.motionGroup = new THREE.Group();
    this.motionGroup.matrixAutoUpdate = false;
    this.group.add(this.motionGroup);

    sharedRenderer.scene.add(this.group);

    // Virtual camera for motion transforms
    this.virtualCamera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000);
    this.virtualLookTarget = new THREE.Vector3();
  }

  /**
   * Get the sprite data for this thumbnail
   */
  get spriteData(): SpriteSet | undefined {
    return this.spriteSets[this.spriteId];
  }

  /**
   * Get the sprite metadata
   */
  get metadata(): SpriteMetadata | undefined {
    return this.spriteData?.metadata;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PointCloudConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set reduced motion preference
   */
  setReducedMotion(prefersReducedMotion: boolean): void {
    this.prefersReducedMotion = prefersReducedMotion;
    this.currentCoherence = prefersReducedMotion ? 1 : this.currentCoherence;
  }

  /**
   * Create the point cloud mesh
   */
  createPointCloud(): void {
    const spriteData = this.spriteData;
    if (!spriteData) return;

    const { metadata, rgbTexture, depthTexture } = spriteData;
    const res = metadata.resolutions[this.resolution];
    if (!res) return;

    // Acquire shared geometry
    const shared = acquireSharedGeometry(res.frame_width, res.frame_height, this.config.pointDensity);
    this.geometryKey = shared.key;
    const geometry = shared.geometry;
    this.pointCount = geometry.getAttribute('pixelUV').count;

    // Create material with uniforms
    this.material = new THREE.ShaderMaterial({
      vertexShader: pointCloudVertexShader,
      fragmentShader: pointCloudFragmentShader,
      uniforms: {
        rgbAtlas: { value: rgbTexture },
        depthAtlas: { value: depthTexture },
        frameIndex: { value: 0.0 },
        atlasSize: { value: new THREE.Vector2(res.sheet_width, res.sheet_height) },
        frameSize: { value: new THREE.Vector2(res.frame_width, res.frame_height) },
        columns: { value: metadata.columns },
        depthAmount: { value: this.config.depthAmount },
        pointSize: { value: this.config.pointSize },
        depthSizing: { value: this.config.depthSizing },
        attenuationBase: { value: CAMERA_Z / 100 },
        sizeAttenuation: { value: this.config.sizeAttenuation },
        edgeScatter: { value: this.config.edgeScatter },
        edgeThreshold: { value: this.config.edgeThreshold },
        time: { value: 0.0 },
        opacity: { value: this.config.opacity },
        depthOpacity: { value: this.config.depthOpacity },
        pointShape: { value: this.config.pointShape },
        colorMode: { value: this.config.colorMode },
        showDepth: { value: this.config.showDepth },
        showEdges: { value: this.config.showEdges },
        showDensity: { value: this.config.showDensity },
        dofEnable: { value: this.config.dofEnable },
        dofFocal: { value: this.config.dofFocal },
        dofStrength: { value: this.config.dofStrength },
      } as PointCloudUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.motionGroup.add(this.points);

    // Update debug display
    if (this.debugElements?.frameTotal) {
      this.debugElements.frameTotal.textContent = String(metadata.frames);
    }
  }

  /**
   * Rebuild point cloud with new settings (e.g., density change)
   */
  rebuildPointCloud(): void {
    this.disposePointCloud();
    this.createPointCloud();
  }

  /**
   * Dispose of point cloud resources
   */
  private disposePointCloud(): void {
    if (this.points) {
      this.motionGroup.remove(this.points);
      this.points = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    if (this.geometryKey) {
      releaseSharedGeometry(this.geometryKey);
      this.geometryKey = null;
    }
  }

  /**
   * Destroy this thumbnail and release all resources
   */
  destroy(): void {
    this.disposePointCloud();
    if (this.group && this.sharedRenderer?.scene) {
      this.sharedRenderer.scene.remove(this.group);
    }
  }

  /**
   * Update viewport position based on element rect
   */
  updateViewportPosition(rect: ThumbnailRect): void {
    const viewportHeight = window.innerHeight;
    const elementCenter = rect.top + rect.height / 2;
    this.viewportPosition = 1 - (elementCenter / viewportHeight);
    this.viewportPosition = Math.max(-0.2, Math.min(1.2, this.viewportPosition));
  }

  /**
   * Set visibility of the group
   */
  setVisible(isVisible: boolean): void {
    if (this.group) {
      this.group.visible = isVisible;
    }
  }

  /**
   * Sync layout based on container rect
   */
  private syncLayout(rect: ThumbnailRect): void {
    if (!this.group) return;

    const renderState = this.sharedRenderer.getRenderState();
    const left = Math.floor(rect.left);
    const top = Math.floor(rect.top);
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));

    // Skip if nothing changed
    if (
      this.lastLayoutWidth === width &&
      this.lastLayoutHeight === height &&
      this.lastLayoutLeft === left &&
      this.lastLayoutTop === top &&
      this.lastLayoutCanvasWidth === renderState.width &&
      this.lastLayoutCanvasHeight === renderState.height
    ) {
      return;
    }

    this.lastLayoutWidth = width;
    this.lastLayoutHeight = height;
    this.lastLayoutLeft = left;
    this.lastLayoutTop = top;
    this.lastLayoutCanvasWidth = renderState.width;
    this.lastLayoutCanvasHeight = renderState.height;

    // Calculate position in world coordinates
    const halfFovRad = THREE.MathUtils.degToRad(CAMERA_FOV * 0.5);
    const visibleHeight = 2 * CAMERA_Z * Math.tan(halfFovRad);
    const pixelsPerWorld = renderState.height / Math.max(visibleHeight, 1e-6);
    const centerX = (left + width / 2 - renderState.width / 2) / pixelsPerWorld;
    const centerY = (renderState.height / 2 - (top + height / 2)) / pixelsPerWorld;
    const scaleX = (width * CLOUD_FILL_FACTOR) / (PLANE_WIDTH * pixelsPerWorld);
    const scaleY = (height * CLOUD_FILL_FACTOR) / (PLANE_HEIGHT * pixelsPerWorld);
    const scaleZ = (scaleX + scaleY) * 0.5;

    this.group.position.set(centerX, centerY, 0);
    this.group.scale.set(scaleX, scaleY, scaleZ);
  }

  /**
   * Update motion transform based on camera position
   */
  private updateMotionTransform(effectiveDepth: number): void {
    if (!this.motionGroup || !this.sharedRenderer?.camera) return;

    const sharedCamera = this.sharedRenderer.camera;
    if (Math.abs(this.virtualCamera.aspect - sharedCamera.aspect) > 1e-6) {
      this.virtualCamera.aspect = sharedCamera.aspect;
      this.virtualCamera.updateProjectionMatrix();
    }

    const tiltRad = THREE.MathUtils.degToRad(this.currentTilt);
    const distance = CAMERA_Z;
    const tiltY = Math.sin(tiltRad) * distance * TILT_ORBIT_VERTICAL_SCALE;
    const panY = this.currentPanY * PAN_Y_CAMERA_INFLUENCE;

    this.virtualCamera.position.x = this.currentPanX;
    this.virtualCamera.position.y = tiltY + panY;
    this.virtualCamera.position.z = Math.cos(tiltRad) * distance;

    this.virtualLookTarget.set(
      this.currentPanX * 0.3,
      this.currentPanY * PAN_Y_LOOK_INFLUENCE,
      effectiveDepth / 2
    );
    this.virtualCamera.lookAt(this.virtualLookTarget);
    this.virtualCamera.updateMatrixWorld(true);

    // Convert per-thumbnail camera view transform into model transform
    this.motionGroup.matrix
      .copy(this.sharedRenderer.camera.matrixWorld)
      .multiply(this.virtualCamera.matrixWorldInverse);
    this.motionGroup.matrixWorldNeedsUpdate = true;
  }

  /**
   * Update the thumbnail for a single frame
   */
  update(
    globalProgress: number,
    time: number,
    rect: ThumbnailRect,
    inputX = 0,
    inputY = 0,
    hasDeviceOrientation = false,
    deviceX = 0,
    deviceY = 0
  ): void {
    if (!this.material || !this.metadata) return;

    const config = this.config;
    const metadata = this.metadata;

    // Calculate frame index
    let frameIndex = Math.floor(globalProgress) % metadata.frames;
    if (frameIndex < 0) frameIndex += metadata.frames;

    this.updateViewportPosition(rect);

    // =============================================
    // Viewport-aware coherence calculation
    // =============================================
    const distanceFromCenter = Math.abs((this.viewportPosition - 0.5) * 2);
    const clampedDistance = Math.min(1, Math.max(0, distanceFromCenter));
    const curvedDistance = Math.pow(clampedDistance, config.transitionCurve);
    const targetCoherence = this.prefersReducedMotion ? 1 : (1 - curvedDistance);
    const coherenceLerp = this.prefersReducedMotion ? 1 : 0.1;
    this.currentCoherence += (targetCoherence - this.currentCoherence) * coherenceLerp;

    // Interpolate parameters based on coherence
    const effectiveDepth = config.depthAmountCenter +
      (config.depthAmount - config.depthAmountCenter) * (1 - this.currentCoherence);
    const effectiveScatter = config.edgeScatterCenter +
      (config.edgeScatter - config.edgeScatterCenter) * (1 - this.currentCoherence);
    const effectiveOpacity = config.opacityEdge +
      (config.opacity - config.opacityEdge) * this.currentCoherence;

    // =============================================
    // Camera positioning
    // =============================================
    const scrollTilt = (this.viewportPosition - 0.5) * 2 * config.tiltRange;

    // Use device orientation if available
    let effectiveInputX = inputX;
    let effectiveInputY = -inputY; // Invert Y for natural feel

    if (hasDeviceOrientation) {
      effectiveInputX = deviceX;
      effectiveInputY = deviceY;
    }

    const targetPanX = effectiveInputX * config.mouseParallax;
    const targetPanY = effectiveInputY * config.mouseParallax * 0.6;
    const targetTilt = scrollTilt;

    // Smooth interpolation
    const tiltLerp = this.prefersReducedMotion ? 1 : 0.12;
    const panLerp = this.prefersReducedMotion ? 1 : 0.15;
    this.currentTilt += (targetTilt - this.currentTilt) * tiltLerp;
    this.currentPanX += (targetPanX - this.currentPanX) * panLerp;
    this.currentPanY += (targetPanY - this.currentPanY) * panLerp;

    // =============================================
    // Update uniforms
    // =============================================
    const u = this.material.uniforms as PointCloudUniforms;
    u.frameIndex.value = frameIndex;
    u.depthAmount.value = effectiveDepth;
    u.pointSize.value = config.pointSize;
    u.depthSizing.value = config.depthSizing;
    u.sizeAttenuation.value = config.sizeAttenuation;
    u.edgeScatter.value = effectiveScatter;
    u.edgeThreshold.value = config.edgeThreshold;
    u.time.value = time;
    u.opacity.value = effectiveOpacity;
    u.depthOpacity.value = config.depthOpacity;
    u.pointShape.value = config.pointShape;
    u.colorMode.value = config.colorMode;
    u.showDepth.value = config.showDepth;
    u.showEdges.value = config.showEdges;
    u.showDensity.value = config.showDensity;
    u.dofEnable.value = config.dofEnable;
    u.dofFocal.value = config.dofFocal;
    u.dofStrength.value = config.dofStrength;

    this.syncLayout(rect);
    this.updateMotionTransform(effectiveDepth);

    // Update debug display
    const nowMs = performance.now();
    if (nowMs - this.lastDebugUpdateMs >= DEBUG_UI_UPDATE_MS) {
      if (this.debugElements?.tiltAngle) {
        this.debugElements.tiltAngle.textContent = this.currentTilt.toFixed(1) + '°';
      }
      if (this.debugElements?.frameNum) {
        this.debugElements.frameNum.textContent = String(frameIndex + 1);
      }
      if (this.debugElements?.coherenceVal) {
        this.debugElements.coherenceVal.textContent = Math.round(this.currentCoherence * 100) + '%';
      }
      this.lastDebugUpdateMs = nowMs;
    }
  }
}
