import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

const CURSOR_THROTTLE_MS = 40;

/**
 * Ephemeral, non-persisted realtime state for a board: who's currently
 * looking at it (Presence) and where their cursors are (Broadcast). Neither
 * of these touch Postgres — they only matter while someone is connected.
 */
export function usePresence(boardId, profile) {
  const [onlineIds, setOnlineIds] = useState([]);
  const [cursors, setCursors] = useState({}); // userId -> { x, y, name, color }
  const channelRef = useRef(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!profile) return undefined;

    const channel = supabase.channel(`presence-${boardId}`, {
      config: { presence: { key: profile.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineIds(Object.keys(state));
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        setCursors((c) => {
          if (!(key in c)) return c;
          const next = { ...c };
          delete next[key];
          return next;
        });
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        if (payload.userId === profile.id) return;
        setCursors((c) => ({
          ...c,
          [payload.userId]: {
            x: payload.x,
            y: payload.y,
            name: payload.name,
            color: payload.color,
          },
        }));
      })
      .subscribe(async (subStatus) => {
        if (subStatus === "SUBSCRIBED") {
          await channel.track({
            user_id: profile.id,
            name: profile.name,
            color: profile.color,
          });
        }
      });

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [boardId, profile?.id, profile?.name, profile?.color]);

  const sendCursor = useCallback(
    (world) => {
      const channel = channelRef.current;
      if (!channel || !profile) return;
      const now = Date.now();
      if (now - lastSentRef.current < CURSOR_THROTTLE_MS) return;
      lastSentRef.current = now;
      channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId: profile.id, name: profile.name, color: profile.color, x: world.x, y: world.y },
      });
    },
    [profile]
  );

  return { onlineIds, cursors, sendCursor };
}
