import { requestExpandedMode } from "@devvit/web/client";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import "./inline-preview.css";

/** A passive post surface. Session providers and game controls belong to the game entry. */
export function InlinePreview({
  title,
  subtitle,
  children,
  className = "",
  aspectRatio = 1,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  className?: string;
  aspectRatio?: number;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const fit = () => {
      const width = Math.min(
        element.clientWidth,
        element.clientHeight * aspectRatio,
      );
      setSize({ width, height: width / aspectRatio });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [aspectRatio]);

  async function open(event: MouseEvent<HTMLButtonElement>) {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError(false);
    try {
      // Preserve the activation event so the host can authorize expansion.
      await requestExpandedMode(event.nativeEvent, "game");
    } catch {
      setError(true);
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  return (
    <main className={`inline-preview ${className}`}>
      <header className="inline-preview__heading">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>
      <div
        className="inline-preview__stage"
        ref={stage}
        role="img"
        aria-label={`${title} game preview`}
      >
        <div
          className="inline-preview__artwork"
          style={size}
          aria-hidden="true"
          inert
        >
          {children}
        </div>
      </div>
      <footer className="inline-preview__footer">
        <button
          type="button"
          onClick={(event) => void open(event)}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Opening…" : `Open ${title}`}
        </button>
        <p role="status">
          {error
            ? "Couldn’t open the game. Try again."
            : "A Euclid game · Tap to play"}
        </p>
      </footer>
    </main>
  );
}
