import * as THREE from "three";

export type ScalarFieldKey = "solid" | "pressure" | "velocity" | "temperature";

export type ScalarStats = {
  min: number;
  max: number;
};

function toNormalizedRange(value: number, min: number, max: number) {
  const span = Math.max(max - min, 1e-9);
  return THREE.MathUtils.clamp((value - min) / span, 0, 1);
}

function lerpColor(a: THREE.Color, b: THREE.Color, t: number) {
  return a.clone().lerp(b, t);
}

export function createMockScalarValues(
  positions: THREE.BufferAttribute,
  field: Exclude<ScalarFieldKey, "solid">
) {
  const values = new Float32Array(positions.count);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    let raw = 0;
    if (field === "pressure") {
      raw = z;
    } else if (field === "velocity") {
      const radial = Math.sqrt(x * x + y * y + z * z);
      raw = radial + Math.sin(x * 1.7) * 0.15 + Math.cos(y * 2.3) * 0.15;
    } else {
      raw = z * 0.45 + Math.sin(x * 2.8) * 0.25 + Math.cos(y * 2.4) * 0.2;
    }

    values[i] = raw;
    min = Math.min(min, raw);
    max = Math.max(max, raw);
  }

  return { values, stats: { min, max } };
}

export function mapScalarToColor(
  field: Exclude<ScalarFieldKey, "solid">,
  normalized: number
) {
  const t = THREE.MathUtils.clamp(normalized, 0, 1);

  if (field === "pressure") {
    return lerpColor(new THREE.Color("#3b82f6"), new THREE.Color("#ef4444"), t);
  }

  if (field === "velocity") {
    return lerpColor(new THREE.Color("#22c55e"), new THREE.Color("#fde047"), t);
  }

  return lerpColor(new THREE.Color("#a855f7"), new THREE.Color("#fb923c"), t);
}

export function applyMockScalarColors(
  geometry: THREE.BufferGeometry,
  field: Exclude<ScalarFieldKey, "solid">,
  options?: { reverse?: boolean }
): ScalarStats {
  const positions = geometry.getAttribute("position");
  if (!positions || positions.itemSize < 3) {
    return { min: 0, max: 1 };
  }

  const { values, stats } = createMockScalarValues(positions as THREE.BufferAttribute, field);
  const colors = new Float32Array((positions as THREE.BufferAttribute).count * 3);

  for (let i = 0; i < (positions as THREE.BufferAttribute).count; i += 1) {
    let t = toNormalizedRange(values[i], stats.min, stats.max);
    if (options?.reverse) t = 1 - t;
    const color = mapScalarToColor(field, t);
    const base = i * 3;
    colors[base] = color.r;
    colors[base + 1] = color.g;
    colors[base + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return stats;
}

export function getLegendGradient(field: ScalarFieldKey) {
  if (field === "pressure") return "linear-gradient(to top, #3b82f6, #ef4444)";
  if (field === "velocity") return "linear-gradient(to top, #22c55e, #fde047)";
  if (field === "temperature") return "linear-gradient(to top, #a855f7, #fb923c)";
  return "linear-gradient(to top, #cbd5e1, #e2e8f0)";
}
