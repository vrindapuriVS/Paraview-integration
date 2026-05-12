import { m as macro } from "@kitware/vtk.js/macros2.js";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData.js";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray.js";
import vtkXMLReader from "@kitware/vtk.js/IO/XML/XMLReader.js";

const VTK_CELL_TYPE = {
  TRIANGLE: 5,
  POLYGON: 7,
  QUAD: 9,
  TETRA: 10,
  HEXAHEDRON: 12,
  WEDGE: 13,
  PYRAMID: 14,
  POLYHEDRON: 42,
};

function getCellFaces(type, ids) {
  if (type === VTK_CELL_TYPE.TRIANGLE || type === VTK_CELL_TYPE.QUAD || type === VTK_CELL_TYPE.POLYGON) return [ids];
  if (type === VTK_CELL_TYPE.TETRA && ids.length >= 4) return [[ids[0], ids[1], ids[2]], [ids[0], ids[1], ids[3]], [ids[1], ids[2], ids[3]], [ids[2], ids[0], ids[3]]];
  if (type === VTK_CELL_TYPE.HEXAHEDRON && ids.length >= 8) return [[ids[0], ids[1], ids[2], ids[3]], [ids[4], ids[5], ids[6], ids[7]], [ids[0], ids[1], ids[5], ids[4]], [ids[1], ids[2], ids[6], ids[5]], [ids[2], ids[3], ids[7], ids[6]], [ids[3], ids[0], ids[4], ids[7]]];
  if (type === VTK_CELL_TYPE.WEDGE && ids.length >= 6) return [[ids[0], ids[1], ids[2]], [ids[3], ids[4], ids[5]], [ids[0], ids[1], ids[4], ids[3]], [ids[1], ids[2], ids[5], ids[4]], [ids[2], ids[0], ids[3], ids[5]]];
  if (type === VTK_CELL_TYPE.PYRAMID && ids.length >= 5) return [[ids[0], ids[1], ids[2], ids[3]], [ids[0], ids[1], ids[4]], [ids[1], ids[2], ids[4]], [ids[2], ids[3], ids[4]], [ids[3], ids[0], ids[4]]];
  if (type === VTK_CELL_TYPE.POLYHEDRON) {
    const faces = [];
    if (ids.length < 2) return faces;
    const faceCount = Math.trunc(ids[0]);
    let cursor = 1;
    for (let f = 0; f < faceCount; f += 1) {
      const n = Math.trunc(ids[cursor] ?? 0);
      cursor += 1;
      if (n < 3 || cursor + n > ids.length) break;
      faces.push(ids.slice(cursor, cursor + n));
      cursor += n;
    }
    return faces;
  }
  return ids.length >= 3 ? [ids] : [];
}

function triangulateFace(face) {
  const triangles = [];
  for (let i = 1; i < face.length - 1; i += 1) triangles.push([face[0], face[i], face[i + 1]]);
  return triangles;
}

function buildBoundaryPolys(cellConnectivity, offsets, types) {
  const faceMap = new Map();
  let start = 0;
  for (let cellId = 0; cellId < offsets.length; cellId += 1) {
    const end = offsets[cellId];
    const ids = cellConnectivity.slice(start, end);
    start = end;
    const cellType = types[cellId] ?? VTK_CELL_TYPE.POLYGON;
    const faces = getCellFaces(cellType, ids);
    faces.forEach((face) => {
      const key = [...face].sort((a, b) => a - b).join(",");
      const prev = faceMap.get(key);
      if (prev) prev.count += 1;
      else faceMap.set(key, { face, count: 1, cellId });
    });
  }

  const packedPolys = [];
  const ownerCellIds = [];
  faceMap.forEach((entry) => {
    if (entry.count !== 1) return;
    triangulateFace(entry.face).forEach((tri) => {
      packedPolys.push(3, tri[0], tri[1], tri[2]);
      ownerCellIds.push(entry.cellId);
    });
  });
  return {
    polys: new Uint32Array(packedPolys),
    ownerCellIds: new Uint32Array(ownerCellIds),
  };
}

