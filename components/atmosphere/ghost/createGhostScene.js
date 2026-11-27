/**
 * The Campus+ blue ghost — a port of the reference scene in
 * `aminotkartik/loginpage` (app.js), rebuilt as a module that the login
 * screen can mount and dispose.
 *
 * What is carried over, with the reference's values kept where they matter:
 *   - the ghost body: the same hem-waved sphere, MeshPhysicalMaterial with
 *     emissive blue and clearcoat, and the same electric-blue palette;
 *   - the eyes: dark sockets, pulsing blue irises with an additive aura that
 *     brightens with pointer energy;
 *   - the pointer: the ghost follows the cursor across the viewport, with
 *     kinetic tilt, breathing and a float, exactly as the reference drives it;
 *   - the fireflies and the pointer-driven particle trail;
 *   - the bloom (UnrealBloomPass) that gives the reference its glow.
 *
 * What is deliberately not ported:
 *   - the full-screen VHS/analog ShaderPass. It costs a full-viewport shader
 *     every frame; the scanlines and vignette are reproduced in CSS instead;
 *   - the reference's opaque navy scene background. The canvas is transparent
 *     so the existing Campus+ particle sky stays visible behind the ghost;
 *   - the blocking preloader. The login form must never sit behind a loader.
 *
 * Luminance: an animated ghost is a light source, and a screen-wide flare
 * competes with the branding and the sign-in glass. The glow is therefore kept
 * local — a lower tone-mapping exposure, a lower bloom strength and radius with
 * a higher threshold (only the brightest cores bloom), a smaller, dimmer halo,
 * and restrained emissive/light intensities. The eyes, rim and palette keep the
 * ghost recognisable; the intent is a cinematic blue presence with dark
 * negative space around it, not maximum output.
 *
 * Reduced motion: one frame is rendered and no animation loop runs.
 * Lifecycle: `createGhostScene` returns a `dispose()` that stops the loop,
 * removes every listener and releases the WebGL context.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { webglAvailable } from '@/components/atmosphere/webgl';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * The ghost palette lives in CSS (`--ghost-*` on `.login-ghost-layer`), so the
 * design tokens stay the single source of colour. Values are read once per
 * scene and parsed by Three.js, which accepts the same CSS colour syntax.
 */
function readPalette(element) {
  const style = getComputedStyle(element);
  const color = (name) => new THREE.Color().setStyle(style.getPropertyValue(name).trim());
  return {
    body: color('--ghost-body'),
    bright: color('--ghost-bright'),
    light: color('--ghost-light'),
    eye: color('--ghost-eye'),
    socket: color('--ghost-socket'),
    ambient: color('--ghost-ambient'),
    rimA: color('--ghost-rim-a'),
    rimB: color('--ghost-rim-b'),
    firefly: color('--ghost-firefly'),
    trail: color('--ghost-trail'),
  };
}

const MAX_PIXEL_RATIO = 1.5;
const FIREFLY_COUNT = 66;
const TRAIL_COUNT = 180;

/**
 * Whether a WebGL context can be created at all. The probe itself lives in
 * `../webgl` so the Home depth field asks exactly the same question; it is
 * re-exported here because that is where callers of this scene expect it.
 */
export { webglAvailable };

