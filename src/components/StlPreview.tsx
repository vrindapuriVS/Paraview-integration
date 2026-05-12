import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { casesApi } from "../services/api";
import {
  applyColorMap,
  applyStlMockField,
  computeDerivedField,
  findVelocityComponents,
  getLegendGradientForColorMap,
  loadDataset,
  probeValue,
  sampleColorMapAt,
  type ColorMapName,
  type ScalarField,
} from "./dataPipeline";
import { createMockScalarValues, type ScalarFieldKey } from "./scalarColoring";
import { makeClippingPlane, type ClipPlaneOptions } from "../filters/clip";
import { buildSurfaceContourGeometry } from "../filters/contourSurface";
import { buildStreamlineGeometry, type StreamlineOptions } from "../filters/streamlines";
import { buildVelocityGlyphMesh, type GlyphOptions } from "../filters/glyphs";
import "./StlPreview.tailwind.css";
import { useAppLayout } from "../context/AppLayoutContext";
import { GeometryResultsNextFab, type GeometryResultsNav } from "./VtuPreview";
import { viewerToolbarBtn, viewerToolbarBtnActive } from "./viewerToolbarClasses";

export type StlPreviewProps = {
  caseId?: string;
  fileName: string;
  file?: File | null;
  analysisLoading?: boolean;
  /** Always-on footer: where “next” (CL) lives after geometry */
  geometryResultsNav?: GeometryResultsNav;
};

type DisplayRepresentation = "surfaceEdges" | "surface" | "wireframe";

type DisplayOptions = {
  representation: DisplayRepresentation;
  showEdges: boolean;
  opacity: number;
};

type SlicePlaneType = "xy" | "yz" | "xz" | "custom";

type SliceOptions = {
  enabled: boolean;
  plane: SlicePlaneType;
  position: number;
  invert: boolean;
  customNormal: { x: number; y: number; z: number };
};

type PipelineEntry = { id: string; name: string; visible: boolean };

type SceneBridge = {
  resetView: () => void;
  setDisplayOptions: (options: DisplayOptions) => void;
  setColorField: (fieldKey: string) => void;
  setColorMap: (mapName: ColorMapName) => void;
  setColorRange: (rangeMode: "auto" | "manual", manualRange: { min: number; max: number }) => void;
  setSliceOptions: (options: SliceOptions) => void;
  setClipOptions: (options: ClipPlaneOptions) => void;
  setColorMapReverse: (reverse: boolean) => void;
  setContourOptions: (enabled: boolean, fieldKey: string, iso: number) => void;
  setStreamlineOptions: (enabled: boolean, opts: StreamlineOptions) => void;
  setGlyphOptions: (enabled: boolean, opts: GlyphOptions) => void;
  setProbeMode: (mode: "hover" | "click") => void;
  setCameraPreset: (preset: "front" | "top" | "side" | "iso" | "reset") => void;
  setPipelineVisibility: (id: string, visible: boolean) => void;
  addSecondaryDataset: (file: File) => Promise<void>;
  addDerivedField: (field: ScalarField) => void;
  getScalarFields: () => ScalarField[];
  setInteractionEnabled: (on: boolean) => void;
  setRenderPaused: (paused: boolean) => void;
  resize: () => void;
};

type ProbeTooltip = {
  x: number;
  y: number;
  lines: string[];
};

type GeometryPlaneInfo = {
  label: "XY" | "YZ" | "XZ" | "3D";
  axis: "X" | "Y" | "Z" | null;
  confidence: "high" | "medium" | "low";
};

type AxisSummary = {
  x: number;
  y: number;
  z: number;
  primary: "X" | "Y" | "Z";
  secondary: "X" | "Y" | "Z";
  thin: "X" | "Y" | "Z";
};

const PV_VIEWPORT_BG = 0x232831;
const PV_SURFACE = 0xe5e9ef;
// Keep edges bright enough against dark viewport backgrounds.
const PV_EDGE = 0xaab4c3;
const ORIENTATION_VIEWPORT_SIZE = 144;
const ORIENTATION_VIEWPORT_MARGIN = 14;
const SLICE_NORMALS: Record<Exclude<SlicePlaneType, "custom">, THREE.Vector3> = {
  xy: new THREE.Vector3(0, 0, 1),
  yz: new THREE.Vector3(1, 0, 0),
  xz: new THREE.Vector3(0, 1, 0),
};

/** ParaView-style tick labels: endpoints can use scientific notation when helpful. */
function formatLegendTick(v: number, min: number, max: number, isEndpoint: boolean): string {
  if (!Number.isFinite(v)) return "—";
  const span = Math.abs(max - min);
  if (span < 1e-15) return v.toFixed(6);
  const useSci =
    isEndpoint &&
    (Math.abs(min) >= 1e4 ||
      Math.abs(max) >= 1e4 ||
      (Math.abs(min) > 0 && Math.abs(min) < 1e-2) ||
      (Math.abs(max) > 0 && Math.abs(max) < 1e-2));
  if (useSci) return v.toExponential(1);
  if (span >= 100) return v.toFixed(1);
  if (span >= 10) return v.toFixed(2);
  if (span >= 1) return v.toFixed(2);
  if (span >= 0.1) return v.toFixed(3);
  return v.toFixed(4);
}

function buildLegendTicks(min: number, max: number, segmentCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const ticks: number[] = [];
  for (let i = 0; i <= segmentCount; i += 1) {
    ticks.push(min + (max - min) * (i / segmentCount));
  }
  return ticks;
}

function detectGeometryPlane(size: THREE.Vector3): GeometryPlaneInfo {
  const dims = [
    { axis: "X" as const, value: Math.abs(size.x) },
    { axis: "Y" as const, value: Math.abs(size.y) },
    { axis: "Z" as const, value: Math.abs(size.z) },
  ];
  dims.sort((a, b) => a.value - b.value);

  const thinnest = dims[0];
  const middle = dims[1];
  const thickest = dims[2];
  const thinToMiddle = thinnest.value / Math.max(middle.value, 1e-9);
  const thinToThickest = thinnest.value / Math.max(thickest.value, 1e-9);

  if (thinToMiddle <= 0.2 || thinToThickest <= 0.12) {
    const confidence: GeometryPlaneInfo["confidence"] =
      thinToMiddle <= 0.08 || thinToThickest <= 0.05
        ? "high"
        : thinToMiddle <= 0.14
          ? "medium"
          : "low";

    if (thinnest.axis === "X") return { label: "YZ", axis: "X", confidence };
    if (thinnest.axis === "Y") return { label: "XZ", axis: "Y", confidence };
    return { label: "XY", axis: "Z", confidence };
  }

  return { label: "3D", axis: null, confidence: "low" };
}

function buildAxisSummary(size: THREE.Vector3): AxisSummary {
  const dims = [
    { axis: "X" as const, value: Math.abs(size.x) },
    { axis: "Y" as const, value: Math.abs(size.y) },
    { axis: "Z" as const, value: Math.abs(size.z) },
  ].sort((a, b) => b.value - a.value);

  return {
    x: Math.abs(size.x),
    y: Math.abs(size.y),
    z: Math.abs(size.z),
    primary: dims[0].axis,
    secondary: dims[1].axis,
    thin: dims[2].axis,
  };
}

function makeAxisLabelSprite(label: string, color: string) {
  const size = 72;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create axis label canvas.");
  }

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(10, 13, 18, 0.86)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
  ctx.strokeText(label, size / 2, size / 2);
  ctx.fillStyle = color;
  ctx.fillText(label, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(0.42);

  return { sprite, material, texture };
}

function createOrientationTriad() {
  const group = new THREE.Group();
  const disposers: Array<() => void> = [];

  const hubGeometry = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  const hubMaterial = new THREE.MeshStandardMaterial({
    color: 0xe7eaef,
    roughness: 0.48,
    metalness: 0.08,
  });
  const hub = new THREE.Mesh(hubGeometry, hubMaterial);
  group.add(hub);
  disposers.push(() => {
    hubGeometry.dispose();
    hubMaterial.dispose();
  });

  const addAxis = (
    direction: THREE.Vector3,
    color: number,
    label: string,
    labelColor: string
  ) => {
    const axis = new THREE.Group();
    const shaftLength = 0.78;
    const tipLength = 0.28;
    const shaftRadius = 0.045;
    const tipRadius = 0.1;

    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 20);
    const tipGeometry = new THREE.ConeGeometry(tipRadius, tipLength, 20);
    const axisMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.08,
    });

    const shaft = new THREE.Mesh(shaftGeometry, axisMaterial);
    shaft.position.y = shaftLength / 2 + 0.16;
    const tip = new THREE.Mesh(tipGeometry, axisMaterial);
    tip.position.y = shaftLength + tipLength / 2 + 0.16;
    axis.add(shaft, tip);
    axis.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    group.add(axis);

    const axisLabel = makeAxisLabelSprite(label, labelColor);
    axisLabel.sprite.position.copy(direction.clone().normalize().multiplyScalar(1.28));
    group.add(axisLabel.sprite);

    disposers.push(() => {
      shaftGeometry.dispose();
      tipGeometry.dispose();
      axisMaterial.dispose();
      axisLabel.material.dispose();
      axisLabel.texture.dispose();
    });

    return axisLabel.sprite;
  };

  const xLabel = addAxis(new THREE.Vector3(1, 0, 0), 0xff4d4f, "X", "#ff6b6b");
  const yLabel = addAxis(new THREE.Vector3(0, 1, 0), 0x39d353, "Y", "#5ee27a");
  const zLabel = addAxis(new THREE.Vector3(0, 0, 1), 0x3b82f6, "Z", "#72a7ff");

  return {
    group,
    labels: [xLabel, yLabel, zLabel],
    dispose: () => {
      disposers.forEach((dispose) => dispose());
    },
  };
}

