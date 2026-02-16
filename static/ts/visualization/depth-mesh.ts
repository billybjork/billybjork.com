/**
 * Depth Mesh Thumbnail
 * Individual depth mesh visualization using displacement mapping
 */

import * as THREE from 'three';
import type { SpriteSet, DepthMeshConfig, DebugElements, SpriteMetadata, DepthMeshUniforms, ShaderUniforms } from './types';
import { depthMeshVertexShader, depthMeshFragmentShader, wireframeFragmentShader } from './shaders';
import { DEFAULT_RESOLUTION, createDepthMeshConfig } from './config';

// ========== DepthMeshThumbnail Class ==========

export class DepthMeshThumbnail {
  public canvas: HTMLCanvasElement;
  public container: HTMLElement;
  public spriteId: string;
  public currentTilt = 0;
  public viewportPosition = 0.5;

  private spriteSets: Record<string, SpriteSet>;
  private config: DepthMeshConfig;
  private resolution: string;
  private showWireframe = false;

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private mesh: THREE.Mesh | null = null;
  private wireframeMesh: THREE.Mesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private wireframeMaterial: THREE.ShaderMaterial | null = null;
  private debugElements: DebugElements | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    spriteId: string,
    spriteSets: Record<string, SpriteSet>,
    config?: Partial<DepthMeshConfig>,
    resolution = DEFAULT_RESOLUTION
  ) {
    this.canvas = canvas;
    this.container = canvas.parentElement as HTMLElement;
    this.spriteId = spriteId;
    this.spriteSets = spriteSets;
    this.config = createDepthMeshConfig(config);
    this.resolution = resolution;

    // Initialize debug elements
    const debug = this.container.querySelector('.thumbnail-debug');
    if (debug) {
      this.debugElements = {
        tiltAngle: debug.querySelector('.tilt-angle'),
        frameNum: debug.querySelector('.frame-num'),
        frameTotal: debug.querySelector('.frame-total'),
      };
    }

    // Initialize Three.js
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 100);

    this.updateSize();
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
  updateConfig(config: Partial<DepthMeshConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set wireframe visibility
   */
  setWireframe(show: boolean): void {
    this.showWireframe = show;
  }

  /**
   * Create the depth mesh
   */
  createMesh(): void {
    const spriteData = this.spriteData;
    if (!spriteData) return;

    const { metadata, rgbTexture, depthTexture } = spriteData;
    const res = metadata.resolutions[this.resolution];
    if (!res) return;

    const aspect = res.frame_width / res.frame_height;
    const segmentsX = this.config.meshSegments;
    const segmentsY = Math.round(segmentsX / aspect);

    const planeWidth = 80;
    const planeHeight = planeWidth / aspect;
    const geometry = new THREE.PlaneGeometry(
      planeWidth, planeHeight, segmentsX, segmentsY
    );

    // Main material
    this.material = new THREE.ShaderMaterial({
      vertexShader: depthMeshVertexShader,
      fragmentShader: depthMeshFragmentShader,
      uniforms: {
        rgbAtlas: { value: rgbTexture },
        depthAtlas: { value: depthTexture },
        frameIndex: { value: 0.0 },
        atlasSize: { value: new THREE.Vector2(res.sheet_width, res.sheet_height) },
        frameSize: { value: new THREE.Vector2(res.frame_width, res.frame_height) },
        columns: { value: metadata.columns },
        extrusionAmount: { value: this.config.depthAmount },
        edgeThreshold: { value: this.config.edgeThreshold },
        edgeSoftness: { value: this.config.edgeSoftness },
        edgeAwareExtrusion: { value: this.config.edgeAwareExtrusion },
        edgeFade: { value: this.config.edgeFade },
        normalShading: { value: this.config.normalShading },
        lightDir: { value: new THREE.Vector3(0.3, 0.5, 1.0).normalize() },
        showDepth: { value: this.config.showDepth },
        showEdges: { value: this.config.showEdges },
        showNormals: { value: this.config.showNormals },
      },
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.mesh);

    // Wireframe material
    this.wireframeMaterial = new THREE.ShaderMaterial({
      vertexShader: depthMeshVertexShader,
      fragmentShader: wireframeFragmentShader,
      uniforms: {
        depthAtlas: { value: depthTexture },
        frameIndex: { value: 0.0 },
        atlasSize: { value: new THREE.Vector2(res.sheet_width, res.sheet_height) },
        frameSize: { value: new THREE.Vector2(res.frame_width, res.frame_height) },
        columns: { value: metadata.columns },
        extrusionAmount: { value: this.config.depthAmount },
        edgeThreshold: { value: this.config.edgeThreshold },
        edgeAwareExtrusion: { value: this.config.edgeAwareExtrusion },
      },
      wireframe: true,
      transparent: true,
      depthTest: false,
    });

    this.wireframeMesh = new THREE.Mesh(geometry.clone(), this.wireframeMaterial);
    this.wireframeMesh.visible = false;
    this.scene.add(this.wireframeMesh);

    // Update frame total in debug
    if (this.debugElements?.frameTotal) {
      this.debugElements.frameTotal.textContent = String(metadata.frames);
    }
  }

  /**
   * Update viewport position based on element's position in viewport
   */
  updateViewportPosition(): void {
    const rect = this.container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const elementCenter = rect.top + rect.height / 2;
    this.viewportPosition = 1 - (elementCenter / viewportHeight);
    this.viewportPosition = Math.max(-0.2, Math.min(1.2, this.viewportPosition));
  }

  /**
   * Update the thumbnail for a single frame
   */
  update(globalProgress: number): void {
    if (!this.material || !this.metadata) return;

    const config = this.config;
    const metadata = this.metadata;

    // Calculate frame index
    let frameIndex = Math.floor(globalProgress) % metadata.frames;
    if (frameIndex < 0) frameIndex += metadata.frames;

    this.updateViewportPosition();

    // Calculate tilt based on viewport position
    const targetTilt = (this.viewportPosition - 0.5) * 2 * config.tiltRange;
    this.currentTilt += (targetTilt - this.currentTilt) * 0.12;

    // Update main material uniforms
    const u = this.material.uniforms as DepthMeshUniforms;
    u.frameIndex.value = frameIndex;
    u.extrusionAmount.value = config.depthAmount;
    u.edgeThreshold.value = config.edgeThreshold;
    u.edgeSoftness.value = config.edgeSoftness;
    u.edgeAwareExtrusion.value = config.edgeAwareExtrusion;
    u.edgeFade.value = config.edgeFade;
    u.normalShading.value = config.normalShading;
    u.showDepth.value = config.showDepth;
    u.showEdges.value = config.showEdges;
    u.showNormals.value = config.showNormals;

    // Update wireframe material uniforms
    if (this.wireframeMaterial) {
      const wu = this.wireframeMaterial.uniforms as ShaderUniforms;
      wu.frameIndex!.value = frameIndex;
      wu.extrusionAmount!.value = config.depthAmount;
      wu.edgeThreshold!.value = config.edgeThreshold;
      wu.edgeAwareExtrusion!.value = config.edgeAwareExtrusion;
    }

    if (this.wireframeMesh) {
      this.wireframeMesh.visible = this.showWireframe;
    }

    // Position camera based on tilt
    const tiltRad = THREE.MathUtils.degToRad(this.currentTilt);
    const distance = 100;
    this.camera.position.y = Math.sin(tiltRad) * distance * 0.5;
    this.camera.position.z = Math.cos(tiltRad) * distance;
    this.camera.lookAt(0, 0, config.depthAmount / 2);

    // Update debug display
    if (this.debugElements?.tiltAngle) {
      this.debugElements.tiltAngle.textContent = this.currentTilt.toFixed(1) + '°';
    }
    if (this.debugElements?.frameNum) {
      this.debugElements.frameNum.textContent = String(frameIndex + 1);
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Update size when container resizes
   */
  updateSize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.wireframeMesh) {
      this.scene.remove(this.wireframeMesh);
      this.wireframeMesh.geometry.dispose();
      this.wireframeMesh = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    if (this.wireframeMaterial) {
      this.wireframeMaterial.dispose();
      this.wireframeMaterial = null;
    }
    this.renderer.dispose();
  }
}
