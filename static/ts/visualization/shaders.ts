/**
 * Three.js Shaders
 * GLSL vertex and fragment shaders for point cloud and depth mesh rendering
 */

// ========== Point Cloud Shaders ==========

export const pointCloudVertexShader = `
    uniform sampler2D depthAtlas;
    uniform sampler2D rgbAtlas;
    uniform float frameIndex;
    uniform vec2 atlasSize;
    uniform vec2 frameSize;
    uniform float columns;
    uniform float depthAmount;
    uniform float pointSize;
    uniform float depthSizing;
    uniform float attenuationBase;
    uniform bool sizeAttenuation;
    uniform float edgeScatter;
    uniform float edgeThreshold;
    uniform float time;

    attribute vec2 pixelUV;

    varying vec2 vUv;
    varying float vDepth;
    varying float vEdgeMask;
    varying vec3 vNormal;
    varying vec3 vColor;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    vec2 getAtlasUV(vec2 localUV, float frame) {
        vec2 clampedUV = clamp(localUV, vec2(0.001), vec2(0.999));
        float col = mod(frame, columns);
        float row = floor(frame / columns);
        vec2 flippedLocalUV = vec2(clampedUV.x, 1.0 - clampedUV.y);
        vec2 frameOffset = vec2(col * frameSize.x, row * frameSize.y);
        return (frameOffset + flippedLocalUV * frameSize) / atlasSize;
    }

    float sampleDepth(vec2 localUV) {
        vec2 depthUV = getAtlasUV(localUV, frameIndex);
        return texture2D(depthAtlas, depthUV).r;
    }

    vec3 sampleColor(vec2 localUV) {
        return texture2D(rgbAtlas, getAtlasUV(localUV, frameIndex)).rgb;
    }

    void main() {
        vUv = pixelUV;

        float depth = sampleDepth(pixelUV);
        vDepth = depth;
        vColor = sampleColor(pixelUV);

        vec2 texelSize = 1.0 / frameSize;
        float depthL = sampleDepth(pixelUV + vec2(-texelSize.x, 0.0));
        float depthR = sampleDepth(pixelUV + vec2(texelSize.x, 0.0));
        float depthU = sampleDepth(pixelUV + vec2(0.0, -texelSize.y));
        float depthD = sampleDepth(pixelUV + vec2(0.0, texelSize.y));

        float gradX = (depthR - depthL) * 0.5;
        float gradY = (depthD - depthU) * 0.5;
        float gradMag = sqrt(gradX * gradX + gradY * gradY);

        vEdgeMask = 1.0 - smoothstep(edgeThreshold * 0.5, edgeThreshold, gradMag);
        vNormal = normalize(vec3(-gradX * 10.0, -gradY * 10.0, 1.0));

        float planeWidth = 80.0;
        float planeHeight = 45.0;
        vec3 pos;
        pos.x = (pixelUV.x - 0.5) * planeWidth;
        pos.y = (pixelUV.y - 0.5) * planeHeight;
        pos.z = depth * depthAmount;

        if (edgeScatter > 0.0) {
            float frameSeed = frameIndex;
            float edgeFactor = 1.0 - vEdgeMask;
            float noiseX = hash(pixelUV + frameSeed * 0.1) * 2.0 - 1.0;
            float noiseY = hash(pixelUV.yx + frameSeed * 0.1 + 100.0) * 2.0 - 1.0;
            float noiseZ = hash(pixelUV * 2.0 + frameSeed * 0.1 + 200.0) * 2.0 - 1.0;

            float scatterAmount = edgeFactor * edgeScatter;
            pos.x += noiseX * scatterAmount * 3.0;
            pos.y += noiseY * scatterAmount * 2.0;
            pos.z += noiseZ * scatterAmount * depthAmount * 0.3;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float size = pointSize;
        size *= mix(1.0, depthSizing, depth);
        if (sizeAttenuation) {
            size *= (300.0 / -mvPosition.z) * attenuationBase;
        }

        gl_PointSize = size;
    }
`;

