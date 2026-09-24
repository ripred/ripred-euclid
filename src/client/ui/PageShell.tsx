import type { HTMLAttributes, ReactNode } from "react";

import { BoardMacro, BrandMark } from "./Brand";
import { Icon } from "./Icon";

export interface PageBackAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}

/**
 * The frame every secondary screen shares: board close-up, back action,
 * title, then content. Screens own their content and actions.
 */
export function PageShell({
  title,
  titleId,
  back,
  narrow = true,
  className = "",
  children,
  ...rest
}: {
  title: ReactNode;
  titleId: string;
  back?: PageBackAction | undefined;
  narrow?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <main
      className={`screen page-shell ${className}`}
      aria-labelledby={titleId}
      {...rest}
    >
      <BoardMacro className="page-shell__art" />
      <div className={`page${narrow ? " page--narrow" : ""}`}>
        <header className="page-header">
          {back ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={back.onClick}
              disabled={back.disabled}
              aria-busy={back.busy || undefined}
            >
              <Icon name="back" size={18} />
              {back.label}
            </button>
          ) : (
            <BrandMark size={34} />
          )}
          <h1 id={titleId}>{title}</h1>
        </header>
        {children}
      </div>
    </main>
  );
}
