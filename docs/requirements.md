# Collaborative Whiteboard App — Requirements Doc (v0.2)

## 1. Purpose
A lightweight, Miro-style interactive whiteboard where teams can brainstorm, organize ideas, and align on a shared goal in real time.

## 2. Core User Stories
- As a user, I can create a board and add content (sticky notes, text boxes, basic shapes).
- As a user, I can move, resize, and multi-select/group items on the canvas.
- As a user, I can see who created each item (creator tag/name).
- As a user, I can edit or move any item on the board, regardless of who created it.
- As a user, I can dot-vote on items, drawing from a limited vote budget.
- As a facilitator, I can toggle whether vote counts are visible to everyone or hidden.
- As a user, I can see other users' live cursors and see updates as they happen.
- As a user, I can sign in via email magic link and share a board via link.

## 3. Core Features (MVP)
| Feature | Description |
|---|---|
| Canvas | Pannable/zoomable 2D canvas (bounded vs. infinite — **TBD**, see open questions) |
| Objects | Sticky notes, text boxes, basic shapes (rectangle, circle, arrow/line) |
| Grouping | Multi-select, group/ungroup (no frames/containers for MVP) |
| Attribution | Each object tagged with creator name |
| Permissions | Any signed-in user can move/edit/delete any object (no per-object locking for MVP) |
| Voting | Dot-voting on items; each user has a limited vote budget (e.g. 5 votes) to distribute |
| Vote visibility | Setting, toggleable per board: default **visible live**, with a hide/reveal control |
| Collaboration | Multiple users on the same board simultaneously, live cursors, live object updates |
| Auth | Email magic link |
| Persistence | Boards and objects save automatically; boards can be reopened later |

## 4. Non-Functional Requirements
- Real-time sync latency should feel instant (<300ms typical).
- Should work in-browser, no install.
- Target up to ~10 concurrent users per board for MVP (not designed for larger scale).
- Concurrent edits to the same object: last-write-wins for MVP (no conflict merging).

## 5. Out of Scope (for MVP)
- Images, freehand drawing
- Frames/containers/lanes (grouping is multi-select only)
- Standalone poll objects (voting is dot-voting on existing items only)
- Undo/redo
- Video/audio calls
- Advanced diagramming (flowcharts with smart connectors)
- Per-object permissions / locking / enterprise admin controls
- Board export (image/PDF)
- Mobile native apps (responsive web only)

## 6. Confirmed Scope Decisions
- **Real-time model:** True live multiplayer — live cursors, live object updates across users.
- **Scale/context:** Personal project / small team; few boards, few concurrent users.
- **Accounts/backend:** Needs user accounts and a persistent backend/database.
- **Voting:** Dot-voting on existing items, with a per-user vote budget (not unlimited, not single-vote-per-item).
- **Vote visibility:** Defaults to live/visible; toggleable to hidden via a show/hide control (open question: who can toggle it — see below).
- **Grouping:** Simple multi-select group/ungroup only — no frames/containers.
- **Access:** Anyone with the board link can join (no invite gating); still requires a lightweight account so creator tags work.
- **Object permissions:** Any signed-in user can edit/move/delete any object on the board — no ownership restrictions.
- **Object types (v1):** Sticky notes, text boxes, basic shapes only.
- **Auth method:** Email magic link.

## 7. Proposed Tech Approach
- **Frontend:** Single-page app (React), canvas rendered with Konva.js for pan/zoom/drag/group.
- **Realtime sync:** Supabase Realtime (Postgres change feeds/broadcast) for live cursors + object updates.
- **Backend/DB:** Supabase Postgres for boards, objects, users, votes — persisted so boards survive reloads/restarts.
- **Auth:** Supabase Auth, email magic link.

## 8. Hosting/Infra Recommendation
Simplest path: **Supabase** — bundles Postgres, Realtime, and Auth (magic link) in one managed service, avoiding separate DB/auth/WebSocket servers. Has a generous free tier — good fit for a personal/small-team project.

## 9. Remaining Open Questions
- **Canvas bounds:** infinite scroll, or a fixed large bounded canvas?
- **Vote-visibility control:** should any user be able to toggle hide/reveal, or only the board creator?
- **Styling:** any sticky note color choices? Plain text only, or basic rich text (bold/size)?
- **Board management:** is there a "my boards" dashboard? Can boards be renamed or deleted?

## 10. Next Steps
1. Scaffold the frontend canvas (board view, sticky notes/text/shapes, pan/zoom).
2. Set up Supabase project: tables for boards, objects, users, votes.
3. Wire up realtime sync for object CRUD + live cursors.
4. Add creator tagging (pull from auth user on each object).
5. Add multi-select group/ungroup.
6. Add dot-voting with per-user vote budget and visibility toggle.