export const pointCloudFragmentShader = `
    uniform float opacity;
    uniform bool depthOpacity;
    uniform int pointShape; // 0 = soft, 1 = circle, 2 = square
    uniform int colorMode; // 0 = original, 1 = depth, 2 = normal, 3 = blend
    uniform bool showDepth;
    uniform bool showEdges;
    uniform bool showDensity;
    uniform bool dofEnable;
    uniform float dofFocal;
    uniform float dofStrength;

    varying vec2 vUv;
    varying float vDepth;
    varying float vEdgeMask;
    varying vec3 vNormal;
    varying vec3 vColor;

    // Viridis-like colormap for depth visualization
    vec3 viridis(float t) {
        const vec3 c0 = vec3(0.267, 0.004, 0.329);
        const vec3 c1 = vec3(0.282, 0.140, 0.457);
        const vec3 c2 = vec3(0.253, 0.265, 0.529);
        const vec3 c3 = vec3(0.191, 0.407, 0.556);
        const vec3 c4 = vec3(0.127, 0.566, 0.550);
        const vec3 c5 = vec3(0.267, 0.678, 0.480);
        const vec3 c6 = vec3(0.478, 0.761, 0.363);
        const vec3 c7 = vec3(0.741, 0.843, 0.215);
        const vec3 c8 = vec3(0.993, 0.906, 0.144);

        t = clamp(t, 0.0, 1.0);
        float idx = t * 7.0;
        int i = int(floor(idx));
        float f = fract(idx);

        if (i == 0) return mix(c0, c1, f);
        if (i == 1) return mix(c1, c2, f);
        if (i == 2) return mix(c2, c3, f);
        if (i == 3) return mix(c3, c4, f);
        if (i == 4) return mix(c4, c5, f);
        if (i == 5) return mix(c5, c6, f);
        if (i == 6) return mix(c6, c7, f);
        return mix(c7, c8, f);
    }

    void main() {
        vec2 pc = gl_PointCoord - 0.5;
        float dist = length(pc);

        // Point shape
        float alpha = 1.0;
        if (pointShape == 0) {
            // Soft/Gaussian falloff
            alpha = exp(-dist * dist * 8.0);
        } else if (pointShape == 1) {
            // Circle - hard edge
            if (dist > 0.5) discard;
        }
        // pointShape == 2 is square, no modification needed

        // Debug views
        if (showDepth) {
            gl_FragColor = vec4(vec3(vDepth), alpha * opacity);
            return;
        }

        if (showEdges) {
            float edge = 1.0 - vEdgeMask;
            gl_FragColor = vec4(edge, edge * 0.5, 0.0, alpha * opacity);
            return;
        }

        if (showDensity) {
            // Visualize as grid pattern
            vec2 grid = fract(vUv * 20.0);
            float g = step(0.1, grid.x) * step(0.1, grid.y);
            gl_FragColor = vec4(vec3(g * 0.5 + 0.5), alpha * opacity);
            return;
        }

        // Color modes
        vec3 color;
        if (colorMode == 0) {
            // Original RGB
            color = vColor;
        } else if (colorMode == 1) {
            // Depth colorized
            color = viridis(vDepth);
        } else if (colorMode == 2) {
            // Normal colorized
            color = vNormal * 0.5 + 0.5;
        } else {
            // Blend - mix original with depth color
            color = mix(vColor, viridis(vDepth), 0.3);
        }

        // Opacity adjustments
        float finalOpacity = opacity * alpha;

        // Depth-based opacity (fade distant points)
        if (depthOpacity) {
            finalOpacity *= mix(0.3, 1.0, vDepth);
        }

        // Depth of field effect
        if (dofEnable) {
            float dofDist = abs(vDepth - dofFocal);
            float blur = dofDist * dofStrength;
            // Simulate bokeh by making out-of-focus points larger but more transparent
            finalOpacity *= 1.0 / (1.0 + blur * 2.0);
        }

        gl_FragColor = vec4(color, finalOpacity);
    }
`;

// ========== Depth Mesh Shaders ==========

export const depthMeshVertexShader = `
    uniform sampler2D depthAtlas;
    uniform float frameIndex;
    uniform vec2 atlasSize;
    uniform vec2 frameSize;
    uniform float columns;
    uniform float extrusionAmount;
    uniform float edgeThreshold;
    uniform bool edgeAwareExtrusion;

    varying vec2 vUv;
    varying float vDepth;
    varying float vEdgeMask;
    varying vec3 vNormal;

    vec2 getAtlasUV(vec2 localUV, float frame) {
        float col = mod(frame, columns);
        float row = floor(frame / columns);
        vec2 flippedLocalUV = vec2(localUV.x, 1.0 - localUV.y);
        vec2 frameOffset = vec2(col * frameSize.x, row * frameSize.y);
        return (frameOffset + flippedLocalUV * frameSize) / atlasSize;
    }

    float sampleDepth(vec2 localUV) {
        vec2 depthUV = getAtlasUV(localUV, frameIndex);
        return texture2D(depthAtlas, depthUV).r;
    }

    void main() {
        vUv = uv;

        // Sample depth at this vertex
        float depth = sampleDepth(uv);
        vDepth = depth;

        // Calculate depth gradient using neighboring samples
        vec2 texelSize = 1.0 / frameSize;
        float depthL = sampleDepth(uv + vec2(-texelSize.x, 0.0));
        float depthR = sampleDepth(uv + vec2(texelSize.x, 0.0));
        float depthU = sampleDepth(uv + vec2(0.0, -texelSize.y));
        float depthD = sampleDepth(uv + vec2(0.0, texelSize.y));

        // Gradient magnitude (Sobel-like)
        float gradX = (depthR - depthL) * 0.5;
        float gradY = (depthD - depthU) * 0.5;
        float gradMag = sqrt(gradX * gradX + gradY * gradY);

        // Edge mask: 1 = smooth area, 0 = edge
        vEdgeMask = 1.0 - smoothstep(edgeThreshold * 0.5, edgeThreshold, gradMag);

        // Reconstruct normal from depth gradient
        vNormal = normalize(vec3(-gradX * 10.0, -gradY * 10.0, 1.0));

        // Calculate extrusion (optionally reduced at edges)
        float extrusion = depth * extrusionAmount;
        if (edgeAwareExtrusion) {
            extrusion *= vEdgeMask;
        }

        vec3 displaced = position;
        displaced.z = extrusion;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
`;

