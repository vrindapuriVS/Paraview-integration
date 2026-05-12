type VtkReader = {
  parseAsArrayBuffer: (buffer: ArrayBuffer) => void;
  getOutputData: (index?: number) => any;
  delete?: () => void;
};

declare const vtkXMLUnstructuredGridReader: {
  newInstance: () => VtkReader;
};

export default vtkXMLUnstructuredGridReader;
