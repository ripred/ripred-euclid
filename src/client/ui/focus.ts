import type { KeyboardEvent } from "react";

/** Keeps Tab focus inside a modal surface. */
export function trapDialogTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "input:not(:disabled), button:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
    ),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const leavingStart = event.shiftKey && activeIndex <= 0;
  const leavingEnd = !event.shiftKey && activeIndex === focusable.length - 1;
  if (activeIndex === -1 || leavingStart || leavingEnd) {
    event.preventDefault();
    const target = event.shiftKey
      ? focusable[focusable.length - 1]
      : focusable[0];
    target?.focus();
  }
}
