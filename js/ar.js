// "See it in your room": export the ribbon model as a GLB and hand it to Google's <model-viewer>,
// which opens AR Quick Look on iPhone and WebXR on Android.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const MODEL_VIEWER = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js';
let mvLoaded = null;

export function loadModelViewer() {
  if (!mvLoaded) mvLoaded = import(MODEL_VIEWER).then(() => customElements.whenDefined('model-viewer'));
  return mvLoaded;
}

// ribbon: Ribbon instance already updated to the folded pose. band: Uint8Array per residue.
// colors: CSS colors per band. radius: protein radius in Å. Returns a blob URL to a .glb.
export async function exportGLB({ ribbon, band, colors, radius }) {
  const lists = ribbon.bandIndices(band);
  const position = new THREE.BufferAttribute(Float32Array.from(ribbon.position.array), 3);
  const normal = new THREE.BufferAttribute(Float32Array.from(ribbon.normal.array), 3);
  const root = new THREE.Group();
  lists.forEach((idx, b) => {
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colors[b], roughness: 0.45, metalness: 0 }));
    mesh.name = ['Very high confidence', 'Confident', 'Low confidence', 'Very low confidence'][b];
    root.add(mesh);
  });
  // Ångströms to meters, so the protein is about 30 cm across in your room.
  const s = 0.3 / Math.max(10, radius * 2);
  root.scale.setScalar(s);
  root.position.y = radius * s;
  const scene = new THREE.Scene();
  scene.add(root);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
}
