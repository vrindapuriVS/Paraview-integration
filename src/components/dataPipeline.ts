import * as THREE from "three";
import vtkPolyDataReader from "@kitware/vtk.js/IO/Legacy/PolyDataReader";
import vtkXMLPolyDataReader from "@kitware/vtk.js/IO/XML/XMLPolyDataReader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  applyMockScalarColors,
  createMockScalarValues,
  getLegendGradient,
  mapScalarToColor,
  type ScalarFieldKey,
} from "./scalarColoring";

export type DataKind = "stl" | "vtk" | "vtu" | "pvd" | "foam";
export type ColorMapName = "coolToWarm" | "viridis" | "jet";
export type ScalarAssociation = "point" | "cell" | "derived" | "mock";

export type ScalarField = {
  key: string;
  label: string;
  values: Float32Array;
  association: ScalarAssociation;
  min: number;
  max: number;
};

export type ProbeResult = {
  indexA: number;
  indexB: number;
  indexC: number;
  value: number;
};

export type LoadedGeometry = {
  geometry: THREE.BufferGeometry;
  kind: DataKind;
  scalarFields: ScalarField[];
  timeSteps?: Array<{ time: number; file: string }>;
  activeTimeStep?: number;
};

type LookupTable = Array<{ t: number; color: THREE.Color }>;

function extFromName(name: string): DataKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".vtk")) return "vtk";
  if (lower.endsWith(".vtu")) return "vtu";
  if (lower.endsWith(".pvd")) return "pvd";
  if (lower.endsWith(".foam")) return "foam";
  return null;
}

function stats(values: Float32Array) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    min = Math.min(min, values[i]);
    max = Math.max(max, values[i]);
  }
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 1 };
}

export function computeRange(values: Float32Array) {
  return stats(values);
}

function normalize(value: number, min: number, max: number) {
  const span = Math.max(max - min, 1e-9);
  return THREE.MathUtils.clamp((value - min) / span, 0, 1);
}

function buildLookupTable(name: ColorMapName): LookupTable {
  if (name === "coolToWarm") {
    return [
      { t: 0, color: new THREE.Color("#3b82f6") },
      { t: 0.5, color: new THREE.Color("#f8fafc") },
      { t: 1, color: new THREE.Color("#ef4444") },
    ];
  }
  if (name === "viridis") {
    return [
      { t: 0, color: new THREE.Color("#440154") },
      { t: 0.5, color: new THREE.Color("#21908d") },
      { t: 1, color: new THREE.Color("#fde725") },
    ];
  }
  return [
    { t: 0, color: new THREE.Color("#00007f") },
    { t: 0.35, color: new THREE.Color("#00b5ff") },
    { t: 0.65, color: new THREE.Color("#ffef00") },
    { t: 1, color: new THREE.Color("#ff2300") },
  ];
}

function sampleLookupTable(table: LookupTable, t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 1; i < table.length; i += 1) {
    if (x <= table[i].t) {
      const prev = table[i - 1];
      const next = table[i];
      const localT = (x - prev.t) / Math.max(next.t - prev.t, 1e-9);
      return prev.color.clone().lerp(next.color, localT);
    }
  }
  return table[table.length - 1].color.clone();
}

/** Normalized scalar [0,1] → RGB for legend, contour accents, etc. */
export function sampleColorMapAt(
  colorMap: ColorMapName,
  normalized: number,
  options?: { reverse?: boolean }
): THREE.Color {
  let t = THREE.MathUtils.clamp(normalized, 0, 1);
  if (options?.reverse) t = 1 - t;
  return sampleLookupTable(buildLookupTable(colorMap), t);
}

function triangulateConnectivity(connectivity: number[]) {
  const triangles: number[][] = [];
  let i = 0;
  while (i < connectivity.length) {
    const n = connectivity[i];
    const ids = connectivity.slice(i + 1, i + 1 + n);
    if (n >= 3) {
      for (let t = 1; t < n - 1; t += 1) {
        triangles.push([ids[0], ids[t], ids[t + 1]]);
      }
    }
    i += n + 1;
  }
  return triangles;
}

