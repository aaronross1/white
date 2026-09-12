export default function Cursors({ cursors }) {
  return (
    <>
      {Object.entries(cursors).map(([userId, c]) => (
        <div key={userId} className="wb-cursor" style={{ left: c.x, top: c.y, color: c.color }}>
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              d="M4 2l6.5 17 2-7 7-2z"
              fill="currentColor"
              stroke="var(--surface)"
              strokeWidth="1"
            />
          </svg>
          <span className="wb-cursor-label" style={{ background: c.color }}>
            {c.name}
          </span>
        </div>
      ))}
    </>
  );
}
