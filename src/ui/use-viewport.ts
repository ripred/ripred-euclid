import { useEffect, useState } from "react";

export interface ViewportSize {
  width: number;
  height: number;
}

function readViewport(): ViewportSize {
  const visual = window.visualViewport;
  return {
    width: Math.max(1, Math.floor(visual?.width ?? window.innerWidth)),
    height: Math.max(1, Math.floor(visual?.height ?? window.innerHeight)),
  };
}

/** The visible viewport, which on phones excludes the on-screen keyboard. */
export function useViewport(): ViewportSize {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const visual = window.visualViewport;
    const onResize = () => {
      const next = readViewport();
      setViewport((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    window.addEventListener("resize", onResize);
    visual?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      visual?.removeEventListener("resize", onResize);
    };
  }, []);
  return viewport;
}
