import type { ReactNode } from "react";

import { trapDialogTab } from "./focus";

/**
 * Modal shell: scrim, focus containment and optional dismissal. Content and
 * actions belong to the caller.
 */
export function Dialog({
  labelledBy,
  describedBy,
  onDismiss,
  wide = false,
  className = "",
  children,
}: {
  labelledBy: string;
  describedBy?: string | undefined;
  onDismiss?: (() => void) | undefined;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="dialog-scrim" onClick={onDismiss}>
      <div
        className={`dialog${wide ? " dialog--wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onDismiss) {
            event.preventDefault();
            onDismiss();
            return;
          }
          trapDialogTab(event);
        }}
      >
        {children}
      </div>
    </div>
  );
}
