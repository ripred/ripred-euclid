import { Dialog } from "./Dialog";

/**
 * A yes/no question in the game's own dialog, in place of the browser's
 * unstyled confirm box. Cancel takes focus, so Enter never confirms by
 * accident.
 */
export function ConfirmDialog({
  id,
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep playing",
  onConfirm,
  onCancel,
}: {
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      labelledBy={`${id}-title`}
      describedBy={`${id}-body`}
      onDismiss={onCancel}
      className="confirm-dialog"
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-body`} className="muted">
        {body}
      </p>
      <div className="dialog__actions">
        <button type="button" className="btn btn--primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn" autoFocus onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </Dialog>
  );
}
