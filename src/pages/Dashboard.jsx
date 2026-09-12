import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuthContext } from "../context/AuthContext";

export default function Dashboard() {
  const { user, profile, signOut } = useAuthContext();
  const navigate = useNavigate();
  const [boards, setBoards] = useState(null);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("board_members")
      .select("last_visited_at, boards(id, name, owner_id, updated_at)")
      .eq("user_id", user.id)
      .order("last_visited_at", { ascending: false });
    if (!error) {
      setBoards((data || []).map((row) => row.boards).filter(Boolean));
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  const createBoard = async () => {
    setCreating(true);
    try {
      const { data: board, error } = await supabase
        .from("boards")
        .insert({ name: "Untitled board", owner_id: user.id })
        .select("*")
        .single();
      if (error) throw error;
      await supabase
        .from("board_members")
        .upsert({ board_id: board.id, user_id: user.id, last_visited_at: new Date().toISOString() });
      navigate(`/board/${board.id}`);
    } catch (err) {
      alert(err.message || "Could not create board.");
    } finally {
      setCreating(false);
    }
  };

  const startRename = (board) => {
    setRenamingId(board.id);
    setRenameValue(board.name);
  };

  const commitRename = async (board) => {
    const name = renameValue.trim() || "Untitled board";
    setRenamingId(null);
    if (name === board.name) return;
    setBoards((bs) => bs.map((b) => (b.id === board.id ? { ...b, name } : b)));
    await supabase.from("boards").update({ name }).eq("id", board.id);
  };

  const deleteBoard = async (board) => {
    if (!confirm(`Delete "${board.name}"? This can't be undone.`)) return;
    setBoards((bs) => bs.filter((b) => b.id !== board.id));
    await supabase.from("boards").delete().eq("id", board.id);
  };

  return (
    <div className="dash-page">
      <header className="dash-top">
        <div className="dash-title">
          <span className="auth-mark" />
          <span>Whiteboard</span>
        </div>
        <div className="dash-top-right">
          <span className="dash-me">{profile?.name}</span>
          <button className="wb-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-heading">
          <h1>My boards</h1>
          <button className="dash-new" onClick={createBoard} disabled={creating}>
            + New board
          </button>
        </div>

        {boards === null ? (
          <p className="dash-empty">Loading…</p>
        ) : boards.length === 0 ? (
          <div className="dash-empty">
            <p>You don&rsquo;t have any boards yet.</p>
            <p className="dash-empty-sub">
              Create one, or open a link someone shared with you — you&rsquo;ll join
              it automatically.
            </p>
          </div>
        ) : (
          <ul className="dash-grid">
            {boards.map((board) => (
              <li key={board.id} className="dash-card">
                <div
                  className="dash-card-open"
                  role="button"
                  tabIndex={0}
                  onClick={() => renamingId !== board.id && navigate(`/board/${board.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renamingId !== board.id) navigate(`/board/${board.id}`);
                  }}
                >
                  <span className="dash-card-thumb" />
                  {renamingId === board.id ? (
                    <input
                      className="dash-rename"
                      autoFocus
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(board)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span className="dash-card-name">{board.name}</span>
                  )}
                </div>
                {board.owner_id === user.id && (
                  <div className="dash-card-actions">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(board);
                      }}
                      title="Rename"
                    >
                      Rename
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteBoard(board);
                      }}
                      title="Delete"
                      className="dash-danger"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
