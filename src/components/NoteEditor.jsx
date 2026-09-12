import { useEffect, useRef } from "react";

// Focus is taken explicitly on the next frame rather than via autoFocus: the
// element mounts inside a transformed layer mid-pointer-event, and autoFocus
// loses the race against the browser's own focus handling.
export default function NoteEditor({ value, onChange, onDone }) {
  const ref = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <textarea
      ref={ref}
      className="wb-edit"
      value={value}
      placeholder="Type here"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keep Backspace, "n", "v" etc. from reaching the board shortcuts.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
      }}
    />
  );
}
