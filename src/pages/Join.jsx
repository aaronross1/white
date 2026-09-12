import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuthContext } from "../context/AuthContext";

// Landing point for a board's share link. Distinct from /board/:id (used for
// opening a board you're already in from the dashboard) so that following a
// shared link always joins you to that one board and drops you on your own
// dashboard — never straight into someone else's canvas, and never exposing
// anything beyond the board the link was for.
export default function Join() {
  const { boardId } = useParams();
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [notFound, setNotFound] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let cancelled = false;
    (async () => {
      const { data: board } = await supabase
        .from("boards")
        .select("id")
        .eq("id", boardId)
        .maybeSingle();
      if (cancelled) return;
      if (!board) {
        setNotFound(true);
        return;
      }
      await supabase.from("board_members").upsert({
        board_id: boardId,
        user_id: user.id,
        last_visited_at: new Date().toISOString(),
      });
      if (!cancelled) navigate("/", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, user.id, navigate]);

  if (notFound) {
    return (
      <div className="board-error">
        <p>This board link doesn&rsquo;t exist, or the board was deleted.</p>
        <button className="wb-btn" onClick={() => navigate("/")}>
          Back to my boards
        </button>
      </div>
    );
  }

  return <div className="board-loading">Joining board…</div>;
}
