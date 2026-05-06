import { m as macro } from "@kitware/vtk.js/macros2.js";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData.js";

const { vtkErrorMacro } = macro;

/**
 * vtk.js bundle does not ship vtkDataSetSurfaceFilter. This shim matches the
 * public API used by VtuPreview: setInputData → update → getOutputData.
 * For vtkPolyData (including boundary meshes from the VTU reader), output is a shallow copy.
 */
function vtkDataSetSurfaceFilter(publicAPI, model) {
  model.classHierarchy.push("vtkDataSetSurfaceFilter");
  publicAPI.requestData = (inData, outData) => {
    const input = inData[0];
    if (!input) {
      vtkErrorMacro("vtkDataSetSurfaceFilter: missing input");
      return;
    }
    const output = outData[0]?.initialize() || vtkPolyData.newInstance();
    if (input.isA?.("vtkPolyData") || typeof input.getPolys === "function") {
      output.shallowCopy(input);
      outData[0] = output;
      return;
    }
    vtkErrorMacro("vtkDataSetSurfaceFilter: input must be vtkPolyData for this build");
    outData[0] = output;
  };
}

function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, {}, initialValues);
  macro.obj(publicAPI, model);
  macro.algo(publicAPI, model, 1, 1);
  vtkDataSetSurfaceFilter(publicAPI, model);
}

const newInstance = macro.newInstance(extend, "vtkDataSetSurfaceFilter");

export default { newInstance, extend };
export { newInstance, extend };
