import { forwardRef } from "react";

import { Icon } from "./ui/Icon";

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
      className="icon-btn euclid-chat-trigger"
      aria-haspopup="dialog"
      aria-controls="euclid-game-chat-dialog"
      aria-label="Open game chat"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="chat" size={18} />
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
      className="btn btn--blue euclid-rematch-button"
      disabled={disabled}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? "Starting rematch…" : "Rematch"}
    </button>
  );
}