function parseAsciiNumbers(text: string) {
  const matches = text.trim().match(/[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/g) ?? [];
  return matches.map((n) => Number(n));
}

function parseLegacyAsciiPolyData(text: string) {
  const upper = text.toUpperCase();
  if (!upper.includes("DATASET POLYDATA")) return null;

  const pointsMatch = text.match(/POINTS\s+(\d+)\s+\w+([\s\S]*?)(?:\n[A-Z_]+\s|\r\n[A-Z_]+\s|$)/i);
  const polysMatch = text.match(/POLYGONS\s+(\d+)\s+(\d+)([\s\S]*?)(?:\n[A-Z_]+\s|\r\n[A-Z_]+\s|$)/i);
  if (!pointsMatch || !polysMatch) return null;

  const pointCount = Number(pointsMatch[1]);
  const pointNums = parseAsciiNumbers(pointsMatch[2]);
  if (!Number.isFinite(pointCount) || pointNums.length < pointCount * 3) return null;

  const polyNums = parseAsciiNumbers(polysMatch[3]).map((v) => Math.trunc(v));
  const triangles = triangulateConnectivity(polyNums);
  if (!triangles.length) return null;

  const positions = new Float32Array(triangles.length * 9);
  const sourcePointIds = new Uint32Array(triangles.length * 3);
  const sourceCellIds = new Uint32Array(triangles.length * 3);

  for (let triIdx = 0; triIdx < triangles.length; triIdx += 1) {
    const tri = triangles[triIdx];
    for (let corner = 0; corner < 3; corner += 1) {
      const pid = tri[corner];
      const out = triIdx * 9 + corner * 3;
      positions[out] = pointNums[pid * 3] ?? 0;
      positions[out + 1] = pointNums[pid * 3 + 1] ?? 0;
      positions[out + 2] = pointNums[pid * 3 + 2] ?? 0;
      const mappedIndex = triIdx * 3 + corner;
      sourcePointIds[mappedIndex] = pid;
      sourceCellIds[mappedIndex] = triIdx;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return { geometry, sourcePointIds, sourceCellIds };
}

function getDataArrayByName(
  parent: Element,
  name?: string
): { values: Float32Array; components: number; label: string } | null {
  const arrays = Array.from(parent.getElementsByTagName("DataArray"));
  const found = arrays.find((node) => {
    const n = node.getAttribute("Name") ?? "";
    return name ? n === name : true;
  });
  if (!found) return null;
  const text = found.textContent ?? "";
  const values = new Float32Array(parseAsciiNumbers(text));
  const components = Number(found.getAttribute("NumberOfComponents") ?? "1");
  const label = found.getAttribute("Name") ?? name ?? "field";
  return { values, components, label };
}

function getAllDataArrays(parent: Element) {
  const arrays = Array.from(parent.getElementsByTagName("DataArray"));
  return arrays.map((node) => {
    const text = node.textContent ?? "";
    const values = new Float32Array(parseAsciiNumbers(text));
    const components = Number(node.getAttribute("NumberOfComponents") ?? "1");
    const label = node.getAttribute("Name") ?? "field";
    return { values, components, label };
  });
}

const VTK_CELL_TYPE = {
  TRIANGLE: 5,
  POLYGON: 7,
  QUAD: 9,
  TETRA: 10,
  HEXAHEDRON: 12,
  WEDGE: 13,
  PYRAMID: 14,
  POLYHEDRON: 42,
} as const;

function getCellFaces(type: number, ids: number[]) {
  if (type === VTK_CELL_TYPE.TRIANGLE) return [ids];
  if (type === VTK_CELL_TYPE.QUAD) return [ids];
  if (type === VTK_CELL_TYPE.POLYGON) return [ids];
  if (type === VTK_CELL_TYPE.TETRA) {
    if (ids.length < 4) return [];
    return [
      [ids[0], ids[1], ids[2]],
      [ids[0], ids[1], ids[3]],
      [ids[1], ids[2], ids[3]],
      [ids[2], ids[0], ids[3]],
    ];
  }
  if (type === VTK_CELL_TYPE.HEXAHEDRON) {
    if (ids.length < 8) return [];
    return [
      [ids[0], ids[1], ids[2], ids[3]],
      [ids[4], ids[5], ids[6], ids[7]],
      [ids[0], ids[1], ids[5], ids[4]],
      [ids[1], ids[2], ids[6], ids[5]],
      [ids[2], ids[3], ids[7], ids[6]],
      [ids[3], ids[0], ids[4], ids[7]],
    ];
  }
  if (type === VTK_CELL_TYPE.WEDGE) {
    if (ids.length < 6) return [];
    return [
      [ids[0], ids[1], ids[2]],
      [ids[3], ids[4], ids[5]],
      [ids[0], ids[1], ids[4], ids[3]],
      [ids[1], ids[2], ids[5], ids[4]],
      [ids[2], ids[0], ids[3], ids[5]],
    ];
  }
  if (type === VTK_CELL_TYPE.PYRAMID) {
    if (ids.length < 5) return [];
    return [
      [ids[0], ids[1], ids[2], ids[3]],
      [ids[0], ids[1], ids[4]],
      [ids[1], ids[2], ids[4]],
      [ids[2], ids[3], ids[4]],
      [ids[3], ids[0], ids[4]],
    ];
  }
  if (type === VTK_CELL_TYPE.POLYHEDRON) {
    // Polyhedron layout:
    // [numFaces, numPtsFace0, p0, p1, ..., numPtsFace1, ...]
    // We decode each face and let the boundary-face map decide exterior faces.
    if (ids.length < 2) return [];
    const faceCount = Math.trunc(ids[0]);
    if (!Number.isFinite(faceCount) || faceCount <= 0) return [];
    const faces: number[][] = [];
    let cursor = 1;
    for (let f = 0; f < faceCount; f += 1) {
      if (cursor >= ids.length) break;
      const n = Math.trunc(ids[cursor]);
      cursor += 1;
      if (!Number.isFinite(n) || n < 3 || cursor + n > ids.length) {
        return faces;
      }
      faces.push(ids.slice(cursor, cursor + n));
      cursor += n;
    }
    return faces;
  }
  return ids.length >= 3 ? [ids] : [];
}

function triangulateFace(face: number[]) {
  const triangles: number[][] = [];
  if (face.length < 3) return triangles;
  for (let i = 1; i < face.length - 1; i += 1) {
    triangles.push([face[0], face[i], face[i + 1]]);
  }
  return triangles;
}

function buildSurfaceFromCells(
  points: number[],
  cellConnectivity: number[],
  offsets: number[],
  types: number[]
) {
  const faceMap = new Map<
    string,
    { face: number[]; ownerCell: number; count: number }
  >();
  const triangles: Array<{ ids: number[]; cellId: number }> = [];

  let start = 0;
  for (let cellId = 0; cellId < offsets.length; cellId += 1) {
    const end = offsets[cellId];
    const cellPointIds = cellConnectivity.slice(start, end);
    start = end;
    const cellType = types[cellId] ?? VTK_CELL_TYPE.POLYGON;
    const faces = getCellFaces(cellType, cellPointIds);
    faces.forEach((face) => {
      const key = [...face].sort((a, b) => a - b).join(",");
      const prev = faceMap.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        faceMap.set(key, { face, ownerCell: cellId, count: 1 });
      }
    });
  }

  faceMap.forEach((entry) => {
    if (entry.count === 1) {
      const tris = triangulateFace(entry.face);
      tris.forEach((tri) => triangles.push({ ids: tri, cellId: entry.ownerCell }));
    }
  });

  const positions = new Float32Array(triangles.length * 9);
  const sourcePointIds = new Uint32Array(triangles.length * 3);
  const sourceCellIds = new Uint32Array(triangles.length * 3);

  for (let triIdx = 0; triIdx < triangles.length; triIdx += 1) {
    const tri = triangles[triIdx];
    for (let corner = 0; corner < 3; corner += 1) {
      const pid = tri.ids[corner];
      const out = triIdx * 9 + corner * 3;
      positions[out] = points[pid * 3];
      positions[out + 1] = points[pid * 3 + 1];
      positions[out + 2] = points[pid * 3 + 2];
      const mapped = triIdx * 3 + corner;
      sourcePointIds[mapped] = pid;
      sourceCellIds[mapped] = tri.cellId;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return { geometry, sourcePointIds, sourceCellIds };
}

function parseVtuXml(xmlText: string) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const piece = doc.getElementsByTagName("Piece")[0];
  if (!piece) throw new Error("Invalid VTU: missing Piece node.");

  const pointsNode = piece.getElementsByTagName("Points")[0];
  const cellsNode = piece.getElementsByTagName("Cells")[0];
  if (!pointsNode || !cellsNode) throw new Error("Invalid VTU: missing Points/Cells.");

  const pointArray = getDataArrayByName(pointsNode);
  const connectivityArray = getDataArrayByName(cellsNode, "connectivity");
  const offsetsArray = getDataArrayByName(cellsNode, "offsets");
  const typesArray = getDataArrayByName(cellsNode, "types");
  if (!pointArray || !connectivityArray || !offsetsArray || !typesArray) {
    throw new Error("Invalid VTU: required data arrays missing.");
  }

  const points = Array.from(pointArray.values);
  const connectivity = Array.from(connectivityArray.values).map((v) => Math.trunc(v));
  const offsets = Array.from(offsetsArray.values).map((v) => Math.trunc(v));
  const types = Array.from(typesArray.values).map((v) => Math.trunc(v));
  const packed = buildSurfaceFromCells(points, connectivity, offsets, types);

  const pointDataNode = piece.getElementsByTagName("PointData")[0];
  const cellDataNode = piece.getElementsByTagName("CellData")[0];
  const pointArrays = pointDataNode ? getAllDataArrays(pointDataNode) : [];
  const cellArrays = cellDataNode ? getAllDataArrays(cellDataNode) : [];

  const dataset = {
    getPointData: () => ({
      getArrays: () =>
        pointArrays.map((a) => ({
          getName: () => a.label,
          getData: () => a.values,
          getNumberOfComponents: () => a.components,
        })),
    }),
    getCellData: () => ({
      getArrays: () =>
        cellArrays.map((a) => ({
          getName: () => a.label,
          getData: () => a.values,
          getNumberOfComponents: () => a.components,
        })),
    }),
  };

  return { dataset, packed };
}

function makeGeometryFromPolyData(polyData: any) {
  const pointsData = polyData.getPoints()?.getData();
  const polysData = polyData.getPolys()?.getData();
  if (!pointsData || !polysData) {
    throw new Error("VTK poly data does not contain points/polys.");
  }

  const points = Array.from(pointsData as ArrayLike<number>);
  const polys = Array.from(polysData as ArrayLike<number>);
  const triangles = triangulateConnectivity(polys);

  const positions = new Float32Array(triangles.length * 9);
  const sourcePointIds = new Uint32Array(triangles.length * 3);
  const sourceCellIds = new Uint32Array(triangles.length * 3);

  for (let triIdx = 0; triIdx < triangles.length; triIdx += 1) {
    const tri = triangles[triIdx];
    for (let corner = 0; corner < 3; corner += 1) {
      const pid = tri[corner];
      const out = triIdx * 9 + corner * 3;
      positions[out] = points[pid * 3];
      positions[out + 1] = points[pid * 3 + 1];
      positions[out + 2] = points[pid * 3 + 2];
      const mappedIndex = triIdx * 3 + corner;
      sourcePointIds[mappedIndex] = pid;
      sourceCellIds[mappedIndex] = triIdx;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return { geometry, sourcePointIds, sourceCellIds, cellCount: triangles.length };
}

function getAssociationArrays(dataset: any, assoc: "point" | "cell") {
  const data = assoc === "point" ? dataset.getPointData?.() : dataset.getCellData?.();
  const arrays = data?.getArrays?.() ?? [];
  return arrays as any[];
}

function mapFieldToGeometryVertices(
  sourceData: Float32Array,
  sourceMap: Uint32Array,
  components: number,
  mode: "magnitude" | "component",
  componentIndex = 0
) {
  const out = new Float32Array(sourceMap.length);
  for (let i = 0; i < sourceMap.length; i += 1) {
    const sid = sourceMap[i];
    if (components <= 1) {
      out[i] = sourceData[sid];
      continue;
    }
    if (mode === "component") {
      out[i] = sourceData[sid * components + componentIndex] ?? 0;
    } else {
      let sumSq = 0;
      for (let c = 0; c < components; c += 1) {
        const v = sourceData[sid * components + c] ?? 0;
        sumSq += v * v;
      }
      out[i] = Math.sqrt(sumSq);
    }
  }
  return out;
}

export function extractScalars(
  dataset: any,
  sourcePointIds: Uint32Array,
  sourceCellIds: Uint32Array
): ScalarField[] {
  const fields: ScalarField[] = [];

  const pointArrays = getAssociationArrays(dataset, "point");
  pointArrays.forEach((arr) => {
    const name = arr.getName?.() || "pointField";
    const typed = arr.getData?.() as Float32Array | Float64Array | number[] | undefined;
    if (!typed) return;
    const values = typed instanceof Float32Array ? typed : new Float32Array(Array.from(typed));
    const comps = arr.getNumberOfComponents?.() ?? 1;

    if (comps <= 1) {
      const mapped = mapFieldToGeometryVertices(values, sourcePointIds, 1, "component");
      const s = stats(mapped);
      fields.push({
        key: name,
        label: name,
        values: mapped,
        association: "point",
        min: s.min,
        max: s.max,
      });
    } else {
      const mag = mapFieldToGeometryVertices(values, sourcePointIds, comps, "magnitude");
      const ms = stats(mag);
      fields.push({
        key: `${name}_magnitude`,
        label: `${name} (Magnitude)`,
        values: mag,
        association: "point",
        min: ms.min,
        max: ms.max,
      });
      const labels = ["X", "Y", "Z", "W"];
      for (let c = 0; c < Math.min(comps, 4); c += 1) {
        const comp = mapFieldToGeometryVertices(values, sourcePointIds, comps, "component", c);
        const cs = stats(comp);
        fields.push({
          key: `${name}_${labels[c]}`,
          label: `${name} ${labels[c]}`,
          values: comp,
          association: "point",
          min: cs.min,
          max: cs.max,
        });
      }
    }
  });

  const cellArrays = getAssociationArrays(dataset, "cell");
  cellArrays.forEach((arr) => {
    const name = arr.getName?.() || "cellField";
    const typed = arr.getData?.() as Float32Array | Float64Array | number[] | undefined;
    if (!typed) return;
    const values = typed instanceof Float32Array ? typed : new Float32Array(Array.from(typed));
    const comps = arr.getNumberOfComponents?.() ?? 1;
    const baseLabel = `Cell ${name}`;

    if (comps <= 1) {
      const mapped = mapFieldToGeometryVertices(values, sourceCellIds, 1, "component");
      const s = stats(mapped);
      fields.push({
        key: `cell_${name}`,
        label: baseLabel,
        values: mapped,
        association: "cell",
        min: s.min,
        max: s.max,
      });
    } else {
      const mag = mapFieldToGeometryVertices(values, sourceCellIds, comps, "magnitude");
      const ms = stats(mag);
      fields.push({
        key: `cell_${name}_magnitude`,
        label: `${baseLabel} (Magnitude)`,
        values: mag,
        association: "cell",
        min: ms.min,
        max: ms.max,
      });
    }
  });

  return fields;
}

function parsePvdDataSets(pvdText: string) {
  const doc = new DOMParser().parseFromString(pvdText, "application/xml");
  const ds = Array.from(doc.getElementsByTagName("DataSet"));
  return ds
    .map((node) => {
      const file = node.getAttribute("file") ?? "";
      const time = Number(node.getAttribute("timestep") ?? "0");
      if (!file) return null;
      return { file, time: Number.isFinite(time) ? time : 0 };
    })
    .filter((v): v is { file: string; time: number } => Boolean(v));
}

type LoadDataOptions = {
  pvdStepFileResolver?: (relativePath: string) => Promise<File | null>;
  pvdStepIndex?: number;
};

export async function loadData(file: File, options: LoadDataOptions = {}): Promise<LoadedGeometry> {
  const ext = extFromName(file.name);
  if (!ext) {
    throw new Error("Unsupported file format. Use STL, VTK, VTU, PVD, or FOAM.");
  }

  if (ext === "stl") {
    const buf = await file.arrayBuffer();
    const geometry = new STLLoader().parse(buf);
    geometry.computeVertexNormals();
    return { geometry, kind: "stl", scalarFields: [] };
  }

  if (ext === "pvd") {
    const pvdText = await file.text();
    const steps = parsePvdDataSets(pvdText);
    if (!steps.length) {
      throw new Error("PVD file has no DataSet entries.");
    }
    const stepIndex = Math.min(Math.max(options.pvdStepIndex ?? 0, 0), steps.length - 1);
    const step = steps[stepIndex];
    if (!options.pvdStepFileResolver) {
      throw new Error(
        `PVD parsed (${steps.length} steps) but no resolver is available for "${step.file}".`
      );
    }
    const resolved = await options.pvdStepFileResolver(step.file);
    if (!resolved) {
      throw new Error(`Could not resolve PVD step file: ${step.file}`);
    }
    const loadedStep = await loadData(resolved, options);
    return {
      ...loadedStep,
      kind: "pvd",
      timeSteps: steps,
      activeTimeStep: stepIndex,
    };
  }

  const buf = await file.arrayBuffer();
  let dataset: any;
  let packed:
    | { geometry: THREE.BufferGeometry; sourcePointIds: Uint32Array; sourceCellIds: Uint32Array }
    | null = null;

  if (ext === "vtk") {
    const reader = vtkPolyDataReader.newInstance();
    reader.parseAsArrayBuffer(buf);
    dataset = reader.getOutputData(0);
    packed = makeGeometryFromPolyData(dataset);
  } else if (ext === "foam") {
    const text = new TextDecoder().decode(buf);
    const looksLikeLegacyVtk = /(^|\n)\s*#\s*vtk\s+DataFile|(^|\n)\s*DATASET\s+/im.test(text);
    const looksLikeVtuXml = /<\s*VTKFile[\s>]/i.test(text);

    if (!looksLikeLegacyVtk && !looksLikeVtuXml) {
      throw new Error(
        "This .foam file is a marker/reference and does not embed mesh geometry. Upload a full OpenFOAM case archive (.zip/.tar.gz) or export surface data (.vtk/.vtu/.stl)."
      );
    }

    if (looksLikeLegacyVtk) {
      const asciiParsed = parseLegacyAsciiPolyData(text);
      if (asciiParsed) {
        packed = asciiParsed;
        dataset = {
          getPointData: () => ({ getArrays: () => [] }),
          getCellData: () => ({ getArrays: () => [] }),
        };
      } else {
        const reader = vtkPolyDataReader.newInstance();
        reader.parseAsArrayBuffer(buf);
        dataset = reader.getOutputData(0);
        packed = makeGeometryFromPolyData(dataset);
      }
    } else {
      try {
        const vtuParsed = parseVtuXml(text);
        dataset = vtuParsed.dataset;
        packed = vtuParsed.packed;
      } catch {
        const reader = vtkXMLPolyDataReader.newInstance();
        reader.parseAsArrayBuffer(buf);
        dataset = reader.getOutputData(0);
        packed = makeGeometryFromPolyData(dataset);
      }
    }
  } else {
    try {
      const xmlText = new TextDecoder().decode(buf);
      const vtuParsed = parseVtuXml(xmlText);
      dataset = vtuParsed.dataset;
      packed = vtuParsed.packed;
    } catch {
      const reader = vtkXMLPolyDataReader.newInstance();
      reader.parseAsArrayBuffer(buf);
      dataset = reader.getOutputData(0);
      packed = makeGeometryFromPolyData(dataset);
    }
  }

  if (!packed) {
    throw new Error("Could not parse dataset geometry.");
  }

  const scalarFields = extractScalars(dataset, packed.sourcePointIds, packed.sourceCellIds);
  return { geometry: packed.geometry, kind: ext, scalarFields };
}

export async function loadDataset(file: File, options: LoadDataOptions = {}) {
  return loadData(file, options);
}

export function applyColorMap(
  geometry: THREE.BufferGeometry,
  field: ScalarField,
  colorMap: ColorMapName,
  manualRange?: { min: number; max: number },
  options?: { reverse?: boolean }
) {
  const values = field.values;
  const min = manualRange ? manualRange.min : field.min;
  const max = manualRange ? manualRange.max : field.max;
  const table = buildLookupTable(colorMap);
  const colors = new Float32Array(values.length * 3);
  for (let i = 0; i < values.length; i += 1) {
    let t = normalize(values[i], min, max);
    if (options?.reverse) t = 1 - t;
    const c = sampleLookupTable(table, t);
    const out = i * 3;
    colors[out] = c.r;
    colors[out + 1] = c.g;
    colors[out + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return { min, max };
}

export function probeValue(field: ScalarField, face: { a: number; b: number; c: number }): ProbeResult {
  const a = face.a;
  const b = face.b;
  const c = face.c;
  const va = field.values[a] ?? 0;
  const vb = field.values[b] ?? 0;
  const vc = field.values[c] ?? 0;
  return {
    indexA: a,
    indexB: b,
    indexC: c,
    value: (va + vb + vc) / 3,
  };
}

function tokenizeExpression(expr: string) {
  return expr.match(/[A-Za-z_]\w*|\d+(\.\d+)?|[\+\-\*\/\^\(\),]/g) ?? [];
}

/**
 * Map ParaView-style names (velocity_X, pressure) to actual array keys (U_X, p, …).
 */
export function rewriteCalculatorAliases(expr: string, fields: ScalarField[]): string {
  const keys = new Set(fields.map((f) => f.key));
  let out = expr;

  const pickAxis = (axis: "X" | "Y" | "Z") => {
    const candidates = [`U_${axis}`, `V_${axis}`, `vel_${axis}`, `velocity_${axis}`];
    for (const c of candidates) {
      if (keys.has(c)) return c;
    }
    const suffix = `_${axis}`;
    const matches = fields
      .map((f) => f.key)
      .filter((k) => k.endsWith(suffix) && !/magnitude/i.test(k));
    const preferred = matches.find((k) => /^[UV]_/.test(k));
    return preferred ?? matches[0];
  };

  const vx = pickAxis("X");
  const vy = pickAxis("Y");
  const vz = pickAxis("Z");
  if (vx) {
    out = out.replace(/\bvelocity_X\b/gi, vx);
    out = out.replace(/\bvel_X\b/gi, vx);
  }
  if (vy) {
    out = out.replace(/\bvelocity_Y\b/gi, vy);
    out = out.replace(/\bvel_Y\b/gi, vy);
  }
  if (vz) {
    out = out.replace(/\bvelocity_Z\b/gi, vz);
    out = out.replace(/\bvel_Z\b/gi, vz);
  }

  const magKey =
    fields.find((f) => f.key === "U_magnitude")?.key ??
    fields.find((f) => /_magnitude$/i.test(f.key) && /U|V|velocity|vel/i.test(f.key))?.key;
  if (magKey) {
    out = out.replace(/\bvelocity_magnitude\b/gi, magKey);
    out = out.replace(/\bvel_mag\b/gi, magKey);
  }

  const pressureKey =
    fields.find((f) => /^p$/i.test(f.key))?.key ??
    fields.find((f) => /^pressure$/i.test(f.key))?.key ??
    fields.find((f) => /pressure/i.test(f.label) && f.key.startsWith("cell_") === false)?.key ??
    fields.find((f) => /pressure/i.test(f.label))?.key;
  if (pressureKey) {
    out = out.replace(/\bpressure\b/gi, pressureKey);
  }

  const tempKey =
    fields.find((f) => /^T$/i.test(f.key))?.key ??
    fields.find((f) => /^temperature$/i.test(f.key))?.key ??
    fields.find((f) => /temperature/i.test(f.label))?.key;
  if (tempKey) {
    out = out.replace(/\btemperature\b/gi, tempKey);
  }

  return out;
}

function safeEvalExpression(expr: string, scope: Record<string, number>) {
  const transformed = expr
    .replace(/\^/g, "**")
    .replace(/\bsqrt\s*\(/g, "Math.sqrt(")
    .replace(/\bpow\s*\(/g, "Math.pow(")
    .replace(/\babs\s*\(/g, "Math.abs(")
    .replace(/\bmin\s*\(/g, "Math.min(")
    .replace(/\bmax\s*\(/g, "Math.max(")
    .replace(/\bsin\s*\(/g, "Math.sin(")
    .replace(/\bcos\s*\(/g, "Math.cos(")
    .replace(/\btan\s*\(/g, "Math.tan(")
    .replace(/\bexp\s*\(/g, "Math.exp(")
    .replace(/\blog\s*\(/g, "Math.log(");
  const keys = Object.keys(scope);
  const vals = Object.values(scope);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `return (${transformed});`) as (...args: number[]) => number;
  const result = fn(...vals);
  return Number.isFinite(result) ? result : 0;
}

const CALC_RESERVED = new Set([
  "sqrt",
  "pow",
  "abs",
  "min",
  "max",
  "sin",
  "cos",
  "tan",
  "exp",
  "log",
  "Math",
]);

export function computeDerivedField(
  expression: string,
  fields: ScalarField[],
  outputKey = "Result"
): ScalarField {
  if (!expression.trim()) {
    throw new Error("Calculator expression is empty.");
  }
  if (!fields.length) {
    throw new Error("No scalar fields available for calculator.");
  }

  const rewritten = rewriteCalculatorAliases(expression.trim(), fields);
  const tokens = tokenizeExpression(rewritten);
  const known = new Set(fields.map((f) => f.key));
  tokens.forEach((t) => {
    if (/^[A-Za-z_]\w*$/.test(t) && !CALC_RESERVED.has(t) && !known.has(t)) {
      const hint = [...known].slice(0, 12).join(", ");
      throw new Error(
        `Unknown field "${t}". Available keys include: ${hint}${known.size > 12 ? ", …" : ""}. ` +
          `Tip: use velocity_X / velocity_Y / velocity_Z for OpenFOAM-style U_X / U_Y / U_Z.`
      );
    }
  });

  const len = fields[0].values.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const scope: Record<string, number> = {};
    fields.forEach((f) => {
      scope[f.key] = f.values[i] ?? 0;
    });
    out[i] = safeEvalExpression(rewritten, scope);
  }
  const s = stats(out);
  return {
    key: outputKey,
    label: outputKey,
    values: out,
    association: "derived",
    min: s.min,
    max: s.max,
  };
}

export function applyStlMockField(
  geometry: THREE.BufferGeometry,
  key: ScalarFieldKey,
  options?: { reverse?: boolean }
): ScalarField | null {
  if (key === "solid") return null;
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return null;
  const { values, stats: s } = createMockScalarValues(pos, key);
  applyMockScalarColors(geometry, key, options);
  return {
    key,
    label: key[0].toUpperCase() + key.slice(1),
    values,
    association: "mock",
    min: s.min,
    max: s.max,
  };
}

export function getLegendGradientForColorMap(
  colorMap: ColorMapName,
  fallbackField?: ScalarFieldKey,
  reverse?: boolean
) {
  const dir = reverse ? "to bottom" : "to top";
  if (fallbackField && fallbackField !== "solid") {
    const g = getLegendGradient(fallbackField);
    if (!reverse) return g;
    return g.replace(/to top/g, "to bottom");
  }
  if (colorMap === "coolToWarm")
    return `linear-gradient(${dir}, #3b82f6, #f8fafc, #ef4444)`;
  if (colorMap === "viridis") return `linear-gradient(${dir}, #440154, #21908d, #fde725)`;
  return `linear-gradient(${dir}, #00007f, #00b5ff, #ffef00, #ff2300)`;
}

/** Resolve U_X / U_Y / U_Z (or first vector components) for glyphs & streamlines. */
export function findVelocityComponents(fields: ScalarField[]): {
  fx: ScalarField;
  fy: ScalarField;
  fz: ScalarField;
} | null {
  const kx =
    fields.find((f) => f.key === "U_X") ??
    fields.find((f) => /^[UV]_X$/i.test(f.key)) ??
    fields.find((f) => f.key.endsWith("_X") && /vel|U|V/i.test(f.key));
  const ky =
    fields.find((f) => f.key === "U_Y") ??
    fields.find((f) => /^[UV]_Y$/i.test(f.key)) ??
    fields.find((f) => f.key.endsWith("_Y") && /vel|U|V/i.test(f.key));
  const kz =
    fields.find((f) => f.key === "U_Z") ??
    fields.find((f) => /^[UV]_Z$/i.test(f.key)) ??
    fields.find((f) => f.key.endsWith("_Z") && /vel|U|V/i.test(f.key));
  if (!kx || !ky || !kz) return null;
  if (kx.values.length !== ky.values.length || kx.values.length !== kz.values.length) return null;
  return { fx: kx, fy: ky, fz: kz };
}
