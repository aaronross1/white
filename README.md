# Whiteboard

A lightweight, Miro-style collaborative whiteboard: sticky notes, text, and
shapes on a shared pannable/zoomable canvas, with live cursors, live object
updates, creator attribution, group/ungroup, and budgeted dot-voting. Built
to the scope in [`docs/requirements.md`](docs/requirements.md), wiring up a
real Supabase backend behind the interaction model proven out in
[`docs/prototype-reference.jsx`](docs/prototype-reference.jsx).

## Stack

- **Frontend:** React + Vite (no build-heavy canvas library — the canvas is
  plain positioned `div`s with CSS transforms for pan/zoom, which is what the
  prototype already proved out for drag/resize/group/marquee-select).
- **Backend:** Supabase — Postgres for storage, Supabase Auth for magic-link
  sign-in, and Supabase Realtime for live object sync, presence, and cursor
  broadcast.
- **Routing:** react-router-dom (`/login`, `/` dashboard, `/board/:boardId`).

## Project layout

```
src/
  supabaseClient.js        Supabase client (reads VITE_SUPABASE_* env vars)
  hooks/
    useAuth.js              session + profile (name/colour) management
    useBoard.js              loads a board's objects/votes/members, subscribes
                             to realtime changes, exposes CRUD actions
    usePresence.js           who's online + live cursor broadcast (ephemeral,
                             not persisted)
  context/AuthContext.jsx   shares the single useAuth() instance app-wide
  pages/
    Login.jsx                magic-link sign-in
    Dashboard.jsx             "my boards": create / rename / delete
    Board.jsx                 thin wrapper that renders Whiteboard
  components/
    Whiteboard.jsx            the canvas: tools, selection, drag/resize,
                             grouping, voting, palette, cursors
    NoteEditor.jsx, Cursors.jsx, icons.jsx
  lib/
    colors.js                 sticky-note palette + deterministic per-user colour
    objectDefaults.js         default size/text per object type
supabase/schema.sql          full DB schema, RLS policies, realtime publication
```

## Setup

1. **Create a Supabase project** at supabase.com (free tier is enough for
   personal/small-team use).
2. **Run the schema:** open the SQL editor in your project and run the
   contents of `supabase/schema.sql`. This creates all tables, the
   `updated_at` triggers, a server-side vote-budget check, RLS policies, and
   adds the tables to the `supabase_realtime` publication.
3. **Enable email auth:** in Authentication → Providers, make sure Email is
   enabled. Magic link is Supabase's default email flow — no extra config
   needed for local dev (mail goes out via Supabase's built-in sender; for
   production you'll want to configure a custom SMTP provider under
   Authentication → SMTP Settings so links don't land in spam / hit rate
   limits).
4. **Copy env vars:**
   ```
   cp .env.example .env.local
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
   Project Settings → API.
5. **Install and run:**
   ```
   npm install
   npm run dev
   ```
6. Open the printed localhost URL, sign in with your email, and check that
   inbox for the magic link.

## How the pieces fit together

- **Auth:** `useAuth` upserts a `profiles` row (display name = email prefix,
  a colour hashed from the user id) the first time someone signs in. That
  profile powers "Added by ...", avatar initials, vote dots, and cursors.
- **Joining a board:** opening `/board/:id` upserts a `board_members` row.
  That's what makes "anyone with the link can join" work (per the
  requirements doc's access model) while still giving each user a
  "My boards" dashboard of everything they've created or visited.
- **Object sync:** `useBoard` loads the board's objects/votes once, then
  subscribes to Postgres change feeds (`postgres_changes`) on
  `board_objects`, `votes`, `boards`, and `board_members` scoped to that
  board id. Local edits apply optimistically to React state immediately;
  writes to Postgres for drags/resizes are debounced (~120ms) per object and
  flushed on pointer-up so dragging doesn't spam the database, while text
  edits, colour changes, grouping, and votes write straight through.
- **Live cursors & presence:** a separate Supabase Realtime channel per
  board uses **Presence** (who's currently connected — drives the avatar
  stack) and **Broadcast** (cursor x/y in world coordinates, throttled to
  ~25/s) — neither touches Postgres, since cursor position isn't data worth
  persisting.
- **Permissions:** per the requirements doc, any signed-in user can edit or
  delete any object — there's no per-object ownership. Board-level settings
  (rename, delete, and the vote-visibility toggle) are restricted to the
  board's creator, both in the UI and via RLS.
- **Concurrent edits:** last-write-wins, as scoped for the MVP — there's no
  operational-transform/CRDT merge. Two people dragging the same sticky at
  once will see it "settle" on whoever's update landed last.

## Scope notes / decisions made while building

The requirements doc left a few things as open questions; here's what this
build does and why:

- **Vote-visibility toggle:** restricted to the board creator (consistent
  with other board-level settings like rename/delete).
- **Canvas bounds:** effectively infinite — pan/zoom aren't clamped to a
  fixed world size.
- **Styling:** sticky notes pick from a fixed 6-colour palette; shapes can be
  recoloured or set to no-fill. Text is plain (no bold/rich text) for MVP.
- **Vote budget:** stored per-board (`boards.vote_budget`, defaults to 5)
  rather than hardcoded, so it's there if you want to expose a setting for
  it later without a schema change.

## Known limitations (matches "Out of scope" in the requirements doc)

No images or freehand drawing, no frames/containers, no undo/redo, no board
export, and no per-object locking. Designed for up to ~10 concurrent users
per board.
