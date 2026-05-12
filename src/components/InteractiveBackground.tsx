import { useEffect, useRef, useState } from "react";

type InteractiveBackgroundProps = {
  interactive?: boolean;
};

export default function InteractiveBackground({
  interactive = true,
}: InteractiveBackgroundProps) {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovering, setIsHovering] = useState(false);
  const pendingMousePosRef = useRef({ x: 50, y: 50 });
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!interactive) {
      setIsHovering(false);
      return;
    }

    const flushPointerState = () => {
      frameRef.current = null;
      setMousePos(pendingMousePosRef.current);
      setIsHovering(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingMousePosRef.current = {
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      };
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(flushPointerState);
      }
    };

    const handleMouseLeave = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setIsHovering(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        pendingMousePosRef.current = {
          x: (e.touches[0].clientX / window.innerWidth) * 100,
          y: (e.touches[0].clientY / window.innerHeight) * 100,
        };
        if (frameRef.current === null) {
          frameRef.current = window.requestAnimationFrame(flushPointerState);
        }
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [interactive]);

  return (
    <div
      className={`interactive-background ${
        interactive ? "" : "interactive-background--static"
      }`}
    >
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

