declare module "@kitware/vtk.js/Filters/Geometry/DataSetSurfaceFilter" {
  type VtkDataSetSurfaceFilter = {
    setInputData: (data: unknown) => void;
    update: () => void;
    getOutputData: (port?: number) => unknown;
    delete?: () => void;
  };

  const vtkDataSetSurfaceFilter: {
    newInstance: () => VtkDataSetSurfaceFilter;
  };

  export default vtkDataSetSurfaceFilter;
}
