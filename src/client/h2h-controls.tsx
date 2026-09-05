import { forwardRef } from "react";

export const H2HChatTrigger = forwardRef<
  HTMLButtonElement,
  {
    disabled?: boolean;
    onClick: () => void;
  }
>(function H2HChatTrigger({ disabled = false, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="euclid-chat-trigger"
      aria-haspopup="dialog"
      aria-controls="euclid-game-chat-dialog"
      aria-label="Open game chat"
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">💬</span>
      <span>Chat</span>
    </button>
  );
});

export function H2HRematchButton({
  disabled = false,
  pending = false,
  onClick,
}: {
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="euclid-rematch-button rounded cursor-pointer"
      disabled={disabled}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? "Starting rematch…" : "Rematch"}
    </button>
  );
}
