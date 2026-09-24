import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { LatticeScene, SceneModel, ViewName } from "./lattice-scene";
import { CubeMark } from "./CubeMark";

export function LatticeBoard({
  model,
  onSelect,
  decorative = false,
}: {
  model: SceneModel;
  onSelect: (index: number) => void;
  decorative?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<LatticeScene | null>(null);
  const selection = useRef(onSelect);
  const initial = useRef(model);
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState<ViewName>("isometric");
  const requestedView = useRef<ViewName>("isometric");
  selection.current = onSelect;
  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    // Inspector and controls remain usable while the independent 3D bundle loads.
    void import("./lattice-scene")
      .then(({ LatticeScene: Scene }) => {
        if (disposed || !host.current) return;
        scene.current = new Scene(
          host.current,
          initial.current,
          (index) => selection.current(index),
          setStatus,
          !decorative,
        );
        // A view chosen during the lazy download still applies when rendering becomes ready.
        scene.current.setView(requestedView.current);
      })
      .catch(() => {
        if (!disposed)
          setStatus(
            "3D rendering is unavailable in this browser. Every point is still playable in the layer inspector.",
          );
      });
    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [decorative]);
  initial.current = model;
  useEffect(() => {
    scene.current?.update(model);
  }, [model]);
  const changeView = (name: ViewName) => {
    requestedView.current = name;
    setView(name);
    scene.current?.setView(name);
  };
  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.repeat || event.target !== event.currentTarget) return;
    const rotations: Record<string, [number, number]> = {
      ArrowLeft: [-0.2, 0],
      ArrowRight: [0.2, 0],
      ArrowUp: [0, -0.2],
      ArrowDown: [0, 0.2],
    };
    const delta = rotations[event.key];
    if (delta) {
      event.preventDefault();
      scene.current?.rotate(...delta);
    } else if (event.key === "+" || event.key === "=") scene.current?.zoom(0.9);
    else if (event.key === "-") scene.current?.zoom(1.1);
    else if (event.key.toLowerCase() === "r") changeView("isometric");
  };
  return (
    <>
      <div
        className="lattice-stage"
        tabIndex={decorative ? undefined : 0}
        onKeyDown={decorative ? undefined : handleKeyboard}
        aria-label={
          decorative
            ? "Lattice board preview"
            : "3D view controls. Arrow keys rotate, plus and minus zoom, R resets."
        }
      >
        <div className="scene-host" ref={host} />
        <div className="axis-key" aria-hidden="true">
          <span>
            <i className="axis-x" />X
          </span>
          <span>
            <i className="axis-y" />Y
          </span>
          <span>
            <i className="axis-z" />Z ↑
          </span>
        </div>
        <div className="scene-note">
          {model.isolate
            ? `Only layer Z ${model.layer + 1}`
            : `Highlighted plane · Z ${model.layer + 1}`}
        </div>
        {!decorative && (
          <div className="zoom-controls">
            <button
              onClick={() => scene.current?.zoom(0.9)}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => scene.current?.zoom(1.1)}
              aria-label="Zoom out"
            >
              −
            </button>
          </div>
        )}
        {status && (
          <p className="render-status" role="status">
            {decorative ? "Open Lattice to explore the board." : status}
          </p>
        )}
      </div>
      {!decorative && (
        <div className="view-tools">
          <p>
            Drag to rotate <span>·</span> Scroll or pinch to zoom
          </p>
          <div className="view-buttons" aria-label="Camera views">
            <button
              className={view === "isometric" ? "active" : ""}
              onClick={() => changeView("isometric")}
            >
              <CubeMark small />
              Isometric
            </button>
            <button
              className={view === "front" ? "active" : ""}
              onClick={() => changeView("front")}
            >
              Front
            </button>
            <button
              className={view === "top" ? "active" : ""}
              onClick={() => changeView("top")}
            >
              Top
            </button>
            <button
              className={view === "side" ? "active" : ""}
              onClick={() => changeView("side")}
            >
              Side
            </button>
            <button
              onClick={() => changeView("isometric")}
              aria-label="Reset view"
            >
              ↺<span className="reset-label"> Reset view</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
