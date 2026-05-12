import { useEffect, useRef, useState } from "react";
import "@kitware/vtk.js/Rendering/Profiles/Geometry";
import vtkXMLUnstructuredGridReader from "../vtk/XMLUnstructuredGridReader";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import vtkScalarBarActor from "@kitware/vtk.js/Rendering/Core/ScalarBarActor.js";
import vtkLookupTable from "@kitware/vtk.js/Common/Core/LookupTable.js";
import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow.js";
import vtkPlane from "@kitware/vtk.js/Common/DataModel/Plane.js";
import vtkCutter from "@kitware/vtk.js/Filters/Core/Cutter.js";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray.js";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import vtkPointPicker from "@kitware/vtk.js/Rendering/Core/PointPicker.js";
import vtkCellPicker from "@kitware/vtk.js/Rendering/Core/CellPicker.js";
import vtkDataSetSurfaceFilter from "../vtk/DataSetSurfaceFilter";
import { useAppLayout } from "../context/AppLayoutContext";
import {
  viewerMiniBtn,
  viewerNextFab,
  viewerNextFabDisabled,
  viewerNextFabEnabled,
  viewerToolbarBtn,
  viewerToolbarBtnLensActive,
} from "./viewerToolbarClasses";

export type GeometryResultsNav = {
  /** Backend produced lift/drag chart data for this session */
  chartsReady: boolean;
  /** Pipeline / LLM turn in progress */
  pipelineBusy?: boolean;
  /** Full-screen CL→CD wizard is active */
  resultsWizardOpen?: boolean;
  /** Opens CL step; present only when charts ready and wizard is closed */
  onContinueToCL?: () => void;
  /** Close immersive flow and return to the main chat page */
  onExit?: () => void;
};

/** Single floating control — full explanation via native tooltip when disabled */
export function GeometryResultsNextFab({
  nav,
  viewerBusy,
}: {
  nav: GeometryResultsNav;
  viewerBusy: boolean;
}) {
  const wizardOpen = Boolean(nav.resultsWizardOpen && nav.chartsReady);
  const canActivate = Boolean(nav.onContinueToCL) && !viewerBusy && !wizardOpen;

  const title = wizardOpen
    ? "Results wizard is open — use Next there or Back to geometry."
    : canActivate
      ? "Next: open lift coefficient (CL)"
      : nav.pipelineBusy
        ? "Simulation running — Next unlocks when CL/CD charts are ready."
        : nav.chartsReady
          ? "Open CL when the viewer is ready."
          : "Run analysis from chat — Next unlocks when CL/CD charts are ready.";

  return (
    <div className="pointer-events-none absolute inset-0 z-[150] flex items-end justify-center pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))] pl-4 pr-4 sm:justify-end sm:pr-7">
      <div className="pointer-events-auto">
        <button
          type="button"
          title={title}
          aria-label={title}
          disabled={!canActivate}
          onClick={() => nav.onContinueToCL?.()}
          className={`${viewerNextFab} ${canActivate ? viewerNextFabEnabled : viewerNextFabDisabled}`}
        >
          Next
        </button>
      </div>
    </div>
  );
}

type VtuPreviewProps = {
  vtuUrl: string;
  fileName: string;
  /** Always-on footer: where “next” (CL) lives after geometry */
  geometryResultsNav?: GeometryResultsNav;
};

type ScalarOption = {
  key: string;
  label: string;
  association: "point" | "cell";
  name: string;
  range?: [number, number];
};
type ScalarDisplayMode = "surfaceOnly" | "surfaceMesh";
type HoverProbe = { x: number; y: number; lines: string[] };
type ZoomBox = { left: number; top: number; width: number; height: number };
type AxisView = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
type LensDragState = {
  pointerId: number;
  mode: "draw" | "move" | "resize";
  startX: number;
  startY: number;
  startBox: ZoomBox;
  handle?: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
};
type LegendState = {
  visible: boolean;
  title: string;
  min: number;
  max: number;
};

