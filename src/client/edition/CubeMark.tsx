export function CubeMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 18 : 28}
      height={small ? 18 : 28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" />
    </svg>
  );
}