export const depthMeshFragmentShader = `
    uniform sampler2D rgbAtlas;
    uniform sampler2D depthAtlas;
    uniform float frameIndex;
    uniform vec2 atlasSize;
    uniform vec2 frameSize;
    uniform float columns;
    uniform float edgeThreshold;
    uniform float edgeSoftness;
    uniform bool edgeFade;
    uniform bool normalShading;
    uniform bool showDepth;
    uniform bool showEdges;
    uniform bool showNormals;
    uniform vec3 lightDir;

    varying vec2 vUv;
    varying float vDepth;
    varying float vEdgeMask;
    varying vec3 vNormal;

    vec2 getAtlasUV(vec2 localUV, float frame) {
        float col = mod(frame, columns);
        float row = floor(frame / columns);
        vec2 flippedLocalUV = vec2(localUV.x, 1.0 - localUV.y);
        vec2 frameOffset = vec2(col * frameSize.x, row * frameSize.y);
        return (frameOffset + flippedLocalUV * frameSize) / atlasSize;
    }

    void main() {
        vec2 rgbUV = getAtlasUV(vUv, frameIndex);
        vec4 color = texture2D(rgbAtlas, rgbUV);

        // Recalculate edge in fragment for smoother result
        vec2 texelSize = 1.0 / frameSize;
        vec2 depthUV = getAtlasUV(vUv, frameIndex);

        float depthC = texture2D(depthAtlas, depthUV).r;
        float depthL = texture2D(depthAtlas, getAtlasUV(vUv + vec2(-texelSize.x, 0.0), frameIndex)).r;
        float depthR = texture2D(depthAtlas, getAtlasUV(vUv + vec2(texelSize.x, 0.0), frameIndex)).r;
        float depthU = texture2D(depthAtlas, getAtlasUV(vUv + vec2(0.0, -texelSize.y), frameIndex)).r;
        float depthD = texture2D(depthAtlas, getAtlasUV(vUv + vec2(0.0, texelSize.y), frameIndex)).r;

        float gradX = (depthR - depthL) * 0.5;
        float gradY = (depthD - depthU) * 0.5;
        float gradMag = sqrt(gradX * gradX + gradY * gradY);

        // Edge mask with softness control
        float edgeMask = 1.0 - smoothstep(edgeThreshold * 0.5, edgeThreshold * edgeSoftness, gradMag);

        // Reconstruct normal
        vec3 normal = normalize(vec3(-gradX * 10.0, -gradY * 10.0, 1.0));

        // Debug views
        if (showDepth) {
            gl_FragColor = vec4(vec3(depthC), 1.0);
            return;
        }

        if (showEdges) {
            float edge = 1.0 - edgeMask;
            gl_FragColor = vec4(edge, edge * 0.5, 0.0, 1.0);
            return;
        }

        if (showNormals) {
            gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
            return;
        }

        // Apply edge fade (darken edges)
        if (edgeFade) {
            color.rgb *= mix(0.3, 1.0, edgeMask);
        }

        // Apply normal-based shading
        if (normalShading) {
            float diffuse = max(dot(normal, lightDir), 0.0);
            diffuse = mix(0.5, 1.0, diffuse);

            float rim = 1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0);
            rim = pow(rim, 2.0) * 0.3;

            color.rgb *= diffuse;
            color.rgb += rim * vec3(0.4, 0.5, 0.6);
        }

        gl_FragColor = color;
    }
`;

export const wireframeFragmentShader = `
    varying float vEdgeMask;

    void main() {
        // Color wireframe by edge detection
        vec3 color = mix(vec3(1.0, 0.3, 0.0), vec3(0.0, 1.0, 0.0), vEdgeMask);
        gl_FragColor = vec4(color, 0.5);
    }
`;