function remapCellDataToBoundaryFaces(polydata, ownerCellIds, numCells) {
  if (!ownerCellIds?.length || !numCells) return;
  const cellData = polydata.getCellData?.();
  const arrays = cellData?.getArrays?.() ?? [];
  arrays.forEach((arr) => {
    const tuples = Number(arr?.getNumberOfTuples?.() ?? 0);
    const comps = Number(arr?.getNumberOfComponents?.() ?? 1);
    const src = arr?.getData?.();
    const name = String(arr?.getName?.() ?? "").trim();
    if (!name || !src || tuples !== numCells || comps < 1) return;
    const Ctor = src.constructor;
    const mapped = new Ctor(ownerCellIds.length * comps);
    for (let i = 0; i < ownerCellIds.length; i += 1) {
      const srcCell = Number(ownerCellIds[i] ?? 0);
      for (let c = 0; c < comps; c += 1) {
        mapped[i * comps + c] = src[srcCell * comps + c];
      }
    }
    const mappedArray = vtkDataArray.newInstance({
      name,
      numberOfComponents: comps,
      values: mapped,
    });
    cellData.removeArray?.(name);
    cellData.addArray?.(mappedArray);
  });
}

function vtkXMLUnstructuredGridReader(publicAPI, model) {
  model.classHierarchy.push("vtkXMLUnstructuredGridReader");
  publicAPI.parseXML = (rootElem, _type, compressor, byteOrder, headerType) => {
    const datasetElem = rootElem.getElementsByTagName(model.dataType)[0];
    const pieces = datasetElem ? datasetElem.getElementsByTagName("Piece") : [];
    for (let outputIndex = 0; outputIndex < pieces.length; outputIndex++) {
      const piece = pieces[outputIndex];
      const polydata = vtkPolyData.newInstance();
      let ownerCellIds = null;
      const numPoints = Number(piece.getAttribute("NumberOfPoints") || "0");
      const numCells = Number(piece.getAttribute("NumberOfCells") || "0");
      if (numPoints > 0) {
        const pointsArray = piece.getElementsByTagName("Points")[0]?.getElementsByTagName("DataArray")[0];
        const { values, numberOfComponents } = vtkXMLReader.processDataArray(
          numPoints,
          pointsArray,
          compressor,
          byteOrder,
          headerType,
          model.binaryBuffer
        );
        polydata.getPoints().setData(values, numberOfComponents);
      }

      if (numCells > 0) {
        const cellsElem = piece.getElementsByTagName("Cells")[0];
        const arrays = cellsElem?.getElementsByTagName("DataArray") ?? [];
        const byName = {};
        for (let i = 0; i < arrays.length; i += 1) byName[arrays[i].getAttribute("Name")] = arrays[i];
        const offsets = vtkXMLReader.processDataArray(
          numCells,
          byName.offsets,
          compressor,
          byteOrder,
          headerType,
          model.binaryBuffer
        ).values;
        const connectivitySize = offsets[offsets.length - 1] || 0;
        const connectivity = vtkXMLReader.processDataArray(
          connectivitySize,
          byName.connectivity,
          compressor,
          byteOrder,
          headerType,
          model.binaryBuffer
        ).values;
        const types = vtkXMLReader.processDataArray(
          numCells,
          byName.types,
          compressor,
          byteOrder,
          headerType,
          model.binaryBuffer
        ).values;
        const boundary = buildBoundaryPolys(
          Array.from(connectivity),
          Array.from(offsets),
          Array.from(types)
        );
        polydata.getPolys().setData(boundary.polys);
        ownerCellIds = boundary.ownerCellIds;
      }

      vtkXMLReader.processFieldData(
        numPoints,
        piece.getElementsByTagName("PointData")[0],
        polydata.getPointData(),
        compressor,
        byteOrder,
        headerType,
        model.binaryBuffer
      );
      vtkXMLReader.processFieldData(
        numCells,
        piece.getElementsByTagName("CellData")[0],
        polydata.getCellData(),
        compressor,
        byteOrder,
        headerType,
        model.binaryBuffer
      );
      remapCellDataToBoundaryFaces(polydata, ownerCellIds, numCells);

      model.output[outputIndex] = polydata;
    }
  };
}

const DEFAULT_VALUES = {
  dataType: "UnstructuredGrid",
};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  vtkXMLReader.extend(publicAPI, model, initialValues);
  vtkXMLUnstructuredGridReader(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, "vtkXMLUnstructuredGridReader");

export default { newInstance, extend };
