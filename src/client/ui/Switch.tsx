/** An on/off setting; a hint line makes the label a bold title above it. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        {hint ? <strong>{label}</strong> : label}
        {hint && <span className="field__hint">{hint}</span>}
      </span>
    </label>
  );
}
