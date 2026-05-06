import * as THREE from "three";

export type ClipPlanePreset = "xy" | "yz" | "xz";

export type ClipPlaneOptions = {
  enabled: boolean;
  plane: ClipPlanePreset;
  position: number;
  invert: boolean;
};

const NORMALS: Record<ClipPlanePreset, THREE.Vector3> = {
  xy: new THREE.Vector3(0, 0, 1),
  yz: new THREE.Vector3(1, 0, 0),
  xz: new THREE.Vector3(0, 1, 0),
};

/** Build a Three.js clipping plane: n·x + constant = 0, with slider matching n·x ≈ position. */
export function makeClippingPlane(opts: ClipPlaneOptions): THREE.Plane {
  const n = NORMALS[opts.plane].clone().normalize();
  if (opts.invert) n.multiplyScalar(-1);
  return new THREE.Plane(n, -opts.position);
}
