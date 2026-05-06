declare module "@kitware/vtk.js/IO/XML/XMLUnstructuredGridReader" {
  type VtkReader = {
    parseAsArrayBuffer: (buffer: ArrayBuffer) => void;
    getOutputData: (index?: number) => any;
    delete?: () => void;
  };

  const vtkXMLUnstructuredGridReader: {
    newInstance: () => VtkReader;
  };

  export default vtkXMLUnstructuredGridReader;
}
