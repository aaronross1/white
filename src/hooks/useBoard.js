import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { DEFAULTS } from "../lib/objectDefaults";
import { STICKY_COLORS } from "../lib/colors";

function applyChange(list, payload) {
  if (payload.eventType === "INSERT") {
    if (list.some((x) => x.id === payload.new.id)) {
      return list.map((x) => (x.id === payload.new.id ? payload.new : x));
    }
    return [...list, payload.new];
  }
  if (payload.eventType === "UPDATE") {
    return list.map((x) => (x.id === payload.new.id ? payload.new : x));
  }
  if (payload.eventType === "DELETE") {
    return list.filter((x) => x.id !== payload.old.id);
  }
  return list;
}

const WRITE_DEBOUNCE_MS = 120;

/**
 * Loads a board's data, keeps it in sync via Supabase Realtime, and exposes
 * mutation helpers that write-through to Postgres. Local state updates are
 * applied optimistically so the UI feels instant; the debounced write-through
 * on `patchObject` keeps drag/resize from spamming the database while still
 * persisting the final position.
 */
export function useBoard(boardId, user) {
  const [board, setBoard] = useState(null);
  const [objects, setObjects] = useState([]);
  const [votes, setVotes] = useState([]);
  const [membersById, setMembersById] = useState({});
  const [status, setStatus] = useState("loading"); // loading | ready | not-found
  const [voteError, setVoteError] = useState(null); // { message, key } | null

  const colorTick = useRef(0);
  const pendingWrites = useRef({}); // objectId -> latest row to persist
  const writeTimers = useRef({}); // objectId -> timeout handle
  const pendingVoteInserts = useRef({}); // voteId -> in-flight insert promise
  const editingIdRef = useRef(null); // object currently open for local text editing, if any

  const setEditingId = useCallback((id) => {
    editingIdRef.current = id;
  }, []);

  /* ---------------- initial load + join ---------------- */
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      const { data: boardRow } = await supabase
        .from("boards")
        .select("*")
        .eq("id", boardId)
        .maybeSingle();
      if (cancelled) return;
      if (!boardRow) {
        setStatus("not-found");
        return;
      }
      setBoard(boardRow);

      await supabase.from("board_members").upsert({
        board_id: boardId,
        user_id: user.id,
        last_visited_at: new Date().toISOString(),
      });

      const [objRes, voteRes, memberRes] = await Promise.all([
        supabase.from("board_objects").select("*").eq("board_id", boardId),
        supabase.from("votes").select("*").eq("board_id", boardId),
        supabase
          .from("board_members")
          .select("user_id, profiles(id, name, color)")
          .eq("board_id", boardId),
      ]);
      if (cancelled) return;
      setObjects(objRes.data || []);
      setVotes(voteRes.data || []);
      const map = {};
      (memberRes.data || []).forEach((m) => {
        if (m.profiles) map[m.profiles.id] = m.profiles;
      });
      setMembersById(map);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, user.id]);

  /* ---------------- realtime subscriptions ---------------- */
  useEffect(() => {
    if (status !== "ready") return undefined;

    const channel = supabase
      .channel(`board-data-${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_objects", filter: `board_id=eq.${boardId}` },
        (payload) => {
          const id = payload.new?.id ?? payload.old?.id;
          // Ignore echoes for an object that's either (a) got a debounced
          // local write still in flight, or (b) open for local text editing
          // right now. (b) covers a narrow gap (a) can't: an echo for our
          // own just-flushed write can arrive in the brief window between
          // clearing the pending entry and the next keystroke repopulating
          // it, which — if the echo happened to be delivered out of order
          // relative to a still-in-flight later write — could reflect an
          // older keystroke than what's on screen. While a note is open for
          // editing there is only one writer (us), so it's safe to hold off
          // on every incoming change to it until editing ends and flushes.
          if (payload.eventType !== "DELETE" && (id in pendingWrites.current || id === editingIdRef.current)) {
            return;
          }
          setObjects((os) => applyChange(os, payload));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `board_id=eq.${boardId}` },
        (payload) => setVotes((vs) => applyChange(vs, payload))
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "boards", filter: `id=eq.${boardId}` },
        (payload) => setBoard(payload.new)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "board_members", filter: `board_id=eq.${boardId}` },
        async (payload) => {
          const uid = payload.new.user_id;
          setMembersById((m) => (m[uid] ? m : m));
          const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
          if (data) setMembersById((m) => ({ ...m, [data.id]: data }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [boardId, status]);

  /* ---------------- write-through helpers ---------------- */

  const scheduleWrite = useCallback((id, row) => {
    pendingWrites.current[id] = row;
    clearTimeout(writeTimers.current[id]);
    writeTimers.current[id] = setTimeout(() => flushObject(id), WRITE_DEBOUNCE_MS);
    // eslint-disable-next-line no-use-before-define
  }, []);

  const flushObject = useCallback(async (id) => {
    const row = pendingWrites.current[id];
    if (!row) return;
    delete pendingWrites.current[id];
    clearTimeout(writeTimers.current[id]);
    delete writeTimers.current[id];
    const { id: _id, board_id, created_by, created_at, ...patch } = row; // eslint-disable-line no-unused-vars
    await supabase.from("board_objects").update(patch).eq("id", id);
  }, []);

  const flushAll = useCallback(() => {
    Object.keys(pendingWrites.current).forEach((id) => flushObject(id));
  }, [flushObject]);

  /* ---------------- object mutations ---------------- */

  const createObject = useCallback(
    (type, world, createdBy) => {
      const d = DEFAULTS[type];
      const now = new Date().toISOString();
      const obj = {
        id: crypto.randomUUID(),
        board_id: boardId,
        type,
        x: Math.round(world.x - d.w / 2),
        y: Math.round(world.y - d.h / 2),
        w: d.w,
        h: d.h,
        text: d.text,
        color: type === "sticky" ? STICKY_COLORS[colorTick.current++ % STICKY_COLORS.length] : null,
        group_id: null,
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      };
      setObjects((os) => [...os, obj]);
      supabase
        .from("board_objects")
        .insert({
          id: obj.id,
          board_id: obj.board_id,
          type: obj.type,
          x: obj.x,
          y: obj.y,
          w: obj.w,
          h: obj.h,
          text: obj.text,
          color: obj.color,
          group_id: obj.group_id,
          created_by: obj.created_by,
        })
        .then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("Failed to create object", error);
            setObjects((os) => os.filter((o) => o.id !== obj.id));
          }
        });
      return obj;
    },
    [boardId]
  );

  // Local-only, debounced-write update (position/size while dragging).
  const patchObject = useCallback(
    (id, patch) => {
      setObjects((os) =>
        os.map((o) => {
          if (o.id !== id) return o;
          const next = { ...o, ...patch };
          scheduleWrite(id, next);
          return next;
        })
      );
    },
    [scheduleWrite]
  );

  // Local update that writes through immediately (text edits, color, group).
  const patchObjectNow = useCallback((id, patch) => {
    setObjects((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    supabase.from("board_objects").update(patch).eq("id", id);
  }, []);

  const patchObjectsNow = useCallback((ids, patch) => {
    setObjects((os) => os.map((o) => (ids.includes(o.id) ? { ...o, ...patch } : o)));
    supabase.from("board_objects").update(patch).in("id", ids);
  }, []);

  const deleteObjects = useCallback((ids) => {
    ids.forEach((id) => {
      delete pendingWrites.current[id];
      clearTimeout(writeTimers.current[id]);
    });
    setObjects((os) => os.filter((o) => !ids.includes(o.id)));
    setVotes((vs) => vs.filter((v) => !ids.includes(v.object_id)));
    supabase.from("board_objects").delete().in("id", ids);
  }, []);

  const group = useCallback(
    (ids) => {
      const gid = crypto.randomUUID();
      patchObjectsNow(ids, { group_id: gid });
    },
    [patchObjectsNow]
  );

  const ungroup = useCallback(
    (ids) => {
      patchObjectsNow(ids, { group_id: null });
    },
    [patchObjectsNow]
  );

  /* ---------------- votes ---------------- */

  const myVotes = useMemo(() => votes.filter((v) => v.user_id === user.id), [votes, user.id]);

  // Pulls the real vote rows from the server and replaces local state with
  // them. Used to self-heal if a vote write is ever rejected unexpectedly,
  // so a one-off desync can't permanently wedge the budget count.
  const resyncVotes = useCallback(async () => {
    const { data } = await supabase.from("votes").select("*").eq("board_id", boardId);
    if (data) setVotes(data);
  }, [boardId]);

  const castVote = useCallback(
    (objectId) => {
      const budget = board?.vote_budget ?? 5;
      if (myVotes.length >= budget) return false;
      // The id is generated client-side (rather than left to the DB default)
      // so it's identical here and in the realtime echo of our own insert —
      // otherwise a fast echo can land before this insert resolves and the
      // vote gets counted twice until they're reconciled.
      const id = crypto.randomUUID();
      const row = { id, board_id: boardId, object_id: objectId, user_id: user.id };
      setVotes((vs) => [...vs, row]);
      const insertPromise = supabase
        .from("votes")
        .insert(row)
        .then(({ error }) => {
          if (error) {
            setVotes((vs) => vs.filter((v) => v.id !== id));
            setVoteError({ message: "Couldn't cast that vote — try again.", key: crypto.randomUUID() });
            // The budget trigger only rejects this if the server thinks we're
            // already at the limit — which means our local count has drifted
            // from the truth (e.g. an earlier remove-vote didn't actually
            // land). Pull the real rows so the next attempt isn't blocked too.
            resyncVotes();
          }
        });
      pendingVoteInserts.current[id] = insertPromise;
      insertPromise.finally(() => {
        delete pendingVoteInserts.current[id];
      });
      return true;
    },
    [board?.vote_budget, myVotes.length, boardId, user.id, resyncVotes]
  );

  const removeVote = useCallback(
    async (objectId) => {
      const mine = votes.filter((v) => v.object_id === objectId && v.user_id === user.id);
      const last = mine[mine.length - 1];
      if (!last) return;
      setVotes((vs) => vs.filter((v) => v.id !== last.id));
      // If this exact vote's insert hasn't been confirmed by the server yet,
      // wait for it first. Two independent HTTP requests (the insert, then
      // this delete) have no guaranteed ordering, so firing the delete
      // immediately can have it reach the server before the insert does —
      // the delete then matches nothing, and the insert lands moments later
      // as a permanent "ghost" row that silently eats into the vote budget.
      const pendingInsert = pendingVoteInserts.current[last.id];
      if (pendingInsert) await pendingInsert;
      const { error } = await supabase.from("votes").delete().eq("id", last.id);
      if (error) {
        setVotes((vs) => (vs.some((v) => v.id === last.id) ? vs : [...vs, last]));
        setVoteError({ message: "Couldn't remove that vote — try again.", key: crypto.randomUUID() });
      }
    },
    [votes, user.id]
  );

  /* ---------------- board settings ---------------- */

  const setShowVotes = useCallback(
    (show) => {
      setBoard((b) => (b ? { ...b, show_votes: show } : b));
      supabase.from("boards").update({ show_votes: show }).eq("id", boardId);
    },
    [boardId]
  );

  const renameBoard = useCallback(
    (name) => {
      setBoard((b) => (b ? { ...b, name } : b));
      supabase.from("boards").update({ name }).eq("id", boardId);
    },
    [boardId]
  );

  return {
    status,
    board,
    objects,
    votes,
    myVotes,
    membersById,
    createObject,
    patchObject,
    patchObjectNow,
    patchObjectsNow,
    flushObject,
    flushAll,
    deleteObjects,
    group,
    ungroup,
    castVote,
    removeVote,
    voteError,
    setShowVotes,
    renameBoard,
    setEditingId,
  };
}
