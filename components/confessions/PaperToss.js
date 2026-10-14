'use client';

import { useEffect, useRef } from 'react';

/** Success-only paper toss, adapted from item-develop/paper-crumple-demo's paper lifecycle.
 * We intentionally use a single lazy Three scene rather than one physics world per card.
 * See THIRD_PARTY_NOTICES.md. */
export function PaperToss({ active, onComplete }) {
  const host = useRef(null);
  useEffect(() => {
    if (!active || !host.current) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { onComplete?.(); return; }
    let disposed = false, frame = 0, renderer, scene, camera;
    const meshes = [];
    const timer = setTimeout(() => onComplete?.(), 1500);
    import('three').then((THREE) => {
      if (disposed || !host.current) return;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(host.current.clientWidth, 190);
        host.current.append(renderer.domElement);
        scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(45, host.current.clientWidth / 190, .1, 20); camera.position.z = 5;
        const geometry = new THREE.IcosahedronGeometry(.28, 1); const material = new THREE.MeshBasicMaterial({ color: 0xf4f0df, wireframe: true });
        for (let i=0;i<7;i++) { const mesh=new THREE.Mesh(geometry,material); mesh.position.set((i-3)*.08,-1.5-i*.04,0); mesh.userData={vx:(i-3)*.008,vy:.045+i*.005,spin:.03+i*.003}; scene.add(mesh); meshes.push(mesh); }
        const start=performance.now(); const animate=(now)=>{ if(disposed)return; for(const m of meshes){m.position.x+=m.userData.vx;m.position.y+=m.userData.vy;m.userData.vy-=.0012;m.rotation.x+=m.userData.spin;m.rotation.y+=m.userData.spin;} renderer.render(scene,camera); if(now-start<1450) frame=requestAnimationFrame(animate); }; frame=requestAnimationFrame(animate);
      } catch { onComplete?.(); }
    }).catch(() => onComplete?.());
    return () => { disposed=true; clearTimeout(timer); cancelAnimationFrame(frame); meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();}); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); };
  }, [active, onComplete]);
  if (!active) return null;
  return <div ref={host} className="paper-toss" role="img" aria-label="Your anonymous confession was folded and tossed into the moderation inbox." />;
}
