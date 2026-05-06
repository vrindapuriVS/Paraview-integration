import { useState, useEffect, useRef } from "react";

type StreamingTextProps = {
  text: string;
  delay?: number;
  mode?: "char" | "word" | "chunk";
  chunkSize?: number;
  onComplete?: () => void;
};

export default function StreamingText({
  text,
  delay = 0.02,
  mode = "word",
  chunkSize = 8,
  onComplete,
}: StreamingTextProps) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);
  const currentDisplayRef = useRef("");

  useEffect(() => {
    indexRef.current = 0;
    currentDisplayRef.current = "";
    setDisplayed("");
    
    const parts = text.split(/(<[^>]+>)/);

    const processPart = (partIndex: number) => {
      if (partIndex >= parts.length) {
        if (onComplete) onComplete();
        return;
      }

      const part = parts[partIndex];
      if (!part) {
        processPart(partIndex + 1);
        return;
      }

      if (part.startsWith("<") && part.endsWith(">")) {
        currentDisplayRef.current += part;
        setDisplayed(currentDisplayRef.current);
        processPart(partIndex + 1);
        return;
      }

      let units: string[] = [];
      if (mode === "char") {
        units = part.split("");
      } else if (mode === "word") {
        units = part.match(/\S+\s*|\s+/g) || [part];
      } else {
        units = [];
        for (let i = 0; i < part.length; i += chunkSize) {
          units.push(part.slice(i, i + chunkSize));
        }
      }

      let unitIndex = 0;
      const processUnit = () => {
        if (unitIndex < units.length) {
          currentDisplayRef.current += units[unitIndex];
          setDisplayed(currentDisplayRef.current);
          unitIndex++;
          setTimeout(processUnit, delay * 1000);
        } else {
          processPart(partIndex + 1);
        }
      };

      processUnit();
    };

    processPart(0);
  }, [text, delay, mode, chunkSize, onComplete]);

  return (
    <div className="streaming-text">
      <span dangerouslySetInnerHTML={{ __html: displayed }} />
      <span className="streaming-cursor">?</span>
    </div>
  );
}





