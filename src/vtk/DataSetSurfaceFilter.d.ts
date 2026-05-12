type VtkDataSetSurfaceFilter = {
  setInputData: (data: unknown) => void;
  update: () => void;
  getOutputData: (port?: number) => unknown;
  delete?: () => void;
};

declare const vtkDataSetSurfaceFilter: {
  newInstance: () => VtkDataSetSurfaceFilter;
};

export default vtkDataSetSurfaceFilter;
