-- Collaborative Whiteboard — schema for Supabase (Postgres)
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user. Created client-side on first
-- sign-in (see src/hooks/useAuth.js). Holds the display name used for
-- attribution ("Added by ...") and a stable colour for cursors/avatars/votes.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  color text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- boards
-- ---------------------------------------------------------------------------
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled board',
  owner_id uuid not null references public.profiles (id) on delete cascade,
  show_votes boolean not null default true,
  vote_budget int not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists boards_owner_idx on public.boards (owner_id);

-- board_members: created (upserted) whenever a user opens a board, whether
-- they created it or joined via a shared link. Powers the "My boards"
-- dashboard and lets us attribute votes/objects without a per-id lookup.
create table if not exists public.board_members (
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_visited_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists board_members_user_idx on public.board_members (user_id);

-- board_objects: sticky notes, text boxes, shapes.
create table if not exists public.board_objects (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  type text not null check (type in ('sticky', 'text', 'rect', 'circle', 'arrow')),
  x double precision not null default 0,
  y double precision not null default 0,
  w double precision not null default 100,
  h double precision not null default 100,
  text text not null default '',
  color text,
  group_id text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists board_objects_board_idx on public.board_objects (board_id);
create index if not exists board_objects_created_by_idx on public.board_objects (created_by);

-- votes: one row per dot placed. A user can place more than one dot on the
-- same item, so there is deliberately no uniqueness constraint on
-- (object_id, user_id) — the per-user budget is enforced client-side and by
-- the trigger below.
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  object_id uuid not null references public.board_objects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists votes_board_idx on public.votes (board_id);
create index if not exists votes_object_idx on public.votes (object_id);
create index if not exists votes_user_idx on public.votes (user_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists boards_set_updated_at on public.boards;
create trigger boards_set_updated_at before update on public.boards
  for each row execute function public.set_updated_at();

drop trigger if exists board_objects_set_updated_at on public.board_objects;
create trigger board_objects_set_updated_at before update on public.board_objects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Enforce the per-user vote budget server-side too (defence in depth — the
-- client already stops you before sending the request).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_vote_budget()
returns trigger language plpgsql
set search_path = public
as $$
declare
  budget int;
  used int;
begin
  select vote_budget into budget from public.boards where id = new.board_id;
  select count(*) into used from public.votes
    where board_id = new.board_id and user_id = new.user_id;
  if used >= budget then
    raise exception 'vote budget exhausted';
  end if;
  return new;
end;
$$;

drop trigger if exists votes_enforce_budget on public.votes;
create trigger votes_enforce_budget before insert on public.votes
  for each row execute function public.enforce_vote_budget();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Access model (per requirements doc, section 6): any signed-in user may
-- join a board via its link and may edit/move/delete any object on it —
-- there is no per-object ownership. Board settings (rename, delete, the
-- vote-visibility toggle) are restricted to the board's creator.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.board_objects enable row level security;
alter table public.votes enable row level security;

create policy "profiles are readable by any signed-in user" on public.profiles
  for select to authenticated using (true);
create policy "users manage their own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "users update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid()));

create policy "boards are readable by any signed-in user" on public.boards
  for select to authenticated using (true);
create policy "signed-in users can create boards" on public.boards
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "only the owner can update board settings" on public.boards
  for update to authenticated using (owner_id = (select auth.uid()));
create policy "only the owner can delete a board" on public.boards
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "members are readable by any signed-in user" on public.board_members
  for select to authenticated using (true);
create policy "users can add themselves as a member" on public.board_members
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users can update their own membership" on public.board_members
  for update to authenticated using (user_id = (select auth.uid()));

create policy "objects are readable by any signed-in user" on public.board_objects
  for select to authenticated using (true);
create policy "any signed-in user can create objects" on public.board_objects
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "any signed-in user can edit any object" on public.board_objects
  for update to authenticated using (true);
create policy "any signed-in user can delete any object" on public.board_objects
  for delete to authenticated using (true);

create policy "votes are readable by any signed-in user" on public.votes
  for select to authenticated using (true);
create policy "users can cast their own votes" on public.votes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users can take back their own votes" on public.votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime: broadcast row changes on these tables to subscribed clients.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.boards;
alter publication supabase_realtime add table public.board_members;
alter publication supabase_realtime add table public.board_objects;
alter publication supabase_realtime add table public.votes;
