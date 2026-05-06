import { useState, useRef } from "react";

type FileUploadProps = {
  onFileChange: (file: File | null) => void;
  disabled: boolean;
};

export default function FileUpload({ onFileChange, disabled }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragOver(false);
  };

  const ALLOWED_EXTENSIONS = [".tar.gz", ".tgz", ".zip", ".tar", ".gz", ".stl", ".msh", ".foam", ".vtk", ".vtu", ".pvd"];
  const MAX_SIZE_MB = 100;

  const isValidFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".stl") || name.endsWith(".msh") || name.endsWith(".foam") || name.endsWith(".vtk") || name.endsWith(".vtu") || name.endsWith(".pvd")) return true;
    return ALLOWED_EXTENSIONS.filter((e) => ![".stl", ".msh", ".foam", ".vtk", ".vtu", ".pvd"].includes(e)).some((ext) => name.endsWith(ext));
  };

  const handleFile = (file: File | null) => {
    if (!file) {
      onFileChange(null);
      return;
    }
    if (!isValidFile(file)) {
      alert(
        `File type not allowed. Upload .stl / .vtk / .vtu / .pvd / .msh / .foam (mesh), or .tar.gz / .zip / .tgz (OpenFOAM case, max ${MAX_SIZE_MB}MB).`
      );
      onFileChange(null);
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`File too large. Maximum size is ${MAX_SIZE_MB}MB.`);
      onFileChange(null);
      return;
    }
    onFileChange(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    if (input.files && input.files.length > 0) {
      handleFile(input.files[0]);
    } else {
      onFileChange(null);
    }
    input.value = "";
  };

  const triggerFileInput = () => {
    if (fileInputRef.current && !disabled) {
      fileInputRef.current.click();
    }
  };

  return (
    <div
      className={`file-upload-btn ${isDragOver ? "drag-over" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={triggerFileInput}
      title={`Attach .stl, .vtk, .vtu, .pvd, .msh, .foam or OpenFOAM archive (${ALLOWED_EXTENSIONS.join(", ")}, max ${MAX_SIZE_MB}MB)`}
      aria-disabled={disabled}
    >
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileSelect}
        accept=".stl,.STL,.vtk,.VTK,.vtu,.VTU,.pvd,.PVD,.msh,.MSH,.foam,.FOAM,.tar.gz,.tgz,.zip,.tar,.gz"
        disabled={disabled}
      />
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

