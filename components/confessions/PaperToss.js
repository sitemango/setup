'use client';

import { useEffect, useRef } from 'react';

/**
 * Success-only paper crumple and toss, adapted from the lifecycle and canvas
 * paper-face technique in item-develop/paper-crumple-demo (MIT).
 *
 * The Campus+ version keeps one lightweight, lazy Three scene: a confession is
 * drawn onto a double-sided paper sheet, its subdivided vertices crumple toward
 * the centre, and the resulting ball is tossed away. No feed card owns a scene.
 */
export function PaperToss({ active, content = '', onComplete }) {
  const host = useRef(null);

  useEffect(() => {
    if (!active || !host.current) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = setTimeout(() => onComplete?.(), 900);
      return () => clearTimeout(timer);
    }

    let disposed = false;
    let frame = 0;
    let renderer;
    let geometry;
    let material;
    let texture;
    const finishTimer = setTimeout(() => onComplete?.(), 2300);

    import('three').then((THREE) => {
      if (disposed || !host.current) return;
      try {
        const width = Math.max(host.current.clientWidth, 280);
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.setSize(width, 260);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        host.current.append(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, width / 260, 0.1, 20);
        camera.position.set(0, 0.15, 5.2);
        scene.add(new THREE.HemisphereLight(16777215, 3359061, 2.2));
        const light = new THREE.DirectionalLight(16777215, 2.4);
        light.position.set(-2, 3, 4);
        scene.add(light);

        // Reference-inspired graph paper face, generated locally at runtime.
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 820;
        const context = canvas.getContext('2d');
        context.fillStyle = 'rgb(238,234,222)'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = 'rgba(96,125,108,.2)'; context.lineWidth = 1;
        for (let x = 20; x < canvas.width; x += 28) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
        for (let y = 20; y < canvas.height; y += 28) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
        context.fillStyle = 'rgb(29,36,32)'; context.font = '600 27px system-ui'; context.fillText('CAMPUS+  /  CONFESSION', 44, 70);
        context.font = '25px system-ui';
        wrapText(context, content || 'Your confession is safely on its way.', 44, 135, 550, 38, 12);
        context.font = '18px monospace'; context.fillStyle = 'rgb(82,96,90)'; context.fillText('ANONYMOUS · PENDING REVIEW', 44, 760);
        texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;

        geometry = new THREE.PlaneGeometry(2.05, 2.62, 22, 28);
        const base = Float32Array.from(geometry.attributes.position.array);
        material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.93, side: THREE.DoubleSide });
        const paper = new THREE.Mesh(geometry, material);
        paper.rotation.z = -0.07; scene.add(paper);

        const start = performance.now();
        const animate = (now) => {
          if (disposed) return;
          const elapsed = (now - start) / 1000;
          const crumple = smooth(Math.min(elapsed / 0.82, 1));
          const positions = geometry.attributes.position;
          for (let i = 0; i < positions.count; i += 1) {
            const x = base[i * 3], y = base[i * 3 + 1];
            const seed = Math.sin(i * 91.73) * 0.5 + Math.cos(i * 17.17) * 0.5;
            positions.setXYZ(i, x * (1 - crumple * 0.82), y * (1 - crumple * 0.82), crumple * seed * 0.34);
          }
          positions.needsUpdate = true; geometry.computeVertexNormals();
          if (elapsed > 0.82) {
            const toss = elapsed - 0.82;
            paper.position.x = toss * 1.35;
            paper.position.y = toss * 2.4 - toss * toss * 1.7;
            paper.position.z = -toss * 1.1;
            paper.rotation.x += 0.08; paper.rotation.y += 0.11; paper.rotation.z += 0.055;
            paper.scale.setScalar(Math.max(0.2, 1 - toss * 0.3));
          }
          renderer.render(scene, camera);
          if (elapsed < 2.2) frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
      } catch { onComplete?.(); }
    }).catch(() => onComplete?.());

    return () => {
      disposed = true; clearTimeout(finishTimer); cancelAnimationFrame(frame);
      geometry?.dispose(); material?.dispose(); texture?.dispose();
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, [active, content, onComplete]);

  if (!active) return null;
  return <div className="paper-toss" role="img" aria-label="Your confession crumples into a paper ball and is tossed anonymously into the moderation inbox." />;
}

function smooth(value) { return value * value * (3 - 2 * value); }
function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(/\s+/); let line = ''; let lines = 0;
  for (const word of words) {
    const next = `${line}${line ? ' ' : ''}${word}`;
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, y + lines * lineHeight); line = word; lines += 1;
      if (lines >= maxLines) return;
    } else line = next;
  }
  if (line && lines < maxLines) context.fillText(line, x, y + lines * lineHeight);
}