function waitForNonZeroSize(
  el: HTMLElement,
  disposed: () => boolean,
  maxFrames = 240
): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const step = () => {
      if (disposed()) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w >= 4 && h >= 4) {
        resolve({ w, h });
        return;
      }
      frames += 1;
      if (frames > maxFrames) {
        reject(new Error("Preview area has no size — check layout/CSS."));
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(() => requestAnimationFrame(step));
  });
}

export default function StlPreview({
  caseId,
  fileName,
  file,
  analysisLoading = false,
  geometryResultsNav,
}: StlPreviewProps) {
  const { hideSidebar } = useAppLayout();
  const wrapRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<SceneBridge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({
    representation: "surfaceEdges",
    showEdges: true,
    opacity: 1,
  });
  const [datasetKind, setDatasetKind] = useState<"stl" | "vtk" | "vtu" | "pvd" | "foam">("stl");
  const [scalarFields, setScalarFields] = useState<ScalarField[]>([]);
  const [timeSteps, setTimeSteps] = useState<Array<{ time: number; file: string }>>([]);
  const [activeTimeStep, setActiveTimeStep] = useState(0);
  const [colorField, setColorField] = useState<string>("solid");
  const [colorMap, setColorMap] = useState<ColorMapName>("coolToWarm");
  const [rangeMode, setRangeMode] = useState<"auto" | "manual">("auto");
  const [manualRange, setManualRange] = useState<{ min: number; max: number }>({ min: 0, max: 1 });
  const [legendRange, setLegendRange] = useState<{ min: number; max: number }>({ min: 0, max: 1 });
  const [calcExpression, setCalcExpression] = useState("");
  const [calcError, setCalcError] = useState<string | null>(null);
  const [probeTooltip, setProbeTooltip] = useState<ProbeTooltip | null>(null);
  const [sliceOptions, setSliceOptions] = useState<SliceOptions>({
    enabled: false,
    plane: "xy",
    position: 0,
    invert: false,
    customNormal: { x: 0, y: 0, z: 1 },
  });
  const [sliceRange, setSliceRange] = useState<{ min: number; max: number }>({ min: -1, max: 1 });
  const [clipOptions, setClipOptions] = useState<ClipPlaneOptions>({
    enabled: false,
    plane: "xy",
    position: 0,
    invert: false,
  });
  const [clipRange, setClipRange] = useState<{ min: number; max: number }>({ min: -1, max: 1 });
  const [colorMapReverse, setColorMapReverse] = useState(false);
  const [contourEnabled, setContourEnabled] = useState(false);
  const [contourField, setContourField] = useState<string>("pressure");
  const [contourIso, setContourIso] = useState(0);
  const [contourRange, setContourRange] = useState<{ min: number; max: number }>({ min: 0, max: 1 });
  const [streamlineEnabled, setStreamlineEnabled] = useState(false);
  const [streamlineSeeds, setStreamlineSeeds] = useState(24);
  const [streamlineSteps, setStreamlineSteps] = useState(80);
  const [streamlineSeedsMode, setStreamlineSeedsMode] = useState<"center" | "random">("random");
  const [glyphEnabled, setGlyphEnabled] = useState(false);
  const [glyphStride, setGlyphStride] = useState(8);
  const [glyphScale, setGlyphScale] = useState(1);
  const [probeMode, setProbeMode] = useState<"hover" | "click">("hover");
  const [pipeline, setPipeline] = useState<PipelineEntry[]>([]);
  const pipelineAppendRef = useRef<(entry: PipelineEntry) => void>(() => {});
  const addDatasetInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen] = useState(true);
  const isFullscreenRef = useRef(false);
  const [geometryPlane, setGeometryPlane] = useState<GeometryPlaneInfo>({
    label: "3D",
    axis: null,
    confidence: "low",
  });
  const [axisSummary, setAxisSummary] = useState<AxisSummary | null>(null);

  const busy = loading || analysisLoading;
  const isLoading = loading;

  useEffect(() => {
    pipelineAppendRef.current = (entry) => setPipeline((p) => [...p, entry]);
  }, []);

  useEffect(() => {
    bridgeRef.current?.setInteractionEnabled(!busy);
    bridgeRef.current?.setRenderPaused(busy);
  }, [busy]);

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
    const raf = requestAnimationFrame(() => {
      bridgeRef.current?.resize();
    });
    return () => cancelAnimationFrame(raf);
  }, [isFullscreen]);

  useEffect(() => {
    bridgeRef.current?.setDisplayOptions(displayOptions);
  }, [displayOptions]);

  useEffect(() => {
    bridgeRef.current?.setColorField(colorField);
  }, [colorField]);

  useEffect(() => {
    bridgeRef.current?.setColorMap(colorMap);
  }, [colorMap]);

  useEffect(() => {
    bridgeRef.current?.setColorRange(rangeMode, manualRange);
  }, [rangeMode, manualRange]);

  useEffect(() => {
    bridgeRef.current?.setSliceOptions(sliceOptions);
  }, [sliceOptions]);

  useEffect(() => {
    bridgeRef.current?.setClipOptions(clipOptions);
  }, [clipOptions]);

  useEffect(() => {
    bridgeRef.current?.setColorMapReverse(colorMapReverse);
  }, [colorMapReverse]);

  useEffect(() => {
    bridgeRef.current?.setContourOptions(contourEnabled, contourField, contourIso);
  }, [contourEnabled, contourField, contourIso]);

  useEffect(() => {
    bridgeRef.current?.setStreamlineOptions(streamlineEnabled, {
      seedCount: streamlineSeeds,
      maxSteps: streamlineSteps,
      stepSize: 0.02,
      seedMode: streamlineSeedsMode,
    });
  }, [streamlineEnabled, streamlineSeeds, streamlineSteps, streamlineSeedsMode]);

  useEffect(() => {
    bridgeRef.current?.setGlyphOptions(glyphEnabled, { stride: glyphStride, scale: glyphScale });
  }, [glyphEnabled, glyphStride, glyphScale]);

  useEffect(() => {
    bridgeRef.current?.setProbeMode(probeMode);
  }, [probeMode]);

  const colorFieldOptions = useMemo(() => {
    const base = [{ key: "solid", label: "Solid" }];
    if (datasetKind === "stl") {
      return [
        ...base,
        { key: "pressure", label: "Pressure (Mock)" },
        { key: "velocity", label: "Velocity (Mock)" },
        { key: "temperature", label: "Temperature (Mock)" },
      ];
    }
    return [...base, ...scalarFields.map((f) => ({ key: f.key, label: f.label }))];
  }, [datasetKind, scalarFields]);

  const contourFieldOptions = useMemo(() => {
    if (datasetKind === "stl") {
      return [
        { key: "pressure", label: "Pressure (Mock)" },
        { key: "velocity", label: "Velocity (Mock)" },
        { key: "temperature", label: "Temperature (Mock)" },
      ];
    }
    return scalarFields.map((f) => ({ key: f.key, label: f.label }));
  }, [datasetKind, scalarFields]);

  const hasVectorField = useMemo(
    () => datasetKind !== "stl" && findVelocityComponents(scalarFields) !== null,
    [datasetKind, scalarFields]
  );

  useEffect(() => {
    const ok = contourFieldOptions.some((o) => o.key === contourField);
    if (!ok && contourFieldOptions.length) {
      setContourField(contourFieldOptions[0].key);
    }
  }, [contourField, contourFieldOptions]);

  useEffect(() => {
    if (datasetKind === "stl") {
      if (["pressure", "velocity", "temperature"].includes(contourField)) {
        setContourRange({ min: -1, max: 1 });
        setContourIso(0);
      }
      return;
    }
    const f = scalarFields.find((s) => s.key === contourField);
    if (f) {
      setContourRange({ min: f.min, max: f.max });
      setContourIso((f.min + f.max) / 2);
    }
  }, [contourField, scalarFields, datasetKind]);

  const legendFieldTitle = useMemo(() => {
    const opt = colorFieldOptions.find((o) => o.key === colorField);
    return opt?.label ?? colorField;
  }, [colorField, colorFieldOptions]);

  const legendTicks = useMemo(() => buildLegendTicks(legendRange.min, legendRange.max, 5), [legendRange]);

  useEffect(() => {
    const exists = colorFieldOptions.some((o) => o.key === colorField);
    if (!exists) {
      setColorField("solid");
    }
  }, [colorField, colorFieldOptions]);

  useEffect(() => {
    const mount = wrapRef.current;
    if (!mount) return;

    let disposed = false;
    let animId = 0;
    let disposeScene: (() => void) | null = null;
    const isDisposed = () => disposed;

    const run = async () => {
      setLoading(true);
      setError(null);
      bridgeRef.current = null;
      setGeometryPlane({ label: "3D", axis: null, confidence: "low" });
      setAxisSummary(null);
      try {
        await waitForNonZeroSize(mount, isDisposed);
        if (disposed) return;

        const inputFile =
          file ??
          (caseId
            ? new File([await casesApi.fetchParaviewStlBlob(caseId)], fileName || "geometry.stl", {
                type: "model/stl",
              })
            : null);
        if (!inputFile) {
          throw new Error("No model data available to preview.");
        }
        if (disposed) return;

        const loaded = await loadDataset(inputFile, {
          pvdStepIndex: activeTimeStep,
          pvdStepFileResolver: async (refPath) => {
            const trimmed = refPath.trim();
            if (!trimmed) return null;
            if (file && (file.name === trimmed || file.name.endsWith(`/${trimmed}`))) {
              return file;
            }
            if (/^https?:\/\//i.test(trimmed)) {
              const response = await fetch(trimmed);
              if (!response.ok) return null;
              const blob = await response.blob();
              return new File([blob], trimmed.split("/").pop() || "dataset.vtu", {
                type: "application/octet-stream",
              });
            }
            return null;
          },
        });
        const geometry = loaded.geometry;
        setDatasetKind(loaded.kind);
        setScalarFields(loaded.scalarFields);
        setTimeSteps(loaded.timeSteps ?? []);
        if (typeof loaded.activeTimeStep === "number") {
          setActiveTimeStep(loaded.activeTimeStep);
        }
        setCalcError(null);

        const pos = geometry.getAttribute("position");
        if (!pos || pos.count < 3) {
          throw new Error("Dataset has no geometry to display.");
        }

        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        if (bb.isEmpty()) {
          throw new Error("Dataset bounding box is empty.");
        }

        const material = new THREE.MeshStandardMaterial({
          color: PV_SURFACE,
          roughness: 0.44,
          metalness: 0.03,
          emissive: 0x0f141b,
          emissiveIntensity: 0.08,
          side: THREE.DoubleSide,
          flatShading: false,
          polygonOffset: true,
          polygonOffsetFactor: 1.25,
          polygonOffsetUnits: 1.25,
        });
        const mesh = new THREE.Mesh(geometry, material);
        let pointOverlay: THREE.Points | null = null;

        // WireframeGeometry shows full triangle mesh edges (ParaView-like mesh view).
        const edgeGeom = new THREE.WireframeGeometry(geometry);
        const edgeMat = new THREE.LineBasicMaterial({
          color: PV_EDGE,
          transparent: true,
          opacity: 0.98,
          depthWrite: false,
        });
        const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
        mesh.add(edgeLines);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(PV_VIEWPORT_BG);
        scene.add(mesh);

        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const hemi = new THREE.HemisphereLight(0xf2f4f7, 0x2a2e36, 0.3);
        scene.add(hemi);
        const key = new THREE.DirectionalLight(0xffffff, 1.0);
        key.position.set(5.5, 8.2, 6.2);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xe4e8ee, 0.48);
        fill.position.set(-4.5, 3.2, -5);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0xd8dce2, 0.3);
        rim.position.set(-2, -1.2, 6);
        scene.add(rim);

        // Camera-follow light keeps thin/flat STL surfaces visible from any angle.
        const headLight = new THREE.DirectionalLight(0xffffff, 0.62);
        scene.add(headLight);

        const w0 = mount.clientWidth;
        const h0 = mount.clientHeight;
        const camera = new THREE.PerspectiveCamera(45, w0 / Math.max(h0, 1), 0.001, 1e7);

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.localClippingEnabled = true;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w0, h0);
        renderer.domElement.className =
          "block h-full w-full outline-none rounded-md touch-none";
        mount.appendChild(renderer.domElement);

        const orientationRenderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        orientationRenderer.outputColorSpace = THREE.SRGBColorSpace;
        orientationRenderer.toneMapping = THREE.NoToneMapping;
        orientationRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        orientationRenderer.domElement.className =
          "pointer-events-none absolute bottom-3 right-3 z-10 rounded-lg";
        mount.appendChild(orientationRenderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;

        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const rawMaxDim = Math.max(size.x, size.y, size.z, 1e-12);
        // Normalize extreme CAD/CFD unit ranges so camera controls remain stable.
        // This prevents "loaded but invisible" when coordinates are tiny or huge.
        let normalizationScale = 1;
        if (rawMaxDim < 1e-3) normalizationScale = 1000;
        else if (rawMaxDim > 1e6) normalizationScale = 1e-6;
        if (normalizationScale !== 1) {
          mesh.scale.setScalar(normalizationScale);
        }
        const normBox = new THREE.Box3().setFromObject(mesh);
        const normCenter = normBox.getCenter(new THREE.Vector3());
        const normSize = normBox.getSize(new THREE.Vector3());
        const maxDim = Math.max(normSize.x, normSize.y, normSize.z, 1e-9);
        const posAttrForDebug = geometry.getAttribute("position");
        console.log("[VTU/STL] geometry stats", {
          kind: loaded.kind,
          vertices: posAttrForDebug?.count ?? 0,
          bboxMin: normBox.min.toArray(),
          bboxMax: normBox.max.toArray(),
          maxDim,
        });
        setGeometryPlane(detectGeometryPlane(size));
        setAxisSummary(buildAxisSummary(size));
        mesh.position.sub(normCenter);

        if (loaded.kind !== "stl") {
          // Hard visibility fallback for VTU/OpenFOAM: show a point cloud overlay.
          // This still appears even if triangle shading or edges fail.
          const pointMaterial = new THREE.PointsMaterial({
            color: 0x7dd3fc,
            size: Math.max(maxDim * 0.004, 0.8),
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          });
          pointOverlay = new THREE.Points(geometry, pointMaterial);
          pointOverlay.renderOrder = 2;
          pointOverlay.position.copy(mesh.position);
          scene.add(pointOverlay);
        }

        const orientationScene = new THREE.Scene();
        const orientationCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
        orientationCamera.position.set(0, 0, 2.6);
        orientationCamera.lookAt(0, 0, 0);
        orientationScene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const orientationLight = new THREE.DirectionalLight(0xffffff, 1.1);
        orientationLight.position.set(2, 2.5, 3);
        orientationScene.add(orientationLight);
        const orientationBackdrop = new THREE.Mesh(
          new THREE.PlaneGeometry(3.2, 3.2),
          new THREE.MeshBasicMaterial({
            color: 0x111827,
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
            toneMapped: false,
          })
        );
        orientationBackdrop.position.z = -0.55;
        orientationScene.add(orientationBackdrop);

        const orientationTriad = createOrientationTriad();
        orientationScene.add(orientationTriad.group);

        const near = Math.max(maxDim / 5000, 0.0001);
        // Prevent "Loaded but blank" when the dataset bounds are extremely tiny:
        // ensure camera distance is comfortably beyond the near plane.
        const dist = Math.max(maxDim * 2.35, near * 250);
        camera.near = near;
        camera.far = Math.max(maxDim * 200, 10000);
        camera.updateProjectionMatrix();
        camera.position.set(dist * 0.62, dist * 0.48, dist * 0.62);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();

        const homeCam = camera.position.clone();
        const homeTarget = controls.target.clone();
        const slicePlane = new THREE.Plane();
        const clipPlane = new THREE.Plane();
        let activeSliceOptions: SliceOptions = sliceOptions;
        let activeClipOptions: ClipPlaneOptions = clipOptions;
        let activeColorMapReverse = colorMapReverse;
        let activeContourEnabled = contourEnabled;
        let activeContourField = contourField;
        let activeContourIso = contourIso;
        let activeStreamlineEnabled = streamlineEnabled;
        let activeStreamlineOpts: StreamlineOptions = {
          seedCount: streamlineSeeds,
          maxSteps: streamlineSteps,
          stepSize: 0.02,
          seedMode: streamlineSeedsMode,
        };
        let activeGlyphEnabled = glyphEnabled;
        let activeGlyphOpts: GlyphOptions = { stride: glyphStride, scale: glyphScale };
        let activeProbeMode: "hover" | "click" = probeMode;

        const allSurfaceMaterials: THREE.MeshStandardMaterial[] = [material];
        const pipelineMeshes = new Map<string, THREE.Mesh>();
        pipelineMeshes.set("primary", mesh);
        const allRaycastTargets: THREE.Object3D[] = [mesh];
        const secondaryDisposers: Array<() => void> = [];

        const contourOverlay = new THREE.Group();
        const streamlineOverlay = new THREE.Group();
        const glyphOverlay = new THREE.Group();
        scene.add(contourOverlay, streamlineOverlay, glyphOverlay);

        const getSliceNormal = (opts: SliceOptions) => {
          const n =
            opts.plane === "custom"
              ? new THREE.Vector3(opts.customNormal.x, opts.customNormal.y, opts.customNormal.z)
              : SLICE_NORMALS[opts.plane].clone();
          if (n.lengthSq() < 1e-10) return new THREE.Vector3(0, 0, 1);
          n.normalize();
          if (opts.invert) n.multiplyScalar(-1);
          return n;
        };

        const getBoundsAlongNormal = (normal: THREE.Vector3) => {
          const centeredBox = new THREE.Box3().setFromObject(mesh);
          const corners = [
            new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.min.z),
            new THREE.Vector3(centeredBox.min.x, centeredBox.min.y, centeredBox.max.z),
            new THREE.Vector3(centeredBox.min.x, centeredBox.max.y, centeredBox.min.z),
            new THREE.Vector3(centeredBox.min.x, centeredBox.max.y, centeredBox.max.z),
            new THREE.Vector3(centeredBox.max.x, centeredBox.min.y, centeredBox.min.z),
            new THREE.Vector3(centeredBox.max.x, centeredBox.min.y, centeredBox.max.z),
            new THREE.Vector3(centeredBox.max.x, centeredBox.max.y, centeredBox.min.z),
            new THREE.Vector3(centeredBox.max.x, centeredBox.max.y, centeredBox.max.z),
          ];
          let minProj = Number.POSITIVE_INFINITY;
          let maxProj = Number.NEGATIVE_INFINITY;
          corners.forEach((c) => {
            const p = normal.dot(c);
            minProj = Math.min(minProj, p);
            maxProj = Math.max(maxProj, p);
          });
          if (!Number.isFinite(minProj) || !Number.isFinite(maxProj)) return { min: -1, max: 1 };
          if (Math.abs(maxProj - minProj) < 1e-9) return { min: minProj - 1, max: maxProj + 1 };
          return { min: minProj, max: maxProj };
        };

        const clipAxisNormal = (preset: ClipPlaneOptions["plane"]) => {
          if (preset === "xy") return new THREE.Vector3(0, 0, 1);
          if (preset === "yz") return new THREE.Vector3(1, 0, 0);
          return new THREE.Vector3(0, 1, 0);
        };

        const applyClipping = (sliceOpts: SliceOptions, clipOpts: ClipPlaneOptions) => {
          activeSliceOptions = sliceOpts;
          activeClipOptions = clipOpts;
          const planes: THREE.Plane[] = [];
          if (sliceOpts.enabled) {
            const normal = getSliceNormal(sliceOpts);
            const bounds = getBoundsAlongNormal(normal);
            setSliceRange(bounds);
            const clampedPos = THREE.MathUtils.clamp(sliceOpts.position, bounds.min, bounds.max);
            if (clampedPos !== sliceOpts.position) {
              setSliceOptions((prev) => ({ ...prev, position: clampedPos }));
            }
            slicePlane.set(normal, -clampedPos);
            planes.push(slicePlane);
          }
          if (clipOpts.enabled) {
            const baseN = clipAxisNormal(clipOpts.plane);
            const cb = getBoundsAlongNormal(baseN);
            setClipRange(cb);
            const clampedClip = THREE.MathUtils.clamp(clipOpts.position, cb.min, cb.max);
            if (clampedClip !== clipOpts.position) {
              setClipOptions((prev) => ({ ...prev, position: clampedClip }));
            }
            clipPlane.copy(makeClippingPlane({ ...clipOpts, position: clampedClip }));
            planes.push(clipPlane);
          }
          allSurfaceMaterials.forEach((m) => {
            m.clippingPlanes = planes;
            m.clipShadows = planes.length > 0;
            m.needsUpdate = true;
          });
        };
        applyClipping(sliceOptions, clipOptions);

        const fieldStore = [...loaded.scalarFields];
        let activeColorMap: ColorMapName = colorMap;
        let activeRangeMode: "auto" | "manual" = rangeMode;
        let activeManualRange = manualRange;

        const getFieldScalarArray = (fieldKey: string): Float32Array | null => {
          if (fieldKey === "solid") return null;
          if (loaded.kind === "stl") {
            const fk = fieldKey as ScalarFieldKey;
            if (fk !== "pressure" && fk !== "velocity" && fk !== "temperature") return null;
            const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
            return createMockScalarValues(posAttr, fk).values;
          }
          const f = fieldStore.find((x) => x.key === fieldKey);
          return f?.values ?? null;
        };

        const getFieldRangeForContour = (fieldKey: string): { min: number; max: number } | null => {
          if (fieldKey === "solid") return null;
          if (loaded.kind === "stl") {
            const fk = fieldKey as ScalarFieldKey;
            if (fk !== "pressure" && fk !== "velocity" && fk !== "temperature") return null;
            const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
            return createMockScalarValues(posAttr, fk).stats;
          }
          const f = fieldStore.find((x) => x.key === fieldKey);
          return f ? { min: f.min, max: f.max } : null;
        };

        const rebuildContour = () => {
          while (contourOverlay.children.length) {
            const ch = contourOverlay.children[0];
            contourOverlay.remove(ch);
            if (ch instanceof THREE.LineSegments) {
              ch.geometry.dispose();
              (ch.material as THREE.Material).dispose();
            }
          }
          if (!activeContourEnabled) return;
          const scalars = getFieldScalarArray(activeContourField);
          if (!scalars) return;
          const range = getFieldRangeForContour(activeContourField);
          const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
          const geom = buildSurfaceContourGeometry(posAttr, scalars, activeContourIso);
          const attr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
          if (!attr || attr.count === 0) {
            geom.dispose();
            return;
          }
          const rmin = range?.min ?? 0;
          const rmax = range?.max ?? 1;
          const span = Math.max(rmax - rmin, 1e-9);
          const tNorm = THREE.MathUtils.clamp((activeContourIso - rmin) / span, 0, 1);
          const col = sampleColorMapAt(activeColorMap, tNorm, { reverse: activeColorMapReverse });
          const lineMat = new THREE.LineBasicMaterial({
            color: col,
            depthTest: true,
            transparent: true,
            opacity: 0.95,
          });
          const lines = new THREE.LineSegments(geom, lineMat);
          contourOverlay.add(lines);
        };

        const rebuildStreamlines = () => {
          while (streamlineOverlay.children.length) {
            const ch = streamlineOverlay.children[0];
            streamlineOverlay.remove(ch);
            if (ch instanceof THREE.LineSegments) {
              ch.geometry.dispose();
              (ch.material as THREE.Material).dispose();
            }
          }
          if (!activeStreamlineEnabled) return;
          const vel = findVelocityComponents(fieldStore);
          if (!vel) return;
          const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
          const bounds = new THREE.Box3().setFromObject(mesh);
          const geom = buildStreamlineGeometry(
            posAttr,
            vel.fx.values,
            vel.fy.values,
            vel.fz.values,
            bounds,
            activeStreamlineOpts
          );
          const slMat = new THREE.LineBasicMaterial({
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.9,
          });
          const lines = new THREE.LineSegments(geom, slMat);
          streamlineOverlay.add(lines);
        };

        const rebuildGlyphs = () => {
          while (glyphOverlay.children.length) {
            const ch = glyphOverlay.children[0];
            glyphOverlay.remove(ch);
            if (ch instanceof THREE.InstancedMesh) {
              ch.geometry.dispose();
              (ch.material as THREE.Material).dispose();
            }
          }
          if (!activeGlyphEnabled) return;
          const vel = findVelocityComponents(fieldStore);
          if (!vel) return;
          const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
          const bounds = new THREE.Box3().setFromObject(mesh);
          const inst = buildVelocityGlyphMesh(
            posAttr,
            vel.fx.values,
            vel.fy.values,
            vel.fz.values,
            bounds,
            activeGlyphOpts
          );
          glyphOverlay.add(inst);
        };

        rebuildContour();
        rebuildStreamlines();
        rebuildGlyphs();

        const applyDisplay = (options: DisplayOptions) => {
          const isWireframe = options.representation === "wireframe";
          const showEdgeLines =
            isWireframe ||
            options.representation === "surfaceEdges" ||
            (options.representation === "surface" && options.showEdges);

          if (isWireframe) {
            material.visible = false;
          } else {
            material.visible = true;
          }

          edgeLines.visible = showEdgeLines;
          material.opacity = options.opacity;
          material.transparent = options.opacity < 0.999;
          material.needsUpdate = true;
          if (pointOverlay) {
            // Keep fallback points visible only for surface-like modes.
            pointOverlay.visible = !isWireframe;
          }
        };
        applyDisplay(displayOptions);

        let activeProbeField: ScalarField | null = null;
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();

        const applyColoring = (fieldKey: string) => {
          if (fieldKey === "solid") {
            material.color.setHex(PV_SURFACE);
            material.vertexColors = false;
            geometry.deleteAttribute("color");
            material.needsUpdate = true;
            setLegendRange({ min: 0, max: 1 });
            activeProbeField = null;
            rebuildContour();
            return;
          }

          if (loaded.kind === "stl") {
            const mockField = applyStlMockField(
              geometry,
              fieldKey as "pressure" | "velocity" | "temperature" | "solid",
              { reverse: activeColorMapReverse }
            );
            material.color.setHex(0xffffff);
            material.vertexColors = true;
            material.needsUpdate = true;
            const colorAttr = geometry.getAttribute("color");
            if (colorAttr) colorAttr.needsUpdate = true;
            if (mockField) {
              activeProbeField = mockField;
              setLegendRange({ min: mockField.min, max: mockField.max });
              if (activeRangeMode === "manual") {
                setManualRange((prev) => ({ min: prev.min, max: prev.max }));
              }
            }
            rebuildContour();
            return;
          }

          const field = fieldStore.find((f) => f.key === fieldKey);
          if (!field) return;
          activeProbeField = field;
          const applied = applyColorMap(
            geometry,
            field,
            activeColorMap,
            activeRangeMode === "manual" ? activeManualRange : undefined,
            { reverse: activeColorMapReverse }
          );
          material.color.setHex(0xffffff);
          material.vertexColors = true;
          material.needsUpdate = true;
          const colorAttr = geometry.getAttribute("color");
          if (colorAttr) colorAttr.needsUpdate = true;
          setLegendRange(applied);
          rebuildContour();
        };
        applyColoring(colorField);

        const makeProbeLines = (
          selected: ScalarField,
          face: { a: number; b: number; c: number },
          value: number
        ) => {
          const lines = [`${selected.label}: ${value.toFixed(4)}`];
          const pressureField =
            fieldStore.find((f) => /(^|_)pressure($|_)/i.test(f.key)) ||
            fieldStore.find((f) => /pressure/i.test(f.label));
          const velocityField =
            fieldStore.find((f) => /velocity.*magnitude/i.test(f.label)) ||
            fieldStore.find((f) => /(^|_)velocity($|_)/i.test(f.key)) ||
            fieldStore.find((f) => /velocity/i.test(f.label));

          if (pressureField && pressureField.key !== selected.key) {
            lines.push(`Pressure: ${probeValue(pressureField, face).value.toFixed(4)}`);
          }
          if (velocityField && velocityField.key !== selected.key) {
            lines.push(`Velocity: ${probeValue(velocityField, face).value.toFixed(4)}`);
          }
          return lines;
        };

        const updateProbeTooltip = (
          event: PointerEvent,
          rect: DOMRect,
          face: { a: number; b: number; c: number }
        ) => {
          if (!activeProbeField) return;
          const p = probeValue(activeProbeField, face);
          setProbeTooltip({
            x: event.clientX - rect.left + 12,
            y: event.clientY - rect.top + 12,
            lines: makeProbeLines(activeProbeField, face, p.value),
          });
        };

        const onPointerMove = (event: PointerEvent) => {
          if (activeProbeMode !== "hover" || !activeProbeField || busy) {
            if (activeProbeMode === "hover") setProbeTooltip(null);
            return;
          }
          const rect = renderer.domElement.getBoundingClientRect();
          ndc.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
          ndc.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
          raycaster.setFromCamera(ndc, camera);
          const hits = raycaster.intersectObject(mesh, false);
          if (!hits.length || !hits[0].face) {
            setProbeTooltip(null);
            return;
          }
          updateProbeTooltip(event, rect, hits[0].face);
        };

        const onPointerClick = (event: PointerEvent) => {
          if (activeProbeMode !== "click" || !activeProbeField || busy) return;
          const rect = renderer.domElement.getBoundingClientRect();
          ndc.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
          ndc.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
          raycaster.setFromCamera(ndc, camera);
          const hits = raycaster.intersectObject(mesh, false);
          if (!hits.length || !hits[0].face) {
            setProbeTooltip(null);
            return;
          }
          updateProbeTooltip(event, rect, hits[0].face);
        };

        const onPointerLeave = () => {
          if (activeProbeMode === "hover") setProbeTooltip(null);
        };
        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("click", onPointerClick);
        renderer.domElement.addEventListener("pointerleave", onPointerLeave);

        const resizeViewport = () => {
          const rw = mount.clientWidth;
          const rh = mount.clientHeight;
          if (rw < 4 || rh < 4) return;
          camera.aspect = rw / Math.max(rh, 1);
          camera.updateProjectionMatrix();
          renderer.setSize(rw, rh);

          const fullscreen = isFullscreenRef.current;
          const widgetSize = Math.min(
            fullscreen ? 176 : ORIENTATION_VIEWPORT_SIZE,
            Math.max(
              fullscreen ? 112 : 96,
              Math.floor(Math.min(rw, rh) * (fullscreen ? 0.22 : 0.24))
            )
          );
          orientationCamera.aspect = 1;
          orientationCamera.updateProjectionMatrix();
          orientationRenderer.setSize(widgetSize, widgetSize, false);
        };

        let renderPaused = false;

        const renderFrame = () => {
          headLight.position.copy(camera.position);
          headLight.target.position.set(0, 0, 0);
          headLight.target.updateMatrixWorld();
          controls.update();
          orientationTriad.group.quaternion.copy(camera.quaternion).invert();
          orientationTriad.labels.forEach((label) => {
            label.quaternion.copy(orientationCamera.quaternion);
          });
          renderer.render(scene, camera);
          orientationRenderer.clear();
          orientationRenderer.render(orientationScene, orientationCamera);
        };

        const loop = () => {
          if (renderPaused || disposed) {
            animId = 0;
            return;
          }
          animId = requestAnimationFrame(loop);
          renderFrame();
        };

        const setRenderPaused = (paused: boolean) => {
          renderPaused = paused;
          if (paused) {
            if (animId) {
              cancelAnimationFrame(animId);
              animId = 0;
            }
            renderFrame();
            return;
          }
          if (!animId) {
            loop();
          }
        };

        bridgeRef.current = {
          resetView: () => {
            camera.position.copy(homeCam);
            controls.target.copy(homeTarget);
            controls.update();
          },
          setDisplayOptions: (options) => applyDisplay(options),
          setColorField: (fieldKey) => applyColoring(fieldKey),
          setColorMap: (mapName) => {
            activeColorMap = mapName;
            applyColoring(colorField);
          },
          setColorRange: (mode, manual) => {
            activeRangeMode = mode;
            activeManualRange = manual;
            applyColoring(colorField);
          },
          setSliceOptions: (opts) => applyClipping(opts, activeClipOptions),
          setClipOptions: (opts) => applyClipping(activeSliceOptions, opts),
          setColorMapReverse: (reverse) => {
            activeColorMapReverse = reverse;
            applyColoring(colorField);
          },
          setContourOptions: (enabled, fieldKey, iso) => {
            activeContourEnabled = enabled;
            activeContourField = fieldKey;
            activeContourIso = iso;
            rebuildContour();
          },
          setStreamlineOptions: (enabled, opts) => {
            activeStreamlineEnabled = enabled;
            activeStreamlineOpts = opts;
            rebuildStreamlines();
          },
          setGlyphOptions: (enabled, opts) => {
            activeGlyphEnabled = enabled;
            activeGlyphOpts = opts;
            rebuildGlyphs();
          },
          setProbeMode: (mode) => {
            activeProbeMode = mode;
            setProbeTooltip(null);
          },
          setCameraPreset: (preset) => {
            const dist = Math.max(maxDim * 2.35, near * 250);
            if (preset === "reset") {
              camera.position.copy(homeCam);
              controls.target.copy(homeTarget);
              controls.update();
              return;
            }
            if (preset === "front") camera.position.set(0, 0, dist);
            else if (preset === "top") camera.position.set(0, dist, 0);
            else if (preset === "side") camera.position.set(dist, 0, 0);
            else camera.position.set(dist * 0.62, dist * 0.48, dist * 0.62);
            camera.lookAt(0, 0, 0);
            controls.target.set(0, 0, 0);
            controls.update();
          },
          setPipelineVisibility: (id, visible) => {
            const m = pipelineMeshes.get(id);
            if (m) m.visible = visible;
          },
          addSecondaryDataset: async (extra: File) => {
            const loaded2 = await loadDataset(extra, {
              pvdStepIndex: activeTimeStep,
              pvdStepFileResolver: async (refPath) => {
                const trimmed = refPath.trim();
                if (!trimmed) return null;
                if (file && (file.name === trimmed || file.name.endsWith(`/${trimmed}`))) {
                  return file;
                }
                if (/^https?:\/\//i.test(trimmed)) {
                  const response = await fetch(trimmed);
                  if (!response.ok) return null;
                  const blob = await response.blob();
                  return new File([blob], trimmed.split("/").pop() || "dataset.vtu", {
                    type: "application/octet-stream",
                  });
                }
                return null;
              },
            });
            const geom2 = loaded2.geometry;
            const mat2 = new THREE.MeshStandardMaterial({
              color: 0xc5d0df,
              roughness: 0.44,
              metalness: 0.03,
              side: THREE.DoubleSide,
              flatShading: false,
              polygonOffset: true,
              polygonOffsetFactor: 1.25,
              polygonOffsetUnits: 1.25,
            });
            mat2.clippingPlanes = material.clippingPlanes;
            mat2.clipShadows = !!material.clippingPlanes?.length;
            const mesh2 = new THREE.Mesh(geom2, mat2);
            const box2 = new THREE.Box3().setFromObject(mesh2);
            const c2 = box2.getCenter(new THREE.Vector3());
            mesh2.position.sub(c2);
            const offset = maxDim * 0.55 * pipelineMeshes.size;
            mesh2.position.x += offset;
            scene.add(mesh2);
            const id = `ds-${Date.now()}`;
            pipelineMeshes.set(id, mesh2);
            allRaycastTargets.push(mesh2);
            allSurfaceMaterials.push(mat2);
            applyClipping(activeSliceOptions, activeClipOptions);
            secondaryDisposers.push(() => {
              geom2.dispose();
              mat2.dispose();
              scene.remove(mesh2);
              pipelineMeshes.delete(id);
              const ix = allRaycastTargets.indexOf(mesh2);
              if (ix >= 0) allRaycastTargets.splice(ix, 1);
              const mix = allSurfaceMaterials.indexOf(mat2);
              if (mix >= 0) allSurfaceMaterials.splice(mix, 1);
            });
            pipelineAppendRef.current?.({ id, name: extra.name, visible: true });
          },
          addDerivedField: (field) => {
            const idx = fieldStore.findIndex((f) => f.key === field.key);
            if (idx >= 0) {
              fieldStore[idx] = field;
            } else {
              fieldStore.push(field);
            }
            setScalarFields([...fieldStore]);
            setColorField(field.key);
            setRangeMode("auto");
            applyColoring(field.key);
            rebuildContour();
            rebuildStreamlines();
            rebuildGlyphs();
          },
          getScalarFields: () => [...fieldStore],
          setInteractionEnabled: (on: boolean) => {
            controls.enabled = on;
          },
          setRenderPaused,
          resize: resizeViewport,
        };

        setRenderPaused(analysisLoading);
        if (!analysisLoading) {
          loop();
        }
        resizeViewport();

        const ro = new ResizeObserver(() => {
          if (disposed) return;
          resizeViewport();
        });
        ro.observe(mount);

        disposeScene = () => {
          bridgeRef.current = null;
          cancelAnimationFrame(animId);
          ro.disconnect();
          renderer.domElement.removeEventListener("pointermove", onPointerMove);
          renderer.domElement.removeEventListener("click", onPointerClick);
          renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
          secondaryDisposers.forEach((d) => d());
          secondaryDisposers.length = 0;
          const disposeOverlayGroup = (group: THREE.Group) => {
            while (group.children.length) {
              const ch = group.children[0];
              group.remove(ch);
              if (ch instanceof THREE.LineSegments) {
                ch.geometry.dispose();
                (ch.material as THREE.Material).dispose();
              } else if (ch instanceof THREE.InstancedMesh) {
                ch.geometry.dispose();
                (ch.material as THREE.Material).dispose();
              }
            }
          };
          disposeOverlayGroup(contourOverlay);
          disposeOverlayGroup(streamlineOverlay);
          disposeOverlayGroup(glyphOverlay);
          setProbeTooltip(null);
          controls.dispose();
          geometry.dispose();
          edgeGeom.dispose();
          edgeMat.dispose();
          material.dispose();
          if (pointOverlay) {
            scene.remove(pointOverlay);
            (pointOverlay.material as THREE.Material).dispose();
            pointOverlay = null;
          }
          orientationTriad.dispose();
          orientationBackdrop.geometry.dispose();
          (orientationBackdrop.material as THREE.Material).dispose();
          orientationRenderer.dispose();
          if (orientationRenderer.domElement.parentNode === mount) {
            mount.removeChild(orientationRenderer.domElement);
          }
          renderer.dispose();
          if (renderer.domElement.parentNode === mount) {
            mount.removeChild(renderer.domElement);
          }
        };

        if (disposed) {
          disposeScene();
          disposeScene = null;
          return;
        }
        if (loaded.kind !== "stl" && loaded.scalarFields.length > 0) {
          setManualRange({ min: loaded.scalarFields[0].min, max: loaded.scalarFields[0].max });
        } else {
          setManualRange({ min: 0, max: 1 });
        }
        // Reset clipping/slicing state per dataset so previous UI state
        // cannot hide the newly loaded mesh (common cause of "Loaded but blank").
        setSliceOptions({
          enabled: false,
          plane: "xy",
          position: 0,
          invert: false,
          customNormal: { x: 0, y: 0, z: 1 },
        });
        setClipOptions({
          enabled: false,
          plane: "xy",
          position: 0,
          invert: false,
        });
        if (loaded.kind === "stl") {
          setColorField("pressure");
          setContourField("pressure");
        } else if (loaded.scalarFields.length > 0) {
          // Start with solid surface for imported VTU/OpenFOAM so geometry is always visible.
          // Users can then switch to pressure/velocity in Color By.
          setColorField("solid");
          setContourField(loaded.scalarFields[0].key);
        } else {
          setColorField("solid");
        }
        setPipeline([{ id: "primary", name: inputFile.name, visible: true }]);
        setDisplayOptions({
          representation: "surfaceEdges",
          showEdges: true,
          opacity: 1,
        });
        setLoading(false);
        bridgeRef.current?.setInteractionEnabled(!analysisLoading);
      } catch (e) {
        if (!disposed) {
          const rawMessage = e instanceof Error ? e.message : "Could not load model preview.";
          const friendlyMessage =
            /foam marker/i.test(rawMessage)
              ? "'.foam' is only a marker file. Upload the full OpenFOAM case (.zip/.tar.gz) or a mesh/data file (.stl/.vtk/.vtu/.pvd)."
              : rawMessage;
          setError(friendlyMessage);
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      disposed = true;
      bridgeRef.current = null;
      if (disposeScene) {
        disposeScene();
        disposeScene = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, file, activeTimeStep]);

  const onDownloadParaview = async () => {
    if (busy || !caseId) return;
    try {
      const blob = await casesApi.fetchParaviewStlBlob(caseId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "geometry.stl";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    }
  };

  const onReset = () => {
    if (busy) return;
    bridgeRef.current?.resetView();
  };

  const onCameraPreset = (preset: "front" | "top" | "side" | "iso" | "reset") => {
    if (busy) return;
    bridgeRef.current?.setCameraPreset(preset);
  };

  const onAddDatasetFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    void bridgeRef.current?.addSecondaryDataset(f).catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load dataset.");
    });
    e.target.value = "";
  };

  const onWireframe = () => {
    if (busy) return;
    setDisplayOptions((prev) => ({
      ...prev,
      representation: prev.representation === "wireframe" ? "surfaceEdges" : "wireframe",
    }));
  };

  const onSolid = () => {
    if (busy) return;
    setDisplayOptions((prev) => ({
      ...prev,
      representation: prev.representation === "surfaceEdges" ? "surface" : "surfaceEdges",
    }));
  };

  const onRunCalculator = () => {
    if (busy || datasetKind === "stl") return;
    try {
      const fieldsForCalc = bridgeRef.current?.getScalarFields?.() ?? scalarFields;
      if (!fieldsForCalc.length) {
        setCalcError("No scalar fields loaded yet. Open a VTK/VTU file with point or cell data.");
        return;
      }
      const derived = computeDerivedField(calcExpression, fieldsForCalc, "Result");
      bridgeRef.current?.addDerivedField(derived);
      setCalcError(null);
      setCalcExpression("");
    } catch (e) {
      setCalcError(e instanceof Error ? e.message : "Calculator failed.");
    }
  };

  const statusLabel = error ? "Error" : loading ? "Loading" : "Loaded";

  const btnBase = viewerToolbarBtn;
  const btnActive = viewerToolbarBtnActive;

  return (
    <div
      className={`fixed inset-y-0 right-0 left-0 z-[12000] flex max-h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden bg-[#13171c] ${hideSidebar ? "" : "lg:left-[var(--sidebar-width)]"}`}
    >
      <div className="flex shrink-0 flex-col gap-3 border-b border-slate-800 bg-[#0a0d12] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold tracking-tight text-slate-100">
              3D Model Viewer
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-400" title={fileName}>
              {fileName}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
              error
                ? "bg-red-950/80 text-red-300 ring-1 ring-red-800/80"
                : loading
                  ? "bg-amber-950/70 text-amber-200 ring-1 ring-amber-800/60"
                  : "bg-emerald-950/70 text-emerald-200 ring-1 ring-emerald-800/60"
            }`}
          >
            {statusLabel}
          </span>
          {geometryResultsNav?.onExit && (
            <button type="button" className={btnBase} disabled={busy} onClick={geometryResultsNav.onExit}>
              Exit
            </button>
          )}
          {!error && !loading && (
            <span className="shrink-0 rounded-full bg-slate-900/70 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-200 ring-1 ring-slate-700/80">
              Plane: {geometryPlane.label}
              {geometryPlane.axis ? ` (thin ${geometryPlane.axis})` : ""}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnBase} disabled={busy} onClick={onReset}>
            Reset view
          </button>
          <button type="button" className={btnBase} disabled={busy} onClick={() => onCameraPreset("front")}>
            Front
          </button>
          <button type="button" className={btnBase} disabled={busy} onClick={() => onCameraPreset("top")}>
            Top
          </button>
          <button type="button" className={btnBase} disabled={busy} onClick={() => onCameraPreset("side")}>
            Side
          </button>
          <button type="button" className={btnBase} disabled={busy} onClick={() => onCameraPreset("iso")}>
            Iso
          </button>
          <button
            type="button"
            className={`${btnBase} ${displayOptions.representation === "wireframe" ? btnActive : ""}`}
            disabled={busy}
            onClick={onWireframe}
          >
            Wireframe
          </button>
          <button
            type="button"
            className={`${btnBase} ${displayOptions.representation !== "wireframe" ? btnActive : ""}`}
            disabled={busy}
            onClick={onSolid}
          >
            Solid
          </button>
          <span className="mx-1 hidden h-4 w-px bg-slate-700 sm:inline" aria-hidden />
          <button
            type="button"
            className={`${btnBase} ml-auto sm:ml-0`}
            disabled={busy}
            onClick={onDownloadParaview}
          >
            Download .stl
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111317] px-3 pb-3 pt-3"
      >
        <div
          className={`flex min-h-0 flex-1 flex-col transition-opacity duration-300 ease-in-out ${isLoading ? "pointer-events-none opacity-0" : "opacity-100"}`}
          aria-hidden={isLoading}
        >
          {error ? (
            <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-8 text-center text-sm text-red-300">
              {error}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,4fr)_minmax(280px,1fr)] lg:items-stretch">
            <div
              className="relative h-full min-h-0 w-full overflow-hidden border border-slate-700/80 bg-[#1e1e1e]"
              aria-busy={busy}
            >
              <div
                ref={wrapRef}
                className="stl-preview-canvas-host h-full min-h-[280px] w-full"
                aria-label="3D model canvas"
              />
              {probeTooltip && !busy && (
                <div
                  className="pointer-events-none absolute z-20 rounded-md border border-slate-700/80 bg-slate-950/95 px-2 py-1.5 text-[11px] text-slate-100 shadow-lg"
                  style={{ left: probeTooltip.x, top: probeTooltip.y }}
                >
                  {probeTooltip.lines.map((line, idx) => (
                    <div key={`${line}-${idx}`}>{line}</div>
                  ))}
                </div>
              )}
            </div>

            <aside
              className="min-h-0 max-h-[min(100%,calc(100dvh-10.5rem))] overflow-y-auto overflow-x-hidden border border-slate-800 bg-[#0b1017] p-3 text-xs text-slate-300 overscroll-contain"
            >
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-200">
                Properties
              </h4>

              <div className="space-y-4">
                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Axis Identification
                  </p>
                  <div className="space-y-1 rounded-md border border-slate-800 bg-slate-900/70 p-2 text-[11px]">
                    <p className="text-slate-300">X axis: Left ↔ Right</p>
                    <p className="text-slate-300">Y axis: Bottom ↔ Top</p>
                    <p className="text-slate-300">Z axis: Back ↔ Front</p>
                    <p className="mt-1 rounded border border-sky-700/70 bg-sky-900/35 px-2 py-1 text-[11px] font-semibold text-sky-200">
                      Near-planar: {geometryPlane.label}
                      {geometryPlane.axis ? ` (thin ${geometryPlane.axis})` : ""}
                    </p>
                    {axisSummary && (
                      <>
                        <p className="pt-1 text-slate-400">
                          Span: X={axisSummary.x.toFixed(3)}, Y={axisSummary.y.toFixed(3)}, Z=
                          {axisSummary.z.toFixed(3)}
                        </p>
                        <p className="text-slate-400">
                          Dominant: {axisSummary.primary} | Secondary: {axisSummary.secondary} | Thin:{" "}
                          {axisSummary.thin}
                        </p>
                      </>
                    )}
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Display</p>
                  <label className="block text-[11px] text-slate-400">Representation</label>
                  <select
                    value={displayOptions.representation}
                    onChange={(e) =>
                      setDisplayOptions((prev) => ({
                        ...prev,
                        representation: e.target.value as DisplayRepresentation,
                      }))
                    }
                    disabled={busy}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                  >
                    <option value="surface">Surface</option>
                    <option value="wireframe">Wireframe</option>
                    <option value="surfaceEdges">Surface with edges</option>
                  </select>

                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Show edges</span>
                    <input
                      type="checkbox"
                      checked={displayOptions.showEdges}
                      onChange={(e) =>
                        setDisplayOptions((prev) => ({
                          ...prev,
                          showEdges: e.target.checked,
                        }))
                      }
                      disabled={busy}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Opacity</span>
                      <span>{displayOptions.opacity.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={displayOptions.opacity}
                      onChange={(e) =>
                        setDisplayOptions((prev) => ({
                          ...prev,
                          opacity: Number(e.target.value),
                        }))
                      }
                      disabled={busy}
                      className="w-full accent-sky-500"
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Slice</p>
                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Enable slice</span>
                    <input
                      type="checkbox"
                      checked={sliceOptions.enabled}
                      onChange={(e) =>
                        setSliceOptions((prev) => ({
                          ...prev,
                          enabled: e.target.checked,
                        }))
                      }
                      disabled={busy}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>

                  <label className="block text-[11px] text-slate-400">Plane</label>
                  <select
                    value={sliceOptions.plane}
                    onChange={(e) =>
                      setSliceOptions((prev) => ({
                        ...prev,
                        plane: e.target.value as SlicePlaneType,
                      }))
                    }
                    disabled={busy}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                  >
                    <option value="xy">XY</option>
                    <option value="yz">YZ</option>
                    <option value="xz">XZ</option>
                    <option value="custom">Custom</option>
                  </select>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Position</span>
                      <span>{sliceOptions.position.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min={sliceRange.min}
                      max={sliceRange.max}
                      step={Math.max((sliceRange.max - sliceRange.min) / 400, 1e-4)}
                      value={sliceOptions.position}
                      onChange={(e) =>
                        setSliceOptions((prev) => ({
                          ...prev,
                          position: Number(e.target.value),
                        }))
                      }
                      disabled={busy}
                      className="w-full accent-sky-500"
                    />
                  </div>

                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Invert slice</span>
                    <input
                      type="checkbox"
                      checked={sliceOptions.invert}
                      onChange={(e) =>
                        setSliceOptions((prev) => ({
                          ...prev,
                          invert: e.target.checked,
                        }))
                      }
                      disabled={busy}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>

                  {sliceOptions.plane === "custom" && (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        value={sliceOptions.customNormal.x}
                        onChange={(e) =>
                          setSliceOptions((prev) => ({
                            ...prev,
                            customNormal: { ...prev.customNormal, x: Number(e.target.value) },
                          }))
                        }
                        disabled={busy}
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                      />
                      <input
                        type="number"
                        value={sliceOptions.customNormal.y}
                        onChange={(e) =>
                          setSliceOptions((prev) => ({
                            ...prev,
                            customNormal: { ...prev.customNormal, y: Number(e.target.value) },
                          }))
                        }
                        disabled={busy}
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                      />
                      <input
                        type="number"
                        value={sliceOptions.customNormal.z}
                        onChange={(e) =>
                          setSliceOptions((prev) => ({
                            ...prev,
                            customNormal: { ...prev.customNormal, z: Number(e.target.value) },
                          }))
                        }
                        disabled={busy}
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                      />
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Clip</p>
                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Enable clip</span>
                    <input
                      type="checkbox"
                      checked={clipOptions.enabled}
                      onChange={(e) =>
                        setClipOptions((prev) => ({
                          ...prev,
                          enabled: e.target.checked,
                        }))
                      }
                      disabled={busy}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>
                  <label className="block text-[11px] text-slate-400">Plane</label>
                  <select
                    value={clipOptions.plane}
                    onChange={(e) =>
                      setClipOptions((prev) => ({
                        ...prev,
                        plane: e.target.value as ClipPlaneOptions["plane"],
                      }))
                    }
                    disabled={busy}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                  >
                    <option value="xy">XY</option>
                    <option value="yz">YZ</option>
                    <option value="xz">XZ</option>
                  </select>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Position</span>
                      <span>{clipOptions.position.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min={clipRange.min}
                      max={clipRange.max}
                      step={Math.max((clipRange.max - clipRange.min) / 400, 1e-4)}
                      value={clipOptions.position}
                      onChange={(e) =>
                        setClipOptions((prev) => ({
                          ...prev,
                          position: Number(e.target.value),
                        }))
                      }
                      disabled={busy}
                      className="w-full accent-sky-500"
                    />
                  </div>
                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Invert clip</span>
                    <input
                      type="checkbox"
                      checked={clipOptions.invert}
                      onChange={(e) =>
                        setClipOptions((prev) => ({
                          ...prev,
                          invert: e.target.checked,
                        }))
                      }
                      disabled={busy}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Contour</p>
                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Show iso-lines</span>
                    <input
                      type="checkbox"
                      checked={contourEnabled}
                      onChange={(e) => setContourEnabled(e.target.checked)}
                      disabled={busy || contourFieldOptions.length === 0}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>
                  <label className="block text-[11px] text-slate-400">Scalar</label>
                  <select
                    value={contourField}
                    onChange={(e) => {
                      const v = e.target.value;
                      setContourField(v);
                      setColorField(v);
                    }}
                    disabled={busy || contourFieldOptions.length === 0}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring disabled:opacity-50"
                  >
                    {contourFieldOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-400">Iso value</span>
                      <input
                        type="number"
                        value={contourIso}
                        onChange={(e) => setContourIso(Number(e.target.value))}
                        disabled={busy || !contourEnabled}
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-400">Range</span>
                      <p className="pt-1 text-[10px] text-slate-500">
                        [{contourRange.min.toFixed(4)}, {contourRange.max.toFixed(4)}]
                      </p>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={contourRange.min}
                    max={contourRange.max}
                    step={Math.max((contourRange.max - contourRange.min) / 200, 1e-6)}
                    value={contourIso}
                    onChange={(e) => setContourIso(Number(e.target.value))}
                    disabled={busy || !contourEnabled}
                    className="w-full accent-sky-500"
                  />
                  <p className="text-[10px] text-slate-500">
                    Surface iso-lines (triangle edges). Volumetric iso-surfaces use VTK pipelines.
                  </p>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Probe</p>
                  <label className="block text-[11px] text-slate-400">Mode</label>
                  <select
                    value={probeMode}
                    onChange={(e) => setProbeMode(e.target.value as "hover" | "click")}
                    disabled={busy}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                  >
                    <option value="hover">Hover</option>
                    <option value="click">Click</option>
                  </select>
                  <p className="text-[10px] text-slate-500">Requires a scalar color field (not solid).</p>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Streamlines</p>
                  {!hasVectorField && (
                    <p className="text-[10px] text-slate-500">
                      Needs vector field (e.g. U_X, U_Y, U_Z) on the mesh.
                    </p>
                  )}
                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Enable</span>
                    <input
                      type="checkbox"
                      checked={streamlineEnabled}
                      onChange={(e) => setStreamlineEnabled(e.target.checked)}
                      disabled={busy || !hasVectorField}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>
                  <label className="block text-[11px] text-slate-400">Seed placement</label>
                  <select
                    value={streamlineSeedsMode}
                    onChange={(e) => setStreamlineSeedsMode(e.target.value as "center" | "random")}
                    disabled={busy || !hasVectorField}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                  >
                    <option value="random">Random in volume</option>
                    <option value="center">Near center</option>
                  </select>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Lines (seeds)</span>
                      <span>{streamlineSeeds}</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={128}
                      step={1}
                      value={streamlineSeeds}
                      onChange={(e) => setStreamlineSeeds(Number(e.target.value))}
                      disabled={busy || !hasVectorField}
                      className="w-full accent-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Max steps</span>
                      <span>{streamlineSteps}</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={200}
                      step={5}
                      value={streamlineSteps}
                      onChange={(e) => setStreamlineSteps(Number(e.target.value))}
                      disabled={busy || !hasVectorField}
                      className="w-full accent-sky-500"
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Glyphs</p>
                  {!hasVectorField && (
                    <p className="text-[10px] text-slate-500">
                      Needs vector field (e.g. U_X, U_Y, U_Z) on the mesh.
                    </p>
                  )}
                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Enable arrows</span>
                    <input
                      type="checkbox"
                      checked={glyphEnabled}
                      onChange={(e) => setGlyphEnabled(e.target.checked)}
                      disabled={busy || !hasVectorField}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Density (stride)</span>
                      <span>{glyphStride}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={64}
                      step={1}
                      value={glyphStride}
                      onChange={(e) => setGlyphStride(Number(e.target.value))}
                      disabled={busy || !hasVectorField}
                      className="w-full accent-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Scale</span>
                      <span>{glyphScale.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={4}
                      step={0.05}
                      value={glyphScale}
                      onChange={(e) => setGlyphScale(Number(e.target.value))}
                      disabled={busy || !hasVectorField}
                      className="w-full accent-sky-500"
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Pipeline</p>
                  <ul className="space-y-1.5">
                    {pipeline.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5"
                      >
                        <span className="min-w-0 truncate text-[11px] text-slate-200" title={p.name}>
                          {p.name}
                        </span>
                        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400">
                          <span>Show</span>
                          <input
                            type="checkbox"
                            checked={p.visible}
                            onChange={(e) => {
                              const vis = e.target.checked;
                              setPipeline((prev) =>
                                prev.map((x) => (x.id === p.id ? { ...x, visible: vis } : x))
                              );
                              bridgeRef.current?.setPipelineVisibility(p.id, vis);
                            }}
                            disabled={busy}
                            className="h-3.5 w-3.5 accent-sky-500"
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                  <input
                    ref={addDatasetInputRef}
                    type="file"
                    accept=".stl,.vtk,.vtu,.pvd,.foam"
                    className="hidden"
                    onChange={onAddDatasetFile}
                  />
                  <button
                    type="button"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-800 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => addDatasetInputRef.current?.click()}
                  >
                    Add dataset…
                  </button>
                  <p className="text-[10px] text-slate-500">
                    Extra meshes are offset on X; coloring applies to the primary dataset.
                  </p>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Coloring</p>
                  <p className="text-[10px] leading-snug text-slate-500">
                    Surface colors use <span className="text-slate-400">Color By</span> below (not Contour alone).
                  </p>
                  <label className="block text-[11px] text-slate-400">Color By</label>
                  <select
                    value={colorField}
                    onChange={(e) => setColorField(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                  >
                    {colorFieldOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <label className="block text-[11px] text-slate-400">Color Map</label>
                  <select
                    value={colorMap}
                    onChange={(e) => setColorMap(e.target.value as ColorMapName)}
                    disabled={busy || colorField === "solid"}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring disabled:opacity-50"
                  >
                    <option value="coolToWarm">Cool to Warm</option>
                    <option value="viridis">Viridis</option>
                    <option value="jet">Jet</option>
                  </select>

                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Reverse colormap</span>
                    <input
                      type="checkbox"
                      checked={colorMapReverse}
                      onChange={(e) => setColorMapReverse(e.target.checked)}
                      disabled={busy || colorField === "solid"}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                    <span>Auto rescale</span>
                    <input
                      type="checkbox"
                      checked={rangeMode === "auto"}
                      onChange={(e) => setRangeMode(e.target.checked ? "auto" : "manual")}
                      disabled={busy || colorField === "solid"}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                  </label>

                  {rangeMode === "manual" && colorField !== "solid" && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        value={manualRange.min}
                        onChange={(e) =>
                          setManualRange((prev) => ({
                            ...prev,
                            min: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                      />
                      <input
                        type="number"
                        value={manualRange.max}
                        onChange={(e) =>
                          setManualRange((prev) => ({
                            ...prev,
                            max: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                      />
                    </div>
                  )}

                  {colorField !== "solid" && (
                    <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/70 p-2">
                      <div className="mb-2 text-[11px] font-medium text-slate-300" title={legendFieldTitle}>
                        {legendFieldTitle}
                      </div>
                      <div className="flex flex-row items-stretch gap-2">
                        <div
                          className="h-44 min-h-[176px] w-5 shrink-0 rounded-sm border border-slate-600"
                          style={{
                            background: getLegendGradientForColorMap(
                              colorMap,
                              datasetKind === "stl"
                                ? (colorField as "pressure" | "velocity" | "temperature" | "solid")
                                : undefined,
                              colorMapReverse
                            ),
                          }}
                          aria-hidden
                        />
                        <div className="flex min-h-[176px] flex-1 flex-col justify-between py-0.5 text-[10px] leading-tight text-slate-300">
                          {[...legendTicks]
                            .reverse()
                            .map((v, idx, arr) => {
                              const isEndpoint = idx === 0 || idx === arr.length - 1;
                              return (
                                <span
                                  key={`${v}-${idx}`}
                                  className="block font-mono tabular-nums"
                                  title={String(v)}
                                >
                                  {formatLegendTick(v, legendRange.min, legendRange.max, isEndpoint)}
                                </span>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {datasetKind === "pvd" && timeSteps.length > 0 && (
                  <section className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Time</p>
                    <label className="block text-[11px] text-slate-400">Timestep</label>
                    <select
                      value={activeTimeStep}
                      onChange={(e) => setActiveTimeStep(Number(e.target.value))}
                      disabled={busy}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring"
                    >
                      {timeSteps.map((step, idx) => (
                        <option key={`${step.time}-${idx}`} value={idx}>
                          t={step.time} ({step.file})
                        </option>
                      ))}
                    </select>
                  </section>
                )}

                <section className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Calculator</p>
                  <input
                    type="text"
                    value={calcExpression}
                    onChange={(e) => setCalcExpression(e.target.value)}
                    disabled={busy || datasetKind === "stl"}
                    placeholder="sqrt(velocity_X^2 + velocity_Y^2)"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-sky-500/60 focus:ring disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={onRunCalculator}
                    disabled={busy || datasetKind === "stl"}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    Compute Derived Field
                  </button>
                  {datasetKind === "stl" ? (
                    <p className="text-[10px] text-slate-500">
                      Calculator runs on VTK/VTU data only; STL uses mock scalars.
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500">
                      Use field keys (e.g. <span className="text-slate-400">U_X</span>) or aliases:{" "}
                      <span className="text-slate-400">velocity_X</span> →{" "}
                      <span className="text-slate-400">U_X</span>,{" "}
                      <span className="text-slate-400">pressure</span> → <span className="text-slate-400">p</span>.
                    </p>
                  )}
                  {calcError && <p className="text-[10px] text-red-300">{calcError}</p>}
                </section>
              </div>
            </aside>
            </div>
          )}
          <p className="mt-2 px-0.5 text-[11px] leading-relaxed text-slate-500">
            ParaView: <span className="text-slate-400">File → Open</span> → choose the .stl →{" "}
            <span className="text-slate-400">Apply</span>. Solid toggles between{" "}
            <span className="text-slate-400">Solid + Edges</span> and{" "}
            <span className="text-slate-400">Solid</span>.
          </p>
        </div>

        <div
          className={`absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[#1e1e1e] transition-opacity duration-300 ease-in-out ${
            isLoading ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!isLoading}
        >
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-600 border-t-slate-200" />
          <p className="text-sm font-medium tracking-wide text-slate-200">Loading STL...</p>
        </div>

        {geometryResultsNav && !error && (
          <GeometryResultsNextFab nav={geometryResultsNav} viewerBusy={busy || isLoading} />
        )}
      </div>
    </div>
  );
}