const API_ROOT = import.meta.env.PROD ? "" : "http://localhost:8000";
export default function VtuPreview({ vtuUrl, fileName, geometryResultsNav }: VtuPreviewProps) {
  const { hideSidebar } = useAppLayout();
  const readStoredRepresentation = (): "solid" | "mesh" => {
    try {
      const raw = window.localStorage.getItem("vtuViewer.representation");
      return raw === "mesh" ? "mesh" : "solid";
    } catch {
      return "solid";
    }
  };
  const readStoredScalarDisplayMode = (): ScalarDisplayMode => {
    try {
      const mode = window.localStorage.getItem("vtuViewer.scalarDisplayMode");
      if (mode === "surfaceOnly" || mode === "surfaceMesh") return mode;
      // Backward compatibility with old checkbox state.
      return window.localStorage.getItem("vtuViewer.scalarMeshOverlay") === "1" ? "surfaceMesh" : "surfaceOnly";
    } catch {
      return "surfaceOnly";
    }
  };
  const readStoredScalar = (): string => {
    try {
      return window.localStorage.getItem("vtuViewer.selectedScalar") ?? "solid";
    } catch {
      return "solid";
    }
  };
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<string>("");
  const [representation, setRepresentation] = useState<"solid" | "mesh">(readStoredRepresentation);
  const [opacity, setOpacity] = useState(1);
  const [sliceEnabled, setSliceEnabled] = useState(false);
  const [slicePosition, setSlicePosition] = useState(0);
  const [sliceRange, setSliceRange] = useState<{ min: number; max: number }>({ min: -1, max: 1 });
  const [zoomLensEnabled, setZoomLensEnabled] = useState(false);
  const [lineWidth, setLineWidth] = useState(1.5);
  const [ambient, setAmbient] = useState(0.25);
  const [diffuse, setDiffuse] = useState(0.8);
  const [scalarOptions, setScalarOptions] = useState<ScalarOption[]>([]);
  const [selectedScalar, setSelectedScalar] = useState<string>(readStoredScalar);
  const [scalarDisplayMode, setScalarDisplayMode] = useState<ScalarDisplayMode>(readStoredScalarDisplayMode);
  const [scalarInfo, setScalarInfo] = useState<string>("");
  const [scalarInfoLevel, setScalarInfoLevel] = useState<"info" | "warn" | "error">("info");
  const [legendState, setLegendState] = useState<LegendState>({
    visible: false,
    title: "",
    min: 0,
    max: 1,
  });
  const [hoverProbe, setHoverProbe] = useState<HoverProbe | null>(null);
  const [zoomBox, setZoomBox] = useState<ZoomBox | null>(null);
  const actorRef = useRef<any>(null);
  const outlineActorRef = useRef<any>(null);
  const mapperRef = useRef<any>(null);
  const renderWindowRef = useRef<any>(null);
  const datasetRef = useRef<any>(null);
  const surfaceDataRef = useRef<any>(null);
  const planeRef = useRef<any>(null);
  const cutterRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const cameraHomeRef = useRef<{ position: [number, number, number]; focalPoint: [number, number, number] } | null>(null);
  const datasetCenterRef = useRef<[number, number, number]>([0, 0, 0]);
  const datasetRadiusRef = useRef(1);
  const isNear2DRef = useRef(false);
  const pointPickerRef = useRef<any>(null);
  const cellPickerRef = useRef<any>(null);
  const scalarBarRef = useRef<any>(null);
  const lookupTableRef = useRef<any>(null);
  const zoomLensEnabledRef = useRef(false);
  const zoomDragRef = useRef<LensDragState | null>(null);
  const zoomBoxRef = useRef<ZoomBox | null>(null);

  /** Same convention as vtk RenderWindowInteractor (canvas pixels, Y from bottom). */
  const clientXYToVtkPickerCoords = (clientX: number, clientY: number): [number, number] | null => {
    const rw = renderWindowRef.current;
    if (!rw) return null;
    const view = rw.getViews?.()?.[0];
    const canvas: HTMLCanvasElement | null | undefined = view?.getCanvas?.();
    if (!canvas) return null;
    const b = canvas.getBoundingClientRect();
    const bw = Math.max(b.width, 1e-9);
    const bh = Math.max(b.height, 1e-9);
    const scaleX = canvas.width / bw;
    const scaleY = canvas.height / bh;
    const x = scaleX * (clientX - b.left);
    const y = scaleY * (bh - (clientY - b.top));
    return [x, y];
  };

  const setDisplayMode = (
    actor: any,
    mode: "solid" | "mesh" | "scalar",
    scalarOverlay = false
  ) => {
    const navyBody: [number, number, number] = [0.12, 0.2, 0.38];
    // ParaView-like separation:
    // - solid: surface only
    // - mesh: wireframe (always visible)
    // - scalar: surface with scalar colors, optional edge overlay
    actor.getProperty().setRepresentation(mode === "mesh" ? 1 : 2);
    // In scalar mode, edges should be controlled ONLY by scalarOverlay (Surface only vs Surface + mesh).
    // In non-scalar modes, Representation=mesh still forces edges.
    const forceMeshEdges = representation === "mesh" && mode !== "scalar";
    const showEdges = mode === "mesh" || (mode === "scalar" ? scalarOverlay : forceMeshEdges);
    actor.getProperty().setEdgeVisibility(showEdges ? 1 : 0);
    if (mode === "mesh") {
      // Strong contrast for clear mesh visibility.
      actor.getProperty().setEdgeColor?.(0.2, 0.45, 0.95);
      actor.getProperty().setColor?.(...navyBody);
      actor.getProperty().setLighting?.(false);
      actor.getProperty().setLineWidth?.(2.2);
    } else if (mode === "scalar" && showEdges) {
      // Keep mesh readable over colormap.
      actor.getProperty().setEdgeColor?.(0.2, 0.45, 0.95);
      actor.getProperty().setLineWidth?.(1.3);
    } else {
      actor.getProperty().setEdgeColor?.(0.0, 0.0, 0.0);
      actor.getProperty().setColor?.(...navyBody);
      actor.getProperty().setLighting?.(true);
      actor.getProperty().setLineWidth?.(lineWidth);
    }
  };
  const buildBoundaryOutlinePolyData = (poly: any) => {
    const points = poly?.getPoints?.();
    const polys = poly?.getPolys?.()?.getData?.();
    if (!points || !polys || !polys.length) return null;
    const edgeCount = new Map<string, { a: number; b: number; c: number }>();
    for (let i = 0; i < polys.length; ) {
      const n = Number(polys[i] ?? 0);
      i += 1;
      if (!Number.isFinite(n) || n < 2 || i + n > polys.length) break;
      const ids: number[] = [];
      for (let k = 0; k < n; k += 1) ids.push(Number(polys[i + k] ?? 0));
      i += n;
      for (let k = 0; k < ids.length; k += 1) {
        const a = ids[k];
        const b = ids[(k + 1) % ids.length];
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = `${lo},${hi}`;
        const prev = edgeCount.get(key);
        if (prev) prev.c += 1;
        else edgeCount.set(key, { a: lo, b: hi, c: 1 });
      }
    }
    const packedLines: number[] = [];
    edgeCount.forEach((e) => {
      if (e.c === 1) packedLines.push(2, e.a, e.b);
    });
    if (!packedLines.length) return null;
    const out = vtkPolyData.newInstance();
    out.setPoints(points);
    out.getLines().setData(new Uint32Array(packedLines));
    return out;
  };
  const isScalarMode = selectedScalar !== "solid" && selectedScalar !== "mesh";
  const pickArrayByName = (ds: any, assoc: "point" | "cell", arrayName: string) => {
    const fd = assoc === "point" ? ds?.getPointData?.() : ds?.getCellData?.();
    const byName = fd?.getArrayByName?.(arrayName);
    if (byName) return byName;
    const arrays = fd?.getArrays?.() ?? [];
    return arrays.find((a: any) => String(a?.getName?.() ?? "") === arrayName) ?? null;
  };
  const resolveScalarArray = (
    polyData: any,
    selectedName: string
  ): {
    array: any;
    association: "point" | "cell" | null;
    pointData: any;
    cellData: any;
  } => {
    const pointData = polyData?.getPointData?.();
    const cellData = polyData?.getCellData?.();
    const pointArray =
      pointData?.getArrayByName?.(selectedName) ?? pickArrayByName(polyData, "point", selectedName);
    const cellArray =
      cellData?.getArrayByName?.(selectedName) ?? pickArrayByName(polyData, "cell", selectedName);
    if (pointArray) return { array: pointArray, association: "point", pointData, cellData };
    if (cellArray) return { array: cellArray, association: "cell", pointData, cellData };
    return { array: null, association: null, pointData, cellData };
  };
  const getFieldArrayNames = (fieldData: any): string[] =>
    (fieldData?.getArrays?.() ?? [])
      .map((a: any) => String(a?.getName?.() ?? "").trim())
      .filter(Boolean);
  const computeRobustRange = (arr: any): [number, number] | null => {
    const data = arr?.getData?.();
    if (!data || typeof data.length !== "number" || data.length === 0) return null;
    const comps = Math.max(1, Number(arr?.getNumberOfComponents?.() ?? 1));
    const vals: number[] = [];
    for (let i = 0; i < data.length; i += comps) {
      const v = Number(data[i]);
      if (Number.isFinite(v)) vals.push(v);
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    const q = (p: number) => {
      const idx = Math.max(0, Math.min(vals.length - 1, Math.floor(p * (vals.length - 1))));
      return vals[idx];
    };
    const q01 = q(0.01);
    const q99 = q(0.99);
    if (!Number.isFinite(q01) || !Number.isFinite(q99)) return null;
    if (q99 <= q01) return [q01 - 1e-12, q01 + 1e-12];
    return [q01, q99];
  };
  const computeRobustRangeOnUsedSurfacePoints = (poly: any, arr: any): [number, number] | null => {
    const polys = poly?.getPolys?.()?.getData?.();
    const values = arr?.getData?.();
    const comps = Math.max(1, Number(arr?.getNumberOfComponents?.() ?? 1));
    if (!polys || !values || comps < 1) return null;
    const used = new Set<number>();
    for (let i = 0; i < polys.length; ) {
      const n = Number(polys[i] ?? 0);
      i += 1;
      if (!Number.isFinite(n) || n < 1) break;
      for (let k = 0; k < n && i < polys.length; k += 1, i += 1) {
        const pid = Number(polys[i]);
        if (Number.isFinite(pid) && pid >= 0) used.add(pid);
      }
    }
    if (!used.size) return null;
    const vals: number[] = [];
    used.forEach((pid) => {
      const base = pid * comps;
      const v = Number(values[base]);
      if (Number.isFinite(v)) vals.push(v);
    });
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    const at = (p: number) => {
      const idx = Math.max(0, Math.min(vals.length - 1, Math.floor(p * (vals.length - 1))));
      return vals[idx];
    };
    const q01 = at(0.01);
    const q99 = at(0.99);
    if (!Number.isFinite(q01) || !Number.isFinite(q99)) return null;
    if (q99 <= q01) return [q01 - 1e-12, q01 + 1e-12];
    return [q01, q99];
  };
  const interpolateCellToPointScalars = (poly: any, cellArray: any, outName: string) => {
    const polys = poly?.getPolys?.()?.getData?.();
    const nPts = Number(poly?.getNumberOfPoints?.() ?? 0);
    const src = cellArray?.getData?.();
    const comps = Number(cellArray?.getNumberOfComponents?.() ?? 1);
    const nCells = Number(cellArray?.getNumberOfTuples?.() ?? 0);
    if (!polys || !src || !nPts || !nCells || comps < 1) return null;
    const sums = new Float32Array(nPts * comps);
    const counts = new Uint32Array(nPts);
    let cellId = 0;
    for (let i = 0; i < polys.length && cellId < nCells; ) {
      const n = Number(polys[i] ?? 0);
      i += 1;
      if (!Number.isFinite(n) || n < 1 || i + n > polys.length) break;
      for (let k = 0; k < n; k += 1) {
        const pid = Number(polys[i + k] ?? -1);
        if (pid < 0 || pid >= nPts) continue;
        counts[pid] += 1;
        for (let c = 0; c < comps; c += 1) {
          sums[pid * comps + c] += Number(src[cellId * comps + c] ?? 0);
        }
      }
      i += n;
      cellId += 1;
    }
    for (let p = 0; p < nPts; p += 1) {
      const cnt = counts[p] || 1;
      for (let c = 0; c < comps; c += 1) {
        sums[p * comps + c] /= cnt;
      }
    }
    return vtkDataArray.newInstance({
      name: outName,
      numberOfComponents: comps,
      values: sums,
    });
  };

  // ParaView "Cool to Warm" anchors (blue -> light gray -> red).
  const sampleParaViewCoolWarm = (tRaw: number): [number, number, number] => {
    const t = Math.max(0, Math.min(1, Number.isFinite(tRaw) ? tRaw : 0));
    const cool: [number, number, number] = [59 / 255, 76 / 255, 192 / 255];
    const mid: [number, number, number] = [221 / 255, 221 / 255, 221 / 255];
    const warm: [number, number, number] = [180 / 255, 4 / 255, 38 / 255];
    if (t <= 0.5) {
      const u = t / 0.5;
      return [
        cool[0] * (1 - u) + mid[0] * u,
        cool[1] * (1 - u) + mid[1] * u,
        cool[2] * (1 - u) + mid[2] * u,
      ];
    }
    const u = (t - 0.5) / 0.5;
    return [
      mid[0] * (1 - u) + warm[0] * u,
      mid[1] * (1 - u) + warm[1] * u,
      mid[2] * (1 - u) + warm[2] * u,
    ];
  };

  /**
   * ParaView-like cool–warm without HSV hue artifacts.
   * Explicit RGB table + vtk setTable (reliable in vtk.js WebGL).
   */
  const applyCoolToWarmExplicitLUT = (lut: any, min: number, max: number) => {
    if (!lut) return;
    const hi = max > min ? max : min + 1e-12;
    const n = 256;
    const table: number[][] = [];
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      const [r01, g01, b01] = sampleParaViewCoolWarm(t);
      table.push([Math.round(r01 * 255), Math.round(g01 * 255), Math.round(b01 * 255), 255]);
    }
    lut.setNumberOfColors?.(n);
    lut.setTable?.(table);
    lut.setRange?.(min, hi);
    lut.setNanColor?.(0.35, 0.35, 0.35, 1.0);
    lut.build?.();
  };

  const buildScalarOptions = (dataset: any): ScalarOption[] => {
    const out: ScalarOption[] = [];
    const appendFrom = (association: "point" | "cell", data: any) => {
      const arrays = data?.getArrays?.() ?? [];
      const expectedTuples =
        association === "point"
          ? Number(dataset?.getNumberOfPoints?.() ?? 0)
          : Number(dataset?.getNumberOfCells?.() ?? 0);
      arrays.forEach((arr: any) => {
        const name = String(arr?.getName?.() ?? "").trim();
        const comps = Number(arr?.getNumberOfComponents?.() ?? 1);
        const tuples = Number(arr?.getNumberOfTuples?.() ?? 0);
        if (!name) return;
        // Keep only arrays that align with rendered geometry topology.
        if (expectedTuples > 0 && tuples > 0 && tuples !== expectedTuples) return;
        if (comps <= 1) {
          const r = arr?.getRange?.(0);
          out.push({
            key: `${association}:${name}`,
            label: `${name} (${association})`,
            association,
            name,
            range: Array.isArray(r) && r.length >= 2 ? [Number(r[0]), Number(r[1])] : undefined,
          });
          return;
        }
        // For vectors (e.g. velocity/U), add a magnitude scalar array for coloring.
        const magName = `${name}_mag`;
        const existingMag = data.getArrayByName?.(magName);
        if (existingMag) {
          const r = existingMag.getRange?.(0);
          out.push({
            key: `${association}:${magName}`,
            label: `${name} magnitude (${association})`,
            association,
            name: magName,
            range: Array.isArray(r) && r.length >= 2 ? [Number(r[0]), Number(r[1])] : undefined,
          });
          return;
        }
        const src = arr?.getData?.();
        const tupleCount = Number(arr?.getNumberOfTuples?.() ?? 0);
        if (!src || !tupleCount || comps < 2) return;
        const mag = new Float32Array(tupleCount);
        for (let i = 0; i < tupleCount; i += 1) {
          let s = 0;
          for (let c = 0; c < comps; c += 1) {
            const v = Number(src[i * comps + c] ?? 0);
            s += v * v;
          }
          mag[i] = Math.sqrt(s);
        }
        const magArray = vtkDataArray.newInstance({
          name: magName,
          numberOfComponents: 1,
          values: mag,
        });
        data.addArray?.(magArray);
        const r = magArray.getRange?.(0);
        out.push({
          key: `${association}:${magName}`,
          label: `${name} magnitude (${association})`,
          association,
          name: magName,
          range: Array.isArray(r) && r.length >= 2 ? [Number(r[0]), Number(r[1])] : undefined,
        });
      });
    };
    appendFrom("point", dataset?.getPointData?.());
    appendFrom("cell", dataset?.getCellData?.());
    return out;
  };

  useEffect(() => {
    zoomLensEnabledRef.current = zoomLensEnabled;
    zoomBoxRef.current = zoomBox;
    if (!zoomLensEnabled) {
      const interactor = renderWindowRef.current?.getInteractor?.();
      interactor?.enable?.();
      zoomDragRef.current = null;
      setZoomBox(null);
    }
    const mount = mountRef.current;
    if (!mount) return;
    mount.style.cursor = zoomLensEnabled ? "zoom-in" : "default";
    return () => {
      mount.style.cursor = "default";
    };
  }, [zoomLensEnabled, zoomBox]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let detachPointerHandlers: (() => void) | null = null;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const clampBoxToRect = (box: ZoomBox, rect: DOMRect): ZoomBox => {
      const left = clamp(box.left, 0, rect.width);
      const top = clamp(box.top, 0, rect.height);
      const right = clamp(box.left + box.width, 0, rect.width);
      const bottom = clamp(box.top + box.height, 0, rect.height);
      return {
        left: Math.min(left, right),
        top: Math.min(top, bottom),
        width: Math.abs(right - left),
        height: Math.abs(bottom - top),
      };
    };
    let fsrw: any = null;
    let actor: any = null;
    let mapper: any = null;
    let outlineActor: any = null;
    let outlineMapper: any = null;
    let reader: any = null;
    let surfaceFilter: any = null;
    let cutter: any = null;
    let slicePlane: any = null;
    let pointPicker: any = null;
    let cellPicker: any = null;
    let scalarBar: any = null;
    let lookupTable: any = null;
    let scalarBarAttached = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setMeta("");
      try {
        const url = /^https?:\/\//i.test(vtuUrl) || vtuUrl.startsWith("blob:") ? vtuUrl : `${API_ROOT}${vtuUrl}`;
        if (!url.startsWith("blob:") && !/\.vtu(\?|#|$)/i.test(url)) {
          throw new Error(`VTU viewer only accepts .vtu resources. Got: ${url}`);
        }
        console.log("VTU path selected:", url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load VTU (${response.status})`);
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        reader = vtkXMLUnstructuredGridReader.newInstance();
        reader.parseAsArrayBuffer(arrayBuffer);
        const dataset = reader.getOutputData(0);
        if (!dataset) throw new Error("No renderable dataset from VTU.");
        (window as any)._vtuDebug = dataset;
        // Derive vector magnitudes (e.g. U_mag) on the dataset *before* surface extraction
        // so those arrays exist on surface polydata for scalar coloring.
        const options = buildScalarOptions(dataset);
        surfaceFilter = vtkDataSetSurfaceFilter.newInstance();
        surfaceFilter.setInputData(dataset);
        surfaceFilter.update();
        const surfaceData = surfaceFilter.getOutputData();
        if (!surfaceData) throw new Error("Surface extraction failed.");
        console.info("[VtuPreview] scalars: vtk.js texture LUT + tcoords; legend: cool–warm RGB LUT");
        console.log("VTU reader used: vtkXMLUnstructuredGridReader");
        console.log("VTU dataset.getPoints():", dataset.getPoints?.());
        console.log("VTU dataset.getCells():", dataset.getCells?.());
        datasetRef.current = dataset;
        surfaceDataRef.current = surfaceData;
        setScalarOptions(options);
        console.log("VTU available scalar fields:", options.map((o) => o.key));
        const pointArrays = (dataset?.getPointData?.()?.getArrays?.() ?? []).map((a: any) => String(a?.getName?.() ?? ""));
        const cellArrays = (dataset?.getCellData?.()?.getArrays?.() ?? []).map((a: any) => String(a?.getName?.() ?? ""));
        console.log("VTU point arrays:", pointArrays);
        console.log("VTU cell arrays:", cellArrays);
        const pdNames = getFieldArrayNames(dataset?.getPointData?.());
        const cdNames = getFieldArrayNames(dataset?.getCellData?.());
        console.log("VTU point array names:", pdNames);
        console.log("VTU cell array names:", cdNames);
        const preferred =
          options.find((o) => o.association === "point" && /^p$/i.test(o.name)) ||
          options.find((o) => o.association === "point" && /^pressure$/i.test(o.name)) ||
          options.find((o) => /^point:(p|pressure)$/i.test(o.key)) ||
          options.find((o) => /velocity|_mag/i.test(o.name)) ||
          options.find((o) => o.association === "point") ||
          options[0];
        setSelectedScalar(preferred ? preferred.key : "solid");

        mapper = vtkMapper.newInstance();
        lookupTable = vtkLookupTable.newInstance();
        applyCoolToWarmExplicitLUT(lookupTable, 0, 1);
        mapper.setLookupTable?.(lookupTable);
        mapper.setInputData(surfaceData);
        mapper.setScalarVisibility(false);
        actor = vtkActor.newInstance();
        actor.setMapper(mapper);
        const outlinePoly = buildBoundaryOutlinePolyData(surfaceData);
        if (outlinePoly) {
          outlineMapper = vtkMapper.newInstance();
          outlineMapper.setInputData(outlinePoly);
          // Keep boundary lines visible over coplanar surface triangles.
          outlineMapper.setResolveCoincidentTopologyToPolygonOffset?.();
          outlineMapper.setResolveCoincidentTopologyPolygonOffsetParameters?.(1, 1);
          outlineMapper.setResolveCoincidentTopologyLineOffsetParameters?.(-2, -2);
          outlineActor = vtkActor.newInstance();
          outlineActor.setMapper(outlineMapper);
          outlineActor.getProperty().setColor?.(0.0, 0.0, 0.0);
          outlineActor.getProperty().setLineWidth?.(3.2);
          outlineActor.getProperty().setRenderLinesAsTubes?.(true);
          outlineActor.getProperty().setOpacity?.(1.0);
          outlineActor.getProperty().setLighting?.(false);
          outlineActor.setVisibility(false);
        }
        actorRef.current = actor;
        outlineActorRef.current = outlineActor;
        mapperRef.current = mapper;
        lookupTableRef.current = lookupTable;
        // default style for loaded VTU
        setDisplayMode(actor, representation === "mesh" ? "mesh" : "solid", scalarDisplayMode === "surfaceMesh");
        actor.getProperty().setOpacity(opacity);
        actor.getProperty().setLineWidth(lineWidth);
        actor.getProperty().setAmbient(ambient);
        actor.getProperty().setDiffuse(diffuse);

        // Slice pipeline: dataset -> cutter -> mapper (when enabled)
        slicePlane = vtkPlane.newInstance();
        slicePlane.setNormal(0, 0, 1);
        cutter = vtkCutter.newInstance();
        cutter.setCutFunction(slicePlane);
        cutter.setInputData(dataset);
        planeRef.current = slicePlane;
        cutterRef.current = cutter;

        fsrw = vtkFullScreenRenderWindow.newInstance({
          container: mount,
          containerStyle: { width: "100%", height: "100%", position: "relative", overflow: "hidden" },
          background: [0.14, 0.16, 0.2],
        });
        const renderer = fsrw.getRenderer();
        const renderWindow = fsrw.getRenderWindow();
        renderWindowRef.current = renderWindow;
        rendererRef.current = renderer;
        pointPicker = vtkPointPicker.newInstance();
        pointPicker.setUseCells?.(true);
        cellPicker = vtkCellPicker.newInstance();
        pointPickerRef.current = pointPicker;
        cellPickerRef.current = cellPicker;
        renderer.removeAllActors();
        renderer.addActor(actor);
        if (outlineActor) renderer.addActor(outlineActor);
        try {
          scalarBar = vtkScalarBarActor.newInstance();
          scalarBarRef.current = scalarBar;
          scalarBar.setVisibility(false);
          scalarBar.setAxisLabel("Solid");
          // Keep vtk scalar bar detached; we use the custom HTML legend panel.
          scalarBar.setNumberOfLabels?.(6);
          scalarBarAttached = false;
        } catch (scalarBarError) {
          console.warn("VTU scalar bar unavailable, continuing without legend:", scalarBarError);
          scalarBar = null;
          scalarBarRef.current = null;
          scalarBarAttached = false;
        }
        renderer.resetCamera();
        renderer.resetCameraClippingRange();
        const cam = renderer.getActiveCamera?.();
        if (cam) {
          cameraHomeRef.current = {
            position: [...(cam.getPosition?.() ?? [0, 0, 1])] as [number, number, number],
            focalPoint: [...(cam.getFocalPoint?.() ?? [0, 0, 0])] as [number, number, number],
          };
        }
        renderWindow.render();

        const points = dataset.getPoints?.()?.getNumberOfPoints?.() ?? 0;
        const cells = dataset.getNumberOfCells?.() ?? 0;
        const bounds = dataset.getBounds?.();
        if (Array.isArray(bounds) && bounds.length === 6) {
          const cx = (bounds[0] + bounds[1]) / 2;
          const cy = (bounds[2] + bounds[3]) / 2;
          const cz = (bounds[4] + bounds[5]) / 2;
          datasetCenterRef.current = [cx, cy, cz];
          const dx = Math.abs(bounds[1] - bounds[0]);
          const dy = Math.abs(bounds[3] - bounds[2]);
          const dz = Math.abs(bounds[5] - bounds[4]);
          isNear2DRef.current = dz < 1e-8;
          datasetRadiusRef.current = Math.max(dx, dy, dz, 1e-6) * 1.25;
          const min = Number(bounds[4] ?? -1);
          const max = Number(bounds[5] ?? 1);
          const lo = Number.isFinite(min) ? min : -1;
          const hi = Number.isFinite(max) ? max : 1;
          const sane = hi > lo ? { min: lo, max: hi } : { min: lo - 1, max: lo + 1 };
          setSliceRange(sane);
          const mid = (sane.min + sane.max) / 2;
          setSlicePosition(mid);
          slicePlane.setOrigin(cx, cy, mid);
          if (isNear2DRef.current) {
            // Flat 2D geometry should not be sliced; cutter often collapses it to a line.
            setSliceEnabled(false);
          }
        }
        console.log("VTU loaded:", dataset);
        console.log("Points:", points);
        console.log("Cells:", cells);
        console.log("Bounds:", bounds);
        if (!meta) setMeta(`Points: ${points} | Cells: ${cells}`);

        const formatValue = (arr: any, tupleId: number) => {
          const comps = Number(arr?.getNumberOfComponents?.() ?? 1);
          const data = arr?.getData?.();
          if (!data || tupleId < 0) return "n/a";
          if (comps <= 1) {
            const raw = data[tupleId];
            if (raw === undefined || raw === null || Number.isNaN(Number(raw))) return "n/a";
            return Number(raw).toFixed(6);
          }
          const vals: string[] = [];
          for (let c = 0; c < comps; c += 1) {
            const raw = data[tupleId * comps + c];
            vals.push(raw === undefined || raw === null || Number.isNaN(Number(raw)) ? "n/a" : Number(raw).toFixed(6));
          }
          return `[${vals.join(", ")}]`;
        };
        const onPointerMove = (event: PointerEvent) => {
          if (!mountRef.current || !rendererRef.current) return;
          const rect = mountRef.current.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const drag = zoomDragRef.current;
          if (drag && event.pointerId === drag.pointerId) {
            event.preventDefault();
            if (drag.mode === "draw") {
              setZoomBox(
                clampBoxToRect(
                  {
                    left: Math.min(drag.startX, x),
                    top: Math.min(drag.startY, y),
                    width: Math.abs(x - drag.startX),
                    height: Math.abs(y - drag.startY),
                  },
                  rect
                )
              );
            } else if (drag.mode === "move") {
              const dx = x - drag.startX;
              const dy = y - drag.startY;
              setZoomBox(
                clampBoxToRect(
                  {
                    left: drag.startBox.left + dx,
                    top: drag.startBox.top + dy,
                    width: drag.startBox.width,
                    height: drag.startBox.height,
                  },
                  rect
                )
              );
            } else if (drag.mode === "resize") {
              const b = { ...drag.startBox };
              const h = drag.handle;
              if (h?.includes("e")) b.width = Math.max(1, x - b.left);
              if (h?.includes("s")) b.height = Math.max(1, y - b.top);
              if (h?.includes("w")) {
                const right = b.left + b.width;
                b.left = Math.min(x, right - 1);
                b.width = Math.max(1, right - b.left);
              }
              if (h?.includes("n")) {
                const bottom = b.top + b.height;
                b.top = Math.min(y, bottom - 1);
                b.height = Math.max(1, bottom - b.top);
              }
              setZoomBox(clampBoxToRect(b, rect));
            }
            return;
          }
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
            setHoverProbe(null);
            return;
          }
          const activeMapperInput = mapperRef.current?.getInputData?.() ?? datasetRef.current;
          if (!activeMapperInput) return;
          const selected = scalarOptions.find((s) => s.key === selectedScalar);
          const useCell = selected?.association === "cell";
          const picker = useCell ? cellPickerRef.current : pointPickerRef.current;
          if (!picker) return;
          const vtkXY = clientXYToVtkPickerCoords(event.clientX, event.clientY);
          if (!vtkXY) return;
          picker.pick([vtkXY[0], vtkXY[1], 0], rendererRef.current);
          const pointId = Number(picker.getPointId?.() ?? -1);
          const cellId = Number(picker.getCellId?.() ?? -1);
          const pos = picker.getPickPosition?.() ?? [0, 0, 0];
          if (pointId < 0 && cellId < 0) {
            setHoverProbe(null);
            return;
          }
          const lines: string[] = [
            `X: ${Number(pos[0] ?? 0).toFixed(4)}  Y: ${Number(pos[1] ?? 0).toFixed(4)}  Z: ${Number(pos[2] ?? 0).toFixed(4)}`,
          ];
          if (selected && selected.name !== "solid") {
            const arr = pickArrayByName(activeMapperInput, selected.association, selected.name);
            const tupleId = selected.association === "cell" ? cellId : pointId;
            if (arr && tupleId >= 0) {
              lines.push(`${selected.label}: ${formatValue(arr, tupleId)}`);
            }
          } else if (pointId >= 0) {
            lines.push(`Point ID: ${pointId}`);
          }
          setHoverProbe({ x: x + 12, y: y + 12, lines });
        };
        const onPointerLeave = () => setHoverProbe(null);
        const onPointerDown = (event: PointerEvent) => {
          if (!zoomLensEnabledRef.current) return;
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = mount.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const interactor = renderWindowRef.current?.getInteractor?.();
          interactor?.disable?.();
          zoomDragRef.current = {
            pointerId: event.pointerId,
            mode: "draw",
            startX: x,
            startY: y,
            startBox: { left: x, top: y, width: 0, height: 0 },
          };
          setZoomBox({ left: x, top: y, width: 0, height: 0 });
          mount.setPointerCapture?.(event.pointerId);
          setHoverProbe(null);
        };
        const onPointerUp = (event: PointerEvent) => {
          const drag = zoomDragRef.current;
          if (!drag || event.pointerId !== drag.pointerId) return;
          try {
            // finalize selection only; zoom happens on explicit confirm.
            const box = zoomBoxRef.current;
            if (box && (box.width < 12 || box.height < 12)) {
              setZoomBox(null);
            }
          } finally {
            const interactor = renderWindowRef.current?.getInteractor?.();
            interactor?.enable?.();
            zoomDragRef.current = null;
            mount.releasePointerCapture?.(event.pointerId);
          }
        };
        mount.addEventListener("pointermove", onPointerMove);
        mount.addEventListener("pointerleave", onPointerLeave);
        mount.addEventListener("pointerdown", onPointerDown);
        mount.addEventListener("pointerup", onPointerUp);
        mount.addEventListener("pointercancel", onPointerUp);
        detachPointerHandlers = () => {
          mount.removeEventListener("pointermove", onPointerMove);
          mount.removeEventListener("pointerleave", onPointerLeave);
          mount.removeEventListener("pointerdown", onPointerDown);
          mount.removeEventListener("pointerup", onPointerUp);
          mount.removeEventListener("pointercancel", onPointerUp);
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to render VTU.";
        console.error("VTU load error:", e);
        if (!cancelled) {
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      detachPointerHandlers?.();
      try {
        reader?.delete?.();
        surfaceFilter?.delete?.();
        actor?.delete?.();
        outlineActor?.delete?.();
        outlineMapper?.delete?.();
        mapper?.delete?.();
        cutter?.delete?.();
        slicePlane?.delete?.();
        pointPicker?.delete?.();
        cellPicker?.delete?.();
        if (scalarBarAttached) {
          rendererRef.current?.removeActor2D?.(scalarBar);
          rendererRef.current?.removeActor?.(scalarBar);
        }
        scalarBar?.delete?.();
        lookupTable?.delete?.();
        fsrw?.delete?.();
        actorRef.current = null;
        outlineActorRef.current = null;
        mapperRef.current = null;
        renderWindowRef.current = null;
        datasetRef.current = null;
        surfaceDataRef.current = null;
        planeRef.current = null;
        cutterRef.current = null;
        rendererRef.current = null;
        cameraHomeRef.current = null;
        pointPickerRef.current = null;
        cellPickerRef.current = null;
        scalarBarRef.current = null;
        lookupTableRef.current = null;
        setHoverProbe(null);
        setZoomBox(null);
      } catch {
        // no-op
      }
      while (mount.firstChild) mount.removeChild(mount.firstChild);
    };
  }, [vtuUrl]);

  const startLensTransform = (
    event: React.PointerEvent<HTMLDivElement>,
    mode: "move" | "resize",
    handle?: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
  ) => {
    if (!zoomLensEnabled) return;
    const mount = mountRef.current;
    const current = zoomBoxRef.current;
    if (!mount || !current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = mount.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    zoomDragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: x,
      startY: y,
      startBox: { ...current },
      handle,
    };
    mount.setPointerCapture?.(event.pointerId);
  };

  const applyLensZoom = () => {
    const box = zoomBoxRef.current;
    const mount = mountRef.current;
    const renderer = rendererRef.current;
    const rw = renderWindowRef.current;
    if (!box || !mount || !renderer || !rw) return;
    const rect = mount.getBoundingClientRect();
    if (box.width < 12 || box.height < 12) return;
    const clientCx = rect.left + box.left + box.width / 2;
    const clientCy = rect.top + box.top + box.height / 2;
    const picker = pointPickerRef.current ?? cellPickerRef.current;
    let pos = [0, 0, 0];
    let hasPick = false;
    if (picker) {
      const vtkXY = clientXYToVtkPickerCoords(clientCx, clientCy);
      if (!vtkXY) return;
      picker.pick([vtkXY[0], vtkXY[1], 0], renderer);
      const pointId = Number(picker.getPointId?.() ?? -1);
      const cellId = Number(picker.getCellId?.() ?? -1);
      hasPick = pointId >= 0 || cellId >= 0;
      pos = (picker.getPickPosition?.() ?? [0, 0, 0]) as [number, number, number];
    }
    const cam = renderer.getActiveCamera?.();
    if (!cam) return;
    const prevFocal = cam.getFocalPoint?.() ?? [0, 0, 0];
    const prevPos = cam.getPosition?.() ?? [0, 0, 1];
    const nextFocal: [number, number, number] = [
      hasPick ? Number(pos[0] ?? prevFocal[0]) : Number(prevFocal[0] ?? 0),
      hasPick ? Number(pos[1] ?? prevFocal[1]) : Number(prevFocal[1] ?? 0),
      hasPick ? Number(pos[2] ?? prevFocal[2]) : Number(prevFocal[2] ?? 0),
    ];
    // Pan camera by the same delta to avoid side-jump/orbit effect.
    const dx = nextFocal[0] - Number(prevFocal[0] ?? 0);
    const dy = nextFocal[1] - Number(prevFocal[1] ?? 0);
    const dz = nextFocal[2] - Number(prevFocal[2] ?? 0);
    cam.setFocalPoint(...nextFocal);
    cam.setPosition(Number(prevPos[0] ?? 0) + dx, Number(prevPos[1] ?? 0) + dy, Number(prevPos[2] ?? 1) + dz);
    const zoomBy = Math.max(
      1.05,
      Math.min(4.0, Math.min(rect.width / Math.max(box.width, 1), rect.height / Math.max(box.height, 1)) * 0.9)
    );
    cam.zoom?.(zoomBy);
    renderer.resetCameraClippingRange?.();
    rw.render?.();
  };

  const applyAxisView = (axis: AxisView) => {
    const renderer = rendererRef.current;
    const rw = renderWindowRef.current;
    if (!renderer || !rw) return;
    const cam = renderer.getActiveCamera?.();
    if (!cam) return;
    const map: Record<AxisView, { pos: [number, number, number]; viewUp: [number, number, number] }> = {
      "+X": { pos: [1, 0, 0], viewUp: [0, 0, 1] },
      "-X": { pos: [-1, 0, 0], viewUp: [0, 0, 1] },
      "+Y": { pos: [0, 1, 0], viewUp: [0, 0, 1] },
      "-Y": { pos: [0, -1, 0], viewUp: [0, 0, 1] },
      "+Z": { pos: [0, 0, 1], viewUp: [0, 1, 0] },
      "-Z": { pos: [0, 0, -1], viewUp: [0, 1, 0] },
    };
    const target = map[axis];
    cam.setPosition(...target.pos);
    cam.setFocalPoint(0, 0, 0);
    cam.setViewUp(...target.viewUp);
    renderer.resetCamera();
    renderer.resetCameraClippingRange?.();
    rw.render();
  };

  const applyCameraPreset = (preset: "front" | "top" | "side" | "iso" | "reset") => {
    const renderer = rendererRef.current;
    const rw = renderWindowRef.current;
    if (!renderer || !rw) return;
    const cam = renderer.getActiveCamera?.();
    if (!cam) return;
    if (preset === "reset" && cameraHomeRef.current) {
      cam.setPosition(...cameraHomeRef.current.position);
      cam.setFocalPoint(...cameraHomeRef.current.focalPoint);
      renderer.resetCameraClippingRange?.();
      rw.render();
      return;
    }
    const [cx, cy, cz] = datasetCenterRef.current;
    const d = datasetRadiusRef.current;
    if (preset === "front") cam.setPosition(cx, cy, cz + d);
    else if (preset === "top") cam.setPosition(cx, cy + d, cz);
    else if (preset === "side") cam.setPosition(cx + d, cy, cz);
    else cam.setPosition(cx + d * 0.7, cy + d * 0.55, cz + d * 0.7);
    cam.setFocalPoint(cx, cy, cz);
    renderer.resetCameraClippingRange?.();
    rw.render();
  };

  useEffect(() => {
    const actor = actorRef.current;
    const outlineActor = outlineActorRef.current;
    const rw = renderWindowRef.current;
    if (!actor || !rw) return;
    const mode: "solid" | "mesh" | "scalar" =
      selectedScalar === "solid" ? representation : selectedScalar === "mesh" ? "mesh" : "scalar";
    setDisplayMode(actor, mode, scalarDisplayMode === "surfaceMesh");
    // In scalar mode the dedicated effect wires the LUT + mapper first; an early render here
    // builds a VBO without scalar texture coords and the surface stays flat grey.
    if (selectedScalar === "solid" || selectedScalar === "mesh") {
      rw.render();
    }
  }, [representation, selectedScalar, scalarDisplayMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("vtuViewer.representation", representation);
    } catch {
      // no-op
    }
  }, [representation]);

  useEffect(() => {
    try {
      window.localStorage.setItem("vtuViewer.scalarDisplayMode", scalarDisplayMode);
    } catch {
      // no-op
    }
  }, [scalarDisplayMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("vtuViewer.selectedScalar", selectedScalar);
    } catch {
      // no-op
    }
  }, [selectedScalar]);

  useEffect(() => {
    const actor = actorRef.current;
    const rw = renderWindowRef.current;
    if (!actor || !rw) return;
    actor.getProperty().setOpacity(opacity);
    rw.render();
  }, [opacity]);

  useEffect(() => {
    const actor = actorRef.current;
    const rw = renderWindowRef.current;
    if (!actor || !rw) return;
    actor.getProperty().setLineWidth(lineWidth);
    rw.render();
  }, [lineWidth]);

  useEffect(() => {
    const actor = actorRef.current;
    const rw = renderWindowRef.current;
    if (!actor || !rw) return;
    if (isScalarMode) return;
    actor.getProperty().setAmbient(ambient);
    rw.render();
  }, [ambient, isScalarMode]);

  useEffect(() => {
    const actor = actorRef.current;
    const rw = renderWindowRef.current;
    if (!actor || !rw) return;
    if (isScalarMode) return;
    actor.getProperty().setDiffuse(diffuse);
    rw.render();
  }, [diffuse, isScalarMode]);

  useEffect(() => {
    const actor = actorRef.current;
    const mapper = mapperRef.current;
    const dataset = datasetRef.current;
    const surfaceData = surfaceDataRef.current ?? dataset;
    const cutter = cutterRef.current;
    const plane = planeRef.current;
    const rw = renderWindowRef.current;
    if (!actor || !mapper || !dataset || !surfaceData || !cutter || !plane || !rw) return;
    if (isNear2DRef.current) {
      mapper.setInputData(surfaceData);
      if (selectedScalar === "solid" || selectedScalar === "mesh") rw.render();
      return;
    }
    const [cx, cy] = datasetCenterRef.current;
    plane.setOrigin(cx, cy, slicePosition);
    if (sliceEnabled) {
      cutter.setInputData(dataset);
      cutter.update();
      mapper.setInputConnection(cutter.getOutputPort());
    } else {
      mapper.setInputData(surfaceData);
    }
    if (selectedScalar === "solid" || selectedScalar === "mesh") {
      rw.render();
    }
  }, [sliceEnabled, slicePosition, selectedScalar, scalarOptions, isScalarMode]);

  useEffect(() => {
    const mapper = mapperRef.current;
    const dataset = datasetRef.current;
    const surfaceData = surfaceDataRef.current ?? dataset;
    const scalarBar = scalarBarRef.current;
    const outlineActor = outlineActorRef.current;
    const rw = renderWindowRef.current;
    const renderer = rendererRef.current;
    if (!mapper || !dataset || !surfaceData || !rw) return;
    const actor = actorRef.current;
    const plane = planeRef.current;
    const cutter = cutterRef.current;
    if (!actor || !plane || !cutter) return;
    const fallbackToSurface = (info: string, level: "info" | "warn" | "error" = "error") => {
      mapper.setInputData(surfaceData);
      mapper.setScalarVisibility(false);
      setDisplayMode(actor, representation === "mesh" ? "mesh" : "solid", false);
      actor.getProperty().setLighting?.(true);
      actor.getProperty().setAmbient(ambient);
      actor.getProperty().setDiffuse(diffuse);
      setScalarInfo(info);
      setScalarInfoLevel(level);
      try {
        scalarBar?.setVisibility(false);
      } catch {
        // no-op
      }
      setLegendState((prev) => ({ ...prev, visible: false }));
      rw.render();
    };
    try {
    if (selectedScalar === "solid") {
      mapper.setInputData(surfaceData);
      mapper.setScalarVisibility(false);
      actor.getProperty().setColor?.(0.12, 0.2, 0.38);
      actor.getProperty().setLighting?.(true);
      actor.getProperty().setAmbient(ambient);
      actor.getProperty().setDiffuse(diffuse);
      setScalarInfo("Solid color (scalar mapping off)");
      setScalarInfoLevel("info");
      setDisplayMode(actor, representation === "mesh" ? "mesh" : "solid", scalarDisplayMode === "surfaceMesh");
      outlineActor?.setVisibility?.(false);
      try {
        if (scalarBar) {
          scalarBar.setAxisLabel(representation === "mesh" ? "Mesh" : "Solid");
          scalarBar.setVisibility(false);
        }
      } catch (scalarBarError) {
        console.warn("VTU scalar bar update failed:", scalarBarError);
      }
      setLegendState((prev) => ({ ...prev, visible: false }));
      rw.render();
      return;
    }
    if (selectedScalar === "mesh") {
      mapper.setInputData(surfaceData);
      mapper.setScalarVisibility(false);
      setDisplayMode(actor, "mesh");
      outlineActor?.setVisibility?.(false);
      actor.getProperty().setColor?.(0.12, 0.2, 0.38);
      actor.getProperty().setLighting?.(true);
      actor.getProperty().setAmbient(ambient);
      actor.getProperty().setDiffuse(diffuse);
      setScalarInfo("Mesh mode (uniform color + edges)");
      setScalarInfoLevel("info");
      try {
        if (scalarBar) {
          scalarBar.setAxisLabel("Mesh");
          scalarBar.setVisibility(false);
        }
      } catch (scalarBarError) {
        console.warn("VTU scalar bar update failed:", scalarBarError);
      }
      setLegendState((prev) => ({ ...prev, visible: false }));
      rw.render();
      return;
    }
    const opt = scalarOptions.find((o) => o.key === selectedScalar);
    if (!opt) {
      fallbackToSurface("Field not available", "error");
      return;
    }
    // Resolve arrays on the full dataset, then color either surface or slice output.
    const polyData = dataset;
    const { array: dataArray, association: resolvedAssociation, pointData, cellData } = resolveScalarArray(
      polyData,
      opt.name
    );
    if (!dataArray || !resolvedAssociation) {
      console.error("Scalar not found:", opt.name);
      fallbackToSurface(`Field not available: ${opt.name}`, "error");
      return;
    }
    if (pointData?.getArrayByName?.(opt.name)) {
      pointData.setActiveScalars?.(opt.name);
    } else {
      cellData?.setActiveScalars?.(opt.name);
    }
    if (sliceEnabled) {
      const [cx, cy] = datasetCenterRef.current;
      plane.setOrigin(cx, cy, slicePosition);
      cutter.setInputData(dataset);
      cutter.modified?.();
      cutter.update?.();
      mapper.setInputConnection(cutter.getOutputPort());
    } else {
      mapper.setInputData(surfaceData);
    }
    const mappedInput = mapper.getInputData?.(0);
    if (!mappedInput) {
      console.error("[VTU scalars] mapper input geometry is null after pipeline update");
      fallbackToSurface("Mapper has no geometry to color.", "error");
      return;
    }
    const stripVertexColorFallback = () => {
      const pd = mappedInput.getPointData?.();
      if (pd?.getArrayByName?.("_vtkScalarRGBA")) pd.removeArray?.("_vtkScalarRGBA");
      if (pd?.getArrayByName?.("Colors")) pd.removeArray?.("Colors");
      const cd = mappedInput.getCellData?.();
      if (cd?.getArrayByName?.("_vtkScalarRGBA")) cd.removeArray?.("_vtkScalarRGBA");
      if (cd?.getArrayByName?.("Colors")) cd.removeArray?.("Colors");
    };
    stripVertexColorFallback();
    const mappedPd = mappedInput?.getPointData?.();
    const mappedCd = mappedInput?.getCellData?.();
    let colorAssociation: "point" | "cell" = resolvedAssociation;
    let mappedColorArray =
      colorAssociation === "point" ? mappedPd?.getArrayByName?.(opt.name) : mappedCd?.getArrayByName?.(opt.name);
    if (mappedColorArray) {
      const tupleCount = Number(mappedColorArray.getNumberOfTuples?.() ?? 0);
      const expectedCount =
        colorAssociation === "point"
          ? Number(mappedInput.getNumberOfPoints?.() ?? 0)
          : Number(mappedInput.getNumberOfCells?.() ?? 0);
      // Custom VTU reader rewrites cells to boundary triangles; some original cell arrays no longer align.
      if (tupleCount > 0 && expectedCount > 0 && tupleCount !== expectedCount) {
        const pointFallback = mappedPd?.getArrayByName?.(opt.name);
        if (pointFallback && Number(pointFallback.getNumberOfTuples?.() ?? 0) === Number(mappedInput.getNumberOfPoints?.() ?? 0)) {
          colorAssociation = "point";
          mappedColorArray = pointFallback;
          console.warn("[VTU scalars] switched to point-data fallback for", opt.name, {
            requestedAssociation: resolvedAssociation,
            tupleCount,
            expectedCount,
          });
        }
      }
    }
    if (!mappedColorArray) {
      fallbackToSurface(
        `${opt.label}: field "${opt.name}" missing on displayed geometry (try toggling slice).`,
        "error"
      );
      return;
    }
    if (colorAssociation === "cell") {
      const interpName = `${opt.name}__point_interp`;
      const pd = mappedInput.getPointData?.();
      let interpArray = pd?.getArrayByName?.(interpName) ?? null;
      if (!interpArray) {
        interpArray = interpolateCellToPointScalars(mappedInput, mappedColorArray, interpName);
        if (interpArray) pd?.addArray?.(interpArray);
      }
      if (interpArray) {
        colorAssociation = "point";
        mappedColorArray = interpArray;
      }
    }

    const robustRange =
      colorAssociation === "point"
        ? computeRobustRangeOnUsedSurfacePoints(mappedInput, mappedColorArray) ?? computeRobustRange(mappedColorArray)
        : computeRobustRange(mappedColorArray);
    const rawRangeFromGeom = mappedColorArray?.getRange?.(0);
    const rawRangeFromSource = dataArray?.getRange?.(0);
    const effectiveRange: [number, number] | null =
      robustRange ??
      (Array.isArray(rawRangeFromGeom) && rawRangeFromGeom.length >= 2
        ? [Number(rawRangeFromGeom[0]), Number(rawRangeFromGeom[1])]
        : Array.isArray(rawRangeFromSource) && rawRangeFromSource.length >= 2
          ? [Number(rawRangeFromSource[0]), Number(rawRangeFromSource[1])]
          : null);
    if (!effectiveRange) {
      fallbackToSurface(`${opt.label}: field range unavailable`, "error");
      return;
    }

    // ── Activate the scalar array on the geometry ──────────────────
    if (colorAssociation === "point") {
      mappedInput.getPointData().setActiveScalars(opt.name);
      mapper.setScalarModeToUsePointData?.();
      mapper.setScalarModeToUsePointFieldData?.();
    } else {
      mappedInput.getCellData().setActiveScalars(opt.name);
      mapper.setScalarModeToUseCellData?.();
      mapper.setScalarModeToUseCellFieldData?.();
    }
    mapper.setArrayAccessMode?.(1);
    mapper.setColorByArrayName?.(opt.name);

    // ── LUT ────────────────────────────────────────────────────────
    const [r0, r1] = effectiveRange;
    const newLUT = vtkLookupTable.newInstance();
    applyCoolToWarmExplicitLUT(newLUT, r0, r1);
    const activeLookupTable = newLUT;
    mapper.setLookupTable(activeLookupTable);
    mapper.setScalarRange(r0, r1);
    lookupTableRef.current?.delete?.();
    lookupTableRef.current = activeLookupTable;

    // Use native mapper/LUT scalar mapping (ParaView-style) instead of overriding
    // geometry scalars with precomputed RGBA arrays.
    mapper.setColorModeToMapScalars?.();
    mapper.setScalarVisibility(true);
    mapper.setInterpolateScalarsBeforeMapping?.(true);
    mapper.setUseLookupTableScalarRange?.(true);

    setDisplayMode(actor, 'scalar', scalarDisplayMode === "surfaceMesh");
    outlineActor?.setVisibility?.(scalarDisplayMode === "surfaceOnly");
    actor.getProperty().setLighting?.(false);
    actor.getProperty().setAmbient?.(1.0);
    actor.getProperty().setDiffuse?.(0.0);
    actor.getProperty().setSpecular?.(0.0);

    mappedInput.modified?.();
    mapper.modified?.();
    rendererRef.current?.resetCameraClippingRange?.();
    rw.render();
    requestAnimationFrame(() => { mapper.modified?.(); rw.render?.(); });

    if (Math.abs(r1 - r0) < 1e-30) {
      console.warn("Scalar field is constant — check simulation output", { min: r0, max: r1 });
    }

    try {
      if (scalarBar && activeLookupTable) {
        scalarBar.setLookupTable?.(activeLookupTable);
        scalarBar.setScalarsToColors?.(activeLookupTable);
        scalarBar.setAxisLabel?.(opt.name);
        scalarBar.setNumberOfLabels?.(5);
        scalarBar.setVisibility(true);
      }
    } catch (scalarBarError) {
      console.warn("VTU scalar bar update failed:", scalarBarError);
    }
    setLegendState({
      visible: true,
      title: opt.name,
      min: r0,
      max: r1,
    });
    if (Math.abs(r1 - r0) < 1e-12) {
      setScalarInfo(`${opt.label}: constant field (${r0.toExponential(3)})`);
      setScalarInfoLevel("warn");
      if (Math.abs(r0) < 1e-12) {
        setScalarInfo(`${opt.label}: uniform scalar field (all ~0). Simulation data may not be solved.`);
      }
    } else {
      setScalarInfo(`${opt.label}: range ${r0.toExponential(3)} to ${r1.toExponential(3)}`);
      setScalarInfoLevel("info");
    }
    } catch (err) {
      console.error("[VTU scalars] unexpected error while applying scalar field:", err);
      fallbackToSurface("Scalar mapping failed unexpectedly. Reverted to surface mode.", "error");
    }
  }, [selectedScalar, scalarOptions, representation, scalarDisplayMode, sliceEnabled, slicePosition]);

  return (
    <div
      className={`fixed inset-y-0 right-0 left-0 z-[12000] flex max-h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden bg-[#13171c] ${hideSidebar ? "" : "lg:left-[var(--sidebar-width)]"}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-[#0a0d12] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-slate-100">3D Model Viewer</h3>
          <p className="mt-0.5 truncate text-xs text-slate-400" title={fileName}>{fileName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${error ? "bg-red-950/80 text-red-300 ring-1 ring-red-800/80" : loading ? "bg-amber-950/70 text-amber-200 ring-1 ring-amber-800/60" : "bg-emerald-950/70 text-emerald-200 ring-1 ring-emerald-800/60"}`}>
            {error ? "Error" : loading ? "Loading" : "Loaded"}
          </span>
          {geometryResultsNav?.onExit && (
            <button type="button" className={viewerToolbarBtn} onClick={geometryResultsNav.onExit}>
              Exit
            </button>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800/90 bg-[#0a0d12] px-4 py-2.5">
        <button type="button" className={viewerToolbarBtn} onClick={() => applyCameraPreset("reset")} disabled={loading || !!error}>Reset view</button>
        <button type="button" className={viewerToolbarBtn} onClick={() => applyCameraPreset("front")} disabled={loading || !!error}>Front</button>
        <button type="button" className={viewerToolbarBtn} onClick={() => applyCameraPreset("top")} disabled={loading || !!error}>Top</button>
        <button type="button" className={viewerToolbarBtn} onClick={() => applyCameraPreset("side")} disabled={loading || !!error}>Side</button>
        <button type="button" className={viewerToolbarBtn} onClick={() => applyCameraPreset("iso")} disabled={loading || !!error}>Iso</button>
        <button
          type="button"
          className={`${viewerToolbarBtn} min-w-[40px] px-3 ${zoomLensEnabled ? viewerToolbarBtnLensActive : ""}`}
          onClick={() => setZoomLensEnabled((v) => !v)}
          disabled={loading || !!error}
          title="Lens zoom: click any region to zoom in"
          aria-label="Lens zoom tool"
        >
          🔍
        </button>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111317] px-3 pb-3 pt-3">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,4fr)_minmax(280px,1fr)] lg:items-stretch">
          <div className="relative h-full min-h-0 w-full overflow-hidden border border-slate-700/80 bg-[#1e1e1e]">
            {error ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-red-300">{error}</div>
            ) : (
              <div ref={mountRef} className="h-full min-h-[280px] w-full" />
            )}
            {loading && !error && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#1e1e1e]">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-600 border-t-slate-200" />
                <p className="text-sm font-medium tracking-wide text-slate-200">Loading VTU...</p>
              </div>
            )}
            {hoverProbe && !loading && !error && (
              <div
                className="pointer-events-none absolute z-30 rounded-md border border-slate-700/80 bg-slate-950/95 px-2 py-1.5 text-[11px] text-slate-100 shadow-lg"
                style={{ left: hoverProbe.x, top: hoverProbe.y }}
              >
                {hoverProbe.lines.map((line, idx) => (
                  <div key={`${line}-${idx}`}>{line}</div>
                ))}
              </div>
            )}
            {zoomLensEnabled && zoomBox && !loading && !error && (
              <>
                <div
                  className="absolute z-30 border border-emerald-300/90 bg-emerald-500/15"
                  style={{
                    left: zoomBox.left,
                    top: zoomBox.top,
                    width: Math.max(1, zoomBox.width),
                    height: Math.max(1, zoomBox.height),
                  }}
                  onPointerDown={(e) => startLensTransform(e, "move")}
                >
                  <div className="absolute -left-1 -top-1 h-2 w-2 cursor-nwse-resize rounded-sm bg-emerald-300" onPointerDown={(e) => startLensTransform(e, "resize", "nw")} />
                  <div className="absolute -right-1 -top-1 h-2 w-2 cursor-nesw-resize rounded-sm bg-emerald-300" onPointerDown={(e) => startLensTransform(e, "resize", "ne")} />
                  <div className="absolute -left-1 -bottom-1 h-2 w-2 cursor-nesw-resize rounded-sm bg-emerald-300" onPointerDown={(e) => startLensTransform(e, "resize", "sw")} />
                  <div className="absolute -right-1 -bottom-1 h-2 w-2 cursor-nwse-resize rounded-sm bg-emerald-300" onPointerDown={(e) => startLensTransform(e, "resize", "se")} />
                </div>
                <div
                  className="absolute z-30 flex items-center gap-1"
                  style={{ left: zoomBox.left, top: Math.max(0, zoomBox.top - 28) }}
                >
                  <button
                    type="button"
                    className={`${viewerMiniBtn} border-emerald-500/50 bg-emerald-700/90 text-white hover:bg-emerald-600`}
                    onClick={applyLensZoom}
                  >
                    Zoom
                  </button>
                  <button
                    type="button"
                    className={viewerMiniBtn}
                    onClick={() => setZoomBox(null)}
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
            {!loading && !error && (
              <div className="absolute right-3 top-3 z-30 rounded-xl border border-slate-600/50 bg-slate-950/90 p-1 shadow-lg shadow-black/50 ring-1 ring-white/[0.04] backdrop-blur-sm">
                <div className="flex items-center gap-px">
                  {(["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as AxisView[]).map((axis) => {
                    const icon = (() => {
                      if (axis === "+X") return { up: "right", h: "left", sq: "red" };
                      if (axis === "-X") return { up: "left", h: "right", sq: "red" };
                      if (axis === "+Y") return { up: "left", h: "right-red", sq: "yellow" };
                      if (axis === "-Y") return { up: "right", h: "left-red", sq: "yellow" };
                      if (axis === "+Z") return { up: "mid-yellow", h: "left-red", sq: "green" };
                      return { up: "mid-yellow", h: "right-red", sq: "green" };
                    })();
                    return (
                      <button
                        key={axis}
                        type="button"
                        onClick={() => applyAxisView(axis)}
                        className="relative h-9 w-11 rounded-lg border border-transparent bg-slate-800/40 transition hover:border-sky-500/35 hover:bg-slate-700/80 active:scale-[0.97]"
                        title={`View ${axis}`}
                      >
                        <span className="absolute left-1 top-0 text-[10px] font-bold text-slate-200">{axis}</span>
                        <span className={`absolute top-3 text-[18px] leading-none text-emerald-400 ${icon.up === "left" ? "left-1.5" : icon.up === "right" ? "right-1.5" : "left-4"}`}>
                          ↑
                        </span>
                        <span className={`absolute bottom-0.5 text-[18px] leading-none ${icon.h.includes("red") ? "text-rose-400" : "text-amber-300"} ${icon.h.startsWith("left") ? "left-0.5" : "right-0.5"}`}>
                          {icon.h.startsWith("left") ? "←" : "→"}
                        </span>
                        <span className={`absolute bottom-1 h-2.5 w-2.5 rounded-[2px] ${icon.sq === "red" ? "bg-rose-500" : icon.sq === "yellow" ? "bg-amber-400" : "bg-emerald-500"} ${icon.h.startsWith("left") ? "right-2.5" : "left-2.5"}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {legendState.visible && !loading && !error && (
              <div className="pointer-events-none absolute right-3 top-14 z-30 flex w-16 flex-col items-center rounded border border-slate-700/80 bg-slate-950/90 px-2 py-2">
                <div className="mb-2 w-full text-center text-[10px] font-semibold text-slate-200" title={legendState.title}>
                  {legendState.title}
                </div>
                <div className="flex w-full items-stretch gap-1">
                  <div
                    className="h-56 w-4 rounded border border-slate-700"
                    style={{
                      background:
                        "linear-gradient(to top, rgb(180,4,38) 0%, rgb(221,221,221) 50%, rgb(59,76,192) 100%)",
                    }}
                  />
                  <div className="flex h-56 flex-1 flex-col justify-between text-[9px] text-slate-300">
                    <span>{legendState.max.toExponential(2)}</span>
                    <span>{((legendState.max * 3 + legendState.min) / 4).toExponential(2)}</span>
                    <span>{((legendState.max + legendState.min) / 2).toExponential(2)}</span>
                    <span>{((legendState.max + legendState.min * 3) / 4).toExponential(2)}</span>
                    <span>{legendState.min.toExponential(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <aside className="min-h-0 max-h-[min(100%,calc(100dvh-10.5rem))] overflow-y-auto overflow-x-hidden border border-slate-800 bg-[#0b1017] p-3 text-xs text-slate-300 overscroll-contain">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-200">VTU Properties</h4>
            <div className="space-y-4">
              <section className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Display</p>
                <label className="block text-[11px] text-slate-400">Representation</label>
                <select
                  value={representation}
                  onChange={(e) => setRepresentation(e.target.value as "solid" | "mesh")}
                  disabled={loading || !!error}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                >
                  <option value="solid">Solid</option>
                  <option value="mesh">Mesh</option>
                </select>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Opacity</span>
                    <span>{opacity.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                    disabled={loading || !!error}
                    className="w-full accent-sky-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Line width</span>
                    <span>{lineWidth.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={0.1}
                    value={lineWidth}
                    onChange={(e) => setLineWidth(Number(e.target.value))}
                    disabled={loading || !!error}
                    className="w-full accent-sky-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Ambient</span>
                    <span>{ambient.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={ambient}
                    onChange={(e) => setAmbient(Number(e.target.value))}
                    disabled={loading || !!error}
                    className="w-full accent-sky-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Diffuse</span>
                    <span>{diffuse.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={diffuse}
                    onChange={(e) => setDiffuse(Number(e.target.value))}
                    disabled={loading || !!error}
                    className="w-full accent-sky-500"
                  />
                </div>
              </section>
              <section className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Coloring</p>
                <label className="block text-[11px] text-slate-400">Color By</label>
                <select
                  value={selectedScalar}
                  onChange={(e) => setSelectedScalar(e.target.value)}
                  disabled={loading || !!error}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                >
                  <option value="solid">Solid</option>
                  <option value="mesh">Mesh</option>
                  {scalarOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {selectedScalar !== "solid" && selectedScalar !== "mesh" && (
                  <div className="space-y-1">
                    <label className="block text-[11px] text-slate-400">Scalar display</label>
                    <select
                      value={scalarDisplayMode}
                      onChange={(e) => setScalarDisplayMode(e.target.value as ScalarDisplayMode)}
                      disabled={loading || !!error}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                    >
                      <option value="surfaceOnly">Surface only (no mesh points)</option>
                      <option value="surfaceMesh">Surface + mesh</option>
                    </select>
                  </div>
                )}
                {!!scalarInfo && (
                  <p
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-medium ${
                      scalarInfoLevel === "error"
                        ? "border-red-800/80 bg-red-950/30 text-red-300"
                        : scalarInfoLevel === "warn"
                          ? "border-amber-800/80 bg-amber-950/30 text-amber-300"
                          : "border-slate-700 bg-slate-900/80 text-slate-300"
                    }`}
                  >
                    {scalarInfo}
                  </p>
                )}
              </section>
              <section className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Slice</p>
                <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                  <span>Enable slice</span>
                  <input
                    type="checkbox"
                    checked={sliceEnabled}
                    onChange={(e) => setSliceEnabled(e.target.checked)}
                    disabled={loading || !!error}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                </label>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Position (Z)</span>
                    <span>{slicePosition.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={sliceRange.min}
                    max={sliceRange.max}
                    step={Math.max((sliceRange.max - sliceRange.min) / 500, 1e-5)}
                    value={slicePosition}
                    onChange={(e) => setSlicePosition(Number(e.target.value))}
                    disabled={loading || !!error}
                    className="w-full accent-sky-500"
                  />
                </div>
              </section>
            </div>
          </aside>
        </div>
        {!!meta && !error && <div className="mt-2 text-xs text-slate-400">{meta}</div>}
        {geometryResultsNav && (
          <GeometryResultsNextFab nav={geometryResultsNav} viewerBusy={loading || !!error} />
        )}
      </div>
    </div>
  );
}
