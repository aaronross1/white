// Two marker strokes converging on a whiteboard — a small, single-colour
// line-art mark standing in for real-time collaboration. Uses currentColor
// so it inherits whatever ink colour it's placed in (works in both themes).
export default function Logo({ size = 22, className }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="6" width="24" height="19" rx="2.4" />
      <path d="M9 21L14 10" />
      <circle cx="14" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <path d="M23 21L18 10" />
      <circle cx="18" cy="10" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
