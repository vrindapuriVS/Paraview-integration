declare module "@kitware/vtk.js/Rendering/Core/PointPicker.js" {
  const vtkPointPicker: {
    newInstance: () => any;
  };
  export default vtkPointPicker;
}

declare module "@kitware/vtk.js/Rendering/Core/CellPicker.js" {
  const vtkCellPicker: {
    newInstance: () => any;
  };
  export default vtkCellPicker;
}
