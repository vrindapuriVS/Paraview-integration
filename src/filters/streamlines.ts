import * as THREE from "three";

export type StreamlineOptions = {
  seedCount: number;
  maxSteps: number;
  stepSize: number;
  /** "center": seeds near bbox center; "random": pseudo-random in volume */
  seedMode?: "center" | "random";
};

/**
 * Simple Euler integration of streamlines using nearest-vertex vector lookup (fast, approximate).
 */
export function buildStreamlineGeometry(
  position: THREE.BufferAttribute,
  vx: Float32Array,
  vy: Float32Array,
  vz: Float32Array,
  bounds: THREE.Box3,
  opts: StreamlineOptions
): THREE.BufferGeometry {
  const posArr = position.array as Float32Array;
  const nVerts = position.count;
  const points: number[] = [];

  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const sampleVelocity = (x: number, y: number, z: number) => {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nVerts; i += 1) {
      const o = i * 3;
      const dx = posArr[o] - x;
      const dy = posArr[o + 1] - y;
      const dz = posArr[o + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return new THREE.Vector3(0, 0, 0);
    return new THREE.Vector3(vx[best] ?? 0, vy[best] ?? 0, vz[best] ?? 0);
  };

  const size = new THREE.Vector3();
  bounds.getSize(size);
  const diag = Math.max(size.length(), 1e-6);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  const mode = opts.seedMode ?? "random";

  for (let s = 0; s < opts.seedCount; s += 1) {
    const u = (s + 0.5) / opts.seedCount;
    if (mode === "center") {
      const jitter = diag * 0.08;
      const phase = s * 1.61803398875;
      p.set(
        center.x + Math.sin(phase * 2.1) * jitter * 0.5,
        center.y + Math.cos(phase * 1.7) * jitter * 0.5,
        center.z + Math.sin(phase * 2.9) * jitter * 0.5
      );
    } else {
      const cx = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, (u * 7.13) % 1);
      const cy = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, (u * 11.17) % 1);
      const cz = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, (u * 13.91) % 1);
      p.set(cx, cy, cz);
    }

    for (let step = 0; step < opts.maxSteps; step += 1) {
      v.copy(sampleVelocity(p.x, p.y, p.z));
      if (v.lengthSq() < 1e-10) break;
      v.normalize().multiplyScalar(opts.stepSize * diag);
      tmp.copy(p).add(v);
      points.push(p.x, p.y, p.z, tmp.x, tmp.y, tmp.z);
      p.copy(tmp);
      if (!bounds.containsPoint(p)) break;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(points), 3));
  return geom;
}
