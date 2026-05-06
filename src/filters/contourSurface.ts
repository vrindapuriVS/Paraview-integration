import * as THREE from "three";

/**
 * Builds line segments where a per-vertex scalar crosses `iso` on triangle faces (surface contour).
 * Works with non-indexed triangle soup (each consecutive 3 vertices form a triangle).
 */
export function buildSurfaceContourGeometry(
  position: THREE.BufferAttribute,
  scalars: Float32Array,
  iso: number
): THREE.BufferGeometry {
  const posArr = position.array as Float32Array;
  const vertCount = position.count;
  const lineVerts: number[] = [];

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();

  const edgePoint = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    sa: number,
    sb: number
  ) => {
    if (sa === sb) return null;
    const t = (iso - sa) / (sb - sa);
    if (t < 0 || t > 1) return null;
    return [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
  };

  const nTri = Math.floor(vertCount / 3);
  for (let t = 0; t < nTri; t += 1) {
    const i0 = t * 3;
    const i1 = t * 3 + 1;
    const i2 = t * 3 + 2;
    if (i2 >= vertCount) break;

    const i0a = i0 * 3;
    const i1a = i1 * 3;
    const i2a = i2 * 3;

    p0.set(posArr[i0a], posArr[i0a + 1], posArr[i0a + 2]);
    p1.set(posArr[i1a], posArr[i1a + 1], posArr[i1a + 2]);
    p2.set(posArr[i2a], posArr[i2a + 1], posArr[i2a + 2]);

    const s0 = scalars[i0] ?? 0;
    const s1 = scalars[i1] ?? 0;
    const s2 = scalars[i2] ?? 0;

    const pts: number[][] = [];
    const e01 = edgePoint(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, s0, s1);
    const e12 = edgePoint(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, s1, s2);
    const e20 = edgePoint(p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, s2, s0);
    if (e01) pts.push(e01);
    if (e12) pts.push(e12);
    if (e20) pts.push(e20);

    if (pts.length === 2) {
      lineVerts.push(...pts[0], ...pts[1]);
    } else if (pts.length === 3) {
      lineVerts.push(...pts[0], ...pts[1]);
      lineVerts.push(...pts[1], ...pts[2]);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(lineVerts), 3));
  return geom;
}
