import { useState, useRef, useEffect } from "react";
import FileUpload from "./FileUpload";

type ChatInputProps = {
  onSend: (text: string, file?: File | null) => void;
  disabled: boolean;
};

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const minLines = 2;
  const maxLines = 8;

  const resizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";

    const computed = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(computed.lineHeight) || 20;
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const paddingBottom = parseFloat(computed.paddingBottom) || 0;
    const borderTop = parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
    const extraHeight = paddingTop + paddingBottom + borderTop + borderBottom;
    const minHeight = lineHeight * minLines + extraHeight;
    const maxHeight = lineHeight * maxLines + extraHeight;
    const isEmpty = textarea.value.length === 0;
    const nextHeight = isEmpty
      ? minHeight
      : Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  const submit = () => {
    if (!value.trim() && !selectedFile) return;
    onSend(value, selectedFile);
    setValue("");
    setSelectedFile(null);
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
    resizeTextarea();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    resizeTextarea();
  }, [value]);

  useEffect(() => {
    resizeTextarea();
  }, []);

  const handleFileChange = (file: File | null) => {
    if (file && !disabled) {
      // ParaView-like behavior: selecting a dataset should immediately start loading.
      onSend(value, file);
      setValue("");
      setSelectedFile(null);
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
      resizeTextarea();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    setSelectedFile(file);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="chat-input-wrapper">
      {selectedFile && (
        <div className="file-preview-bar">
          <div className="file-preview-content">
            <svg className="file-preview-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <path d="M12 18v-6M9 15l3-3 3 3"/>
            </svg>
            <span className="file-preview-name">{selectedFile.name}</span>
          </div>
          <button className="file-remove-btn-small" onClick={handleRemoveFile} disabled={disabled} aria-label="Remove file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}
      <div className="chat-input">
        <FileUpload onFileChange={handleFileChange} disabled={disabled} />
        <textarea
          ref={textareaRef}
          placeholder="Which simulation would you like me to run?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          rows={1}
        />
        <button 
          className="send-btn" 
          onClick={submit} 
          disabled={disabled || (!value.trim() && !selectedFile)}
          aria-label="Send message"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4 L10 16 M6 10 L10 6 L14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </button>
      </div>
      <div className="chat-input-footer">
        Press Ctrl + Enter to send, Shift + Enter for new line · Upload .stl / .msh / .foam or .tar.gz / .zip (max 100MB)
      </div>
    </div>
  );
}
