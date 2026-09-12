// Sticky-note fill colours a user can pick from.
export const STICKY_COLORS = [
  "#FFE27A",
  "#A8DCC0",
  "#F7B7C2",
  "#A9C8F0",
  "#E2C9F0",
  "#F5CDA0",
];

// Stable per-user colours for cursors, avatars and vote dots. Assigned
// deterministically from the user's id so it stays the same across
// sessions/devices without needing a lookup.
const USER_PALETTE = [
  "#2F6FED",
  "#128A6E",
  "#B5387A",
  "#D97706",
  "#7C3AED",
  "#DB2777",
  "#0EA5A5",
  "#DC2626",
];

export function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return USER_PALETTE[Math.abs(hash) % USER_PALETTE.length];
}