/** A soft radial sprite texture for the reveal halo, drawn once. */
function haloTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(145, 191, 229, 0.24)');
  gradient.addColorStop(0.35, 'rgba(145, 191, 229, 0.08)');
  gradient.addColorStop(1, 'rgba(25, 29, 33, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {HTMLElement} container  an element the scene's canvas is appended to
 * @param {{ reducedMotion?: boolean, placement?: string }} [options]
 * @returns {() => void} dispose
 */
export function createGhostScene(container, { reducedMotion = false, placement = 'login' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ghost-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const palette = readPalette(container);

  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const size = () => {
    const rect = container.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width || window.innerWidth)),
      height: Math.max(1, Math.round(rect.height || window.innerHeight)),
    };
  };

  const { width, height } = size();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, width / height, 0.1, 200);
  camera.position.set(0, 0, 20);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio());
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  /* strength, radius, threshold — a restrained bloom: only the eye cores and
     the brightest body highlights pass the threshold, and the radius keeps the
     spread tight so the glow stays around the ghost instead of washing the sky. */
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.52, 0.58, 0.34);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  const disposables = [];
  const track = (resource) => {
    disposables.push(resource);
    return resource;
  };

  // ------- Reveal halo behind the ghost (additive sprite, no opaque plane) -------
  const halo = track(haloTexture());
  const haloSprite = new THREE.Sprite(
    track(new THREE.SpriteMaterial({
      map: halo,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
    })),
  );
  haloSprite.scale.set(11, 11, 1);
  haloSprite.position.z = -4;
  scene.add(haloSprite);

  // ------- Blue ghost -------
  const ghostGroup = new THREE.Group();
  ghostGroup.scale.setScalar(0.72);
  scene.add(ghostGroup);

  const ghostGeometry = track(new THREE.SphereGeometry(2, 48, 36));
  const ghostPositions = ghostGeometry.attributes.position;
  for (let i = 0; i < ghostPositions.count; i += 1) {
    const x = ghostPositions.getX(i);
    const y = ghostPositions.getY(i);
    const z = ghostPositions.getZ(i);
    if (y < -0.18) {
      const waves = Math.sin(x * 4.8) * 0.27 + Math.cos(z * 5.5) * 0.2 + Math.sin((x + z) * 2.8) * 0.14;
      ghostPositions.setY(i, -2.0 + waves);
    }
  }
  ghostPositions.needsUpdate = true;
  ghostGeometry.computeVertexNormals();

  const ghostMaterial = track(new THREE.MeshPhysicalMaterial({
    color: palette.body,
    emissive: palette.bright,
    emissiveIntensity: 1.45,
    roughness: 0.2,
    metalness: 0.02,
    transparent: true,
    opacity: 0.9,
    clearcoat: 0.55,
    clearcoatRoughness: 0.16,
    side: THREE.DoubleSide,
  }));
  const ghostBody = new THREE.Mesh(ghostGeometry, ghostMaterial);
  ghostGroup.add(ghostBody);

  const innerLight = new THREE.PointLight(palette.light, 2.4, 11, 2);
  innerLight.position.set(0, 0.2, 2.2);
  ghostGroup.add(innerLight);

  scene.add(new THREE.AmbientLight(palette.ambient, 0.22));

  const rimLeft = new THREE.DirectionalLight(palette.rimA, 0.9);
  rimLeft.position.set(-8, 7, 6);
  scene.add(rimLeft);

  const rimRight = new THREE.DirectionalLight(palette.rimB, 0.55);
  rimRight.position.set(7, -3, 4);
  scene.add(rimRight);

  // ------- Eyes -------
  const eyesGroup = new THREE.Group();
  ghostGroup.add(eyesGroup);
  const socketGeometry = track(new THREE.SphereGeometry(0.46, 20, 16));
  const socketMaterial = track(new THREE.MeshBasicMaterial({ color: palette.socket }));
  const eyeGeometry = track(new THREE.SphereGeometry(0.235, 16, 12));
  const auraGeometry = track(new THREE.SphereGeometry(0.48, 16, 12));
  const eyeMaterial = track(new THREE.MeshBasicMaterial({ color: palette.eye, transparent: true, opacity: 0.1 }));
  const auraMaterial = track(new THREE.MeshBasicMaterial({
    color: palette.light,
    transparent: true,
    opacity: 0.016,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  }));
  const eyeMeshes = [];
  [-0.7, 0.7].forEach((x) => {
    const socket = new THREE.Mesh(socketGeometry, socketMaterial);
    socket.position.set(x, 0.56, 1.86);
    socket.scale.set(1.1, 1.0, 0.52);
    eyesGroup.add(socket);

    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(x, 0.56, 2.03);
    eyesGroup.add(eye);
    eyeMeshes.push(eye);

    const aura = new THREE.Mesh(auraGeometry, auraMaterial);
    aura.position.set(x, 0.56, 1.97);
    eyesGroup.add(aura);
  });

  // ------- Fireflies -------
  const fireflyPositions = new Float32Array(FIREFLY_COUNT * 3);
  const fireflySeeds = new Float32Array(FIREFLY_COUNT * 4);
  for (let i = 0; i < FIREFLY_COUNT; i += 1) {
    const i3 = i * 3;
    const i4 = i * 4;
    fireflyPositions[i3] = (Math.random() - 0.5) * 33;
    fireflyPositions[i3 + 1] = (Math.random() - 0.5) * 22;
    fireflyPositions[i3 + 2] = -7 - Math.random() * 8;
    fireflySeeds[i4] = Math.random() * Math.PI * 2;
    fireflySeeds[i4 + 1] = 0.3 + Math.random() * 0.8;
    fireflySeeds[i4 + 2] = fireflyPositions[i3];
    fireflySeeds[i4 + 3] = fireflyPositions[i3 + 1];
  }
  const fireflyGeometry = track(new THREE.BufferGeometry());
  fireflyGeometry.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3));
  const fireflyMaterial = track(new THREE.PointsMaterial({
    color: palette.firefly,
    size: 0.09,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }));
  scene.add(new THREE.Points(fireflyGeometry, fireflyMaterial));

  // ------- Pointer trail -------
  const trailPositions = new Float32Array(TRAIL_COUNT * 3);
  const trailAlpha = new Float32Array(TRAIL_COUNT);
  const trailVelocity = Array.from({ length: TRAIL_COUNT }, () => new THREE.Vector3());
  const trailGeometry = track(new THREE.BufferGeometry());
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(trailAlpha, 1));
  const trailMaterial = track(new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color(palette.trail) } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (4.0 + aAlpha * 12.0) * (18.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying float vAlpha;
      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        float alpha = smoothstep(0.5, 0.04, d) * vAlpha;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  }));
  scene.add(new THREE.Points(trailGeometry, trailMaterial));

  function emitTrail(amount) {
    const count = Math.min(amount, TRAIL_COUNT);
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      if (trailAlpha[i] < 0.08 || Math.random() < 0.12) {
        trailPositions[i3] = ghostGroup.position.x + (Math.random() - 0.5) * 2.6;
        trailPositions[i3 + 1] = ghostGroup.position.y - 0.65 + (Math.random() - 0.5) * 2.4;
        trailPositions[i3 + 2] = -0.1 - Math.random() * 1.8;
        trailVelocity[i].set(
          (Math.random() - 0.5) * 0.035,
          (Math.random() - 0.4) * 0.035,
          -0.012 - Math.random() * 0.028,
        );
        trailAlpha[i] = 0.55 + Math.random() * 0.45;
      }
    }
  }

  // ------- Pointer -------
  const pointer = new THREE.Vector2(0, 0);
  const previousPointer = new THREE.Vector2(0, 0);
  const pointerVelocity = new THREE.Vector2();
  let lastPointerTime = 0;

  function updatePointer(clientX, clientY) {
    previousPointer.copy(pointer);
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    pointerVelocity.subVectors(pointer, previousPointer);
    lastPointerTime = performance.now();
  }

  const onPointerMove = (event) => updatePointer(event.clientX, event.clientY);
  const onTouchMove = (event) => {
    const touch = event.touches[0];
    if (touch) updatePointer(touch.clientX, touch.clientY);
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerMove, { passive: true });
  window.addEventListener('touchstart', onTouchMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });

  // Resize follows the container, which fills the login stage.
  const resize = () => {
    const next = size();
    camera.aspect = next.width / next.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(next.width, next.height, false);
    composer.setPixelRatio(pixelRatio());
    composer.setSize(next.width, next.height);
    bloomPass.setSize(next.width, next.height);
    if (reducedMotion) renderer.render(scene, camera);
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(container);

  // ------- Animation -------
  let frameId = 0;
  let lastFrame = performance.now();
  let elapsed = 0;
  let eyeEnergy = 0.1;
  let running = false;
  const startPosition = new THREE.Vector3();

  function step(now) {
    const delta = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    elapsed += delta;
    pointerVelocity.multiplyScalar(Math.pow(0.0001, delta));

    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const viewWidth = viewHeight * camera.aspect;
    const edgePadding = 1.7;
    // Keep the original full-viewport pointer tracking on every screen; only
    // the initial resting position differs on onboarding.
    const targetX = pointer.x * Math.max(0, viewWidth / 2 - edgePadding);
    const targetY = pointer.y * Math.max(0, viewHeight / 2 - edgePadding);
    startPosition.copy(ghostGroup.position);
    const follow = 1.0 - Math.pow(0.0008, delta);

    ghostGroup.position.x += (targetX - ghostGroup.position.x) * follow;
    ghostGroup.position.y += (targetY - ghostGroup.position.y) * follow;

    const movement = startPosition.distanceTo(ghostGroup.position);
    const pointerStill = now - lastPointerTime < 120;
    const kineticEnergy = Math.min(1, movement * 7 + pointerVelocity.length() * 8);
    eyeEnergy += (pointerStill ? kineticEnergy : 0.09 - eyeEnergy) * Math.min(1, delta * 7);

    const floatA = Math.sin(elapsed * 1.7) * 0.12;
    const floatB = Math.cos(elapsed * 0.71) * 0.075;
    ghostGroup.position.y += floatA * delta * 2.1 + floatB * delta;

    ghostBody.rotation.z += ((-pointerVelocity.x * 1.8) - ghostBody.rotation.z) * delta * 2.6;
    ghostBody.rotation.x += ((pointerVelocity.y * 1.25) - ghostBody.rotation.x) * delta * 2.6;
    ghostBody.rotation.y = Math.sin(elapsed * 0.9) * 0.08;

    const breath = 1 + Math.sin(elapsed * 1.45) * 0.032 + Math.sin(elapsed * 0.47) * 0.018;
    ghostBody.scale.setScalar(breath);
    ghostMaterial.emissiveIntensity = 1.34 + Math.sin(elapsed * 2.3) * 0.17 + eyeEnergy * 0.3;
    innerLight.intensity = 1.95 + eyeEnergy * 0.7;

    eyeMaterial.opacity = 0.05 + eyeEnergy * 0.5;
    auraMaterial.opacity = 0.02 + eyeEnergy * 0.1;
    eyeMeshes.forEach((eye, index) => {
      eye.scale.setScalar(1 + Math.sin(elapsed * 6 + index * 0.85) * 0.08 * eyeEnergy);
    });

    haloSprite.position.x = ghostGroup.position.x;
    haloSprite.position.y = ghostGroup.position.y;
    haloSprite.material.opacity = 0.42 + Math.sin(elapsed * 1.6) * 0.08;

    for (let i = 0; i < FIREFLY_COUNT; i += 1) {
      const i3 = i * 3;
      const i4 = i * 4;
      const phase = fireflySeeds[i4];
      const speed = fireflySeeds[i4 + 1];
      fireflyPositions[i3] = fireflySeeds[i4 + 2] + Math.sin(elapsed * speed + phase) * 0.8;
      fireflyPositions[i3 + 1] = fireflySeeds[i4 + 3] + Math.cos(elapsed * (speed * 0.72) + phase) * 0.6;
    }
    fireflyGeometry.attributes.position.needsUpdate = true;
    fireflyMaterial.opacity = 0.58 + Math.sin(elapsed * 1.7) * 0.14;

    if (pointerStill && kineticEnergy > 0.02) emitTrail(Math.ceil(kineticEnergy * 13));
    for (let i = 0; i < TRAIL_COUNT; i += 1) {
      if (trailAlpha[i] <= 0) continue;
      const i3 = i * 3;
      trailPositions[i3] += trailVelocity[i].x;
      trailPositions[i3 + 1] += trailVelocity[i].y;
      trailPositions[i3 + 2] += trailVelocity[i].z;
      trailVelocity[i].y -= 0.00018;
      trailAlpha[i] = Math.max(0, trailAlpha[i] - delta * (0.64 + (i % 5) * 0.07));
    }
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.aAlpha.needsUpdate = true;

    composer.render();
  }

  function loop(now) {
    if (!running) return;
    step(now);
    frameId = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reducedMotion || document.hidden) return;
    running = true;
    lastFrame = performance.now();
    frameId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frameId);
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  // Position the onboarding ghost before the still frame as well as animation.
  if (placement === 'onboarding') {
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    ghostGroup.position.x = viewHeight * camera.aspect * 0.30;
    haloSprite.position.x = ghostGroup.position.x;
  }
  // Start just off the title so the ghost is visible before the first move.
  updatePointer(window.innerWidth * 0.72, window.innerHeight * 0.62);
  if (reducedMotion) {
    // One still frame, no loop: motion is removed, the presence is not.
    composer.render();
  } else {
    start();
  }

  let disposed = false;
  return function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerMove);
    window.removeEventListener('touchstart', onTouchMove);
    window.removeEventListener('touchmove', onTouchMove);
    observer?.disconnect();
    disposables.forEach((resource) => resource.dispose?.());
    composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    canvas.remove();
  };
}
