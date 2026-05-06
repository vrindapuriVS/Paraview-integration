import * as THREE from "three";

export type GlyphOptions = {
  /** Use every Nth vertex (1 = dense) */
  stride: number;
  /** Arrow length scale relative to bounding box diagonal */
  scale: number;
};

/**
 * Instanced cones oriented along velocity vectors (ParaView-style glyphs, simplified).
 */
export function buildVelocityGlyphMesh(
  position: THREE.BufferAttribute,
  vx: Float32Array,
  vy: Float32Array,
  vz: Float32Array,
  bounds: THREE.Box3,
  opts: GlyphOptions
): THREE.InstancedMesh {
  const posArr = position.array as Float32Array;
  const nVerts = position.count;
  const diag = bounds.getSize(new THREE.Vector3()).length();
  const arrowLen = Math.max(diag * 0.02 * opts.scale, 1e-6);

  const coneGeom = new THREE.ConeGeometry(arrowLen * 0.15, arrowLen, 8, 1);
  coneGeom.translate(0, arrowLen / 2, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x93c5fd,
    opacity: 0.85,
    transparent: true,
    depthWrite: false,
  });

  const count = Math.max(1, Math.ceil(nVerts / opts.stride));
  const mesh = new THREE.InstancedMesh(coneGeom, mat, count);

  const dummy = new THREE.Object3D();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let inst = 0;
  for (let i = 0; i < nVerts && inst < count; i += opts.stride) {
    const o = i * 3;
    const x = posArr[o];
    const y = posArr[o + 1];
    const z = posArr[o + 2];
    dir.set(vx[i] ?? 0, vy[i] ?? 0, vz[i] ?? 0);
    if (dir.lengthSq() < 1e-12) {
      dummy.position.set(x, y, z);
      dummy.scale.set(0.001, 0.001, 0.001);
      dummy.updateMatrix();
      mesh.setMatrixAt(inst, dummy.matrix);
      inst += 1;
      continue;
    }
    dir.normalize();
    dummy.position.set(x, y, z);
    dummy.quaternion.setFromUnitVectors(up, dir);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(inst, dummy.matrix);
    inst += 1;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = inst;
  return mesh;
}
