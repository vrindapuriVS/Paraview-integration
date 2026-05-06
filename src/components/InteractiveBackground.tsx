import { useEffect, useRef, useState } from "react";

export default function InteractiveBackground() {
  const backgroundRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      setMousePos({ x, y });
      setIsHovering(true);
    };

    const handleMouseLeave = () => {
      setIsHovering(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const x = (e.touches[0].clientX / window.innerWidth) * 100;
        const y = (e.touches[0].clientY / window.innerHeight) * 100;
        setMousePos({ x, y });
        setIsHovering(true);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("touchmove", handleTouchMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  return (
    <div className="interactive-background" ref={backgroundRef}>
      <div className="fluid-vortex vortex-1" />
      <div className="fluid-vortex vortex-2" />
      <div className="fluid-vortex vortex-3" />
      <div
        className={`fluid-blob blob-1 ${isHovering ? 'active' : ''}`}
        style={{
          left: `${mousePos.x * 1.3 - 15}%`,
          top: `${mousePos.y * 1.3 - 15}%`,
        }}
      />
      <div
        className={`fluid-blob blob-2 ${isHovering ? 'active' : ''}`}
        style={{
          left: `${100 - mousePos.x * 1.2 + 25}%`,
          top: `${100 - mousePos.y * 1.2 + 25}%`,
        }}
      />
      <div
        className={`fluid-blob blob-3 ${isHovering ? 'active' : ''}`}
        style={{
          left: `${mousePos.x * 1.1 + 20}%`,
          top: `${100 - mousePos.y * 1.1 + 20}%`,
        }}
      />
      <div
        className={`fluid-blob blob-4 ${isHovering ? 'active' : ''}`}
        style={{
          left: `${100 - mousePos.x * 1.15 - 20}%`,
          top: `${mousePos.y * 1.15 - 20}%`,
        }}
      />
      <div className="gradient-overlay" />
    </div>
  );
}

