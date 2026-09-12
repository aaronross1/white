import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/whiteboard.css";
import { useAuthContext } from "../context/AuthContext";
import { useBoard } from "../hooks/useBoard";
import { usePresence } from "../hooks/usePresence";
import { STICKY_COLORS } from "../lib/colors";
import { COLORABLE, EDITABLE } from "../lib/objectDefaults";
import NoteEditor from "./NoteEditor";
import Cursors from "./Cursors";
import {
  IconArrow,
  IconBack,
  IconCircle,
  IconCursor,
  IconGroup,
  IconHand,
  IconMoon,
  IconRect,
  IconSticky,
  IconSun,
  IconText,
  IconTrash,
  IconUngroup,
  IconVote,
} from "./icons";

const THEME_KEY = "whiteboard:theme";

export default function Whiteboard({ boardId }) {
  const { user, profile } = useAuthContext();
  const navigate = useNavigate();
  const board = useBoard(boardId, user);
  const { onlineIds, cursors, sendCursor } = usePresence(boardId, profile);

  const [sel, setSel] = useState([]);
  const [tool, setTool] = useState("select");
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [editing, setEditing] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [hint, setHint] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [boardNameDraft, setBoardNameDraft] = useState("");

  const surfaceRef = useRef(null);
  const drag = useRef(null);
  const lastClick = useRef(null);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const boardRef = useRef(board);
  boardRef.current = board;
  useEffect(() => () => boardRef.current.flushAll(), []);

  const { objects, votes, myVotes, membersById } = board;
  const voteBudget = board.board?.vote_budget ?? 5;
  const votesLeft = voteBudget - myVotes.length;
  const showVotes = board.board?.show_votes ?? true;
  const isOwner = board.board?.owner_id === user.id;

  /* ---------------- coordinate helpers ---------------- */

  const toWorld = useCallback(
    (clientX, clientY) => {
      const r = surfaceRef.current.getBoundingClientRect();
      return {
        x: (clientX - r.left - view.x) / view.k,
        y: (clientY - r.top - view.y) / view.k,
      };
    },
    [view]
  );

  /* ---------------- selection helpers ---------------- */

  const expandGroup = useCallback(
    (ids) => {
      const groups = new Set(
        ids.map((id) => objects.find((o) => o.id === id)?.group_id).filter(Boolean)
      );
      if (!groups.size) return ids;
      const out = new Set(ids);
      objects.forEach((o) => {
        if (o.group_id && groups.has(o.group_id)) out.add(o.id);
      });
      return [...out];
    },
    [objects]
  );

  /* ---------------- object creation ---------------- */

  const createAt = (type, world) => {
    const obj = board.createObject(type, world, user.id);
    setSel([obj.id]);
    setTool("select");
    if (type === "sticky" || type === "text") setEditing(obj.id);
  };

  /* ---------------- voting ---------------- */

  const castVote = (objectId, remove) => {
    if (remove) {
      board.removeVote(objectId);
      return;
    }
    const ok = board.castVote(objectId);
    if (!ok) flash(`You've used all ${voteBudget} votes. Shift-click to take one back.`);
  };

  const flash = (msg) => {
    setHint(msg);
    setTimeout(() => setHint(""), 2600);
  };

  /* ---------------- pointer: surface ---------------- */

  const onSurfacePointerDown = (e) => {
    if (e.target.closest("[data-obj]")) return;
    setEditing(null);

    const panning = tool === "hand" || spaceDown || e.button === 1;
    if (panning) {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
      return;
    }

    const world = toWorld(e.clientX, e.clientY);

    if (tool !== "select" && tool !== "vote") {
      createAt(tool, world);
      return;
    }

    if (!e.shiftKey) setSel([]);
    drag.current = { mode: "marquee", start: world, additive: e.shiftKey, base: sel };
    setMarquee({ x: world.x, y: world.y, w: 0, h: 0 });
  };

  const onSurfaceHover = (e) => {
    sendCursor(toWorld(e.clientX, e.clientY));
  };

  const onSurfacePointerMove = (e) => {
    const d = drag.current;
    if (!d) return;

    if (d.mode === "pan") {
      setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
      return;
    }

    const world = toWorld(e.clientX, e.clientY);

    if (d.mode === "marquee") {
      const box = {
        x: Math.min(d.start.x, world.x),
        y: Math.min(d.start.y, world.y),
        w: Math.abs(world.x - d.start.x),
        h: Math.abs(world.y - d.start.y),
      };
      setMarquee(box);
      const hits = objects
        .filter((o) => o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y)
        .map((o) => o.id);
      setSel(expandGroup(d.additive ? [...new Set([...d.base, ...hits])] : hits));
      return;
    }

    if (d.mode === "move") {
      const dx = world.x - d.start.x;
      const dy = world.y - d.start.y;
      Object.entries(d.origins).forEach(([id, origin]) => {
        board.patchObject(id, {
          x: Math.round(origin.x + dx),
          y: Math.round(origin.y + dy),
        });
      });
      return;
    }

    if (d.mode === "resize") {
      const dx = world.x - d.start.x;
      const dy = world.y - d.start.y;
      board.patchObject(d.objId, {
        w: Math.max(70, Math.round(d.ow + dx)),
        h: Math.max(48, Math.round(d.oh + dy)),
      });
    }
  };

  const endDrag = () => {
    if (drag.current && (drag.current.mode === "move" || drag.current.mode === "resize")) {
      board.flushAll();
    }
    drag.current = null;
    setMarquee(null);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const r = surfaceRef.current.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  /* Drag tracking lives on window rather than using setPointerCapture: capture
     retargets focus/click away from the element under the pointer, which broke
     inline editing. Window listeners keep drags alive outside the canvas too. */
  const moveRef = useRef(null);
  const upRef = useRef(null);
  moveRef.current = onSurfacePointerMove;
  upRef.current = endDrag;

  useEffect(() => {
    const mv = (e) => moveRef.current && moveRef.current(e);
    const up = (e) => upRef.current && upRef.current(e);
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  /* ---------------- pointer: object ---------------- */

  const onObjectPointerDown = (e, obj) => {
    e.stopPropagation();
    if (editing === obj.id) return;

    if (tool === "vote") {
      castVote(obj.id, e.shiftKey);
      return;
    }
    if (tool === "hand" || spaceDown) return;

    // Detect the double-click ourselves: pointer capture (needed so drags survive
    // leaving the canvas) retargets the native dblclick event away from this element.
    const now = Date.now();
    const isDouble = lastClick.current && lastClick.current.id === obj.id && now - lastClick.current.t < 350;
    lastClick.current = { id: obj.id, t: now };

    if (isDouble && EDITABLE.includes(obj.type)) {
      drag.current = null;
      setSel([obj.id]);
      setEditing(obj.id);
      return;
    }

    const next = e.shiftKey
      ? sel.includes(obj.id)
        ? sel.filter((id) => id !== obj.id)
        : [...sel, obj.id]
      : sel.includes(obj.id)
      ? sel
      : [obj.id];
    const expanded = expandGroup(next);
    setSel(expanded);
    setEditing(null);

    const origins = {};
    objects.forEach((o) => {
      if (expanded.includes(o.id)) origins[o.id] = { x: o.x, y: o.y };
    });
    drag.current = { mode: "move", start: toWorld(e.clientX, e.clientY), origins };
  };

  const onResizePointerDown = (e, obj) => {
    e.stopPropagation();
    drag.current = { mode: "resize", objId: obj.id, start: toWorld(e.clientX, e.clientY), ow: obj.w, oh: obj.h };
  };

  /* ---------------- commands ---------------- */

  const group = () => {
    if (sel.length < 2) return flash("Select two or more items to group them.");
    board.group(sel);
  };

  const ungroup = () => board.ungroup(sel);

  const removeSelected = useCallback(() => {
    if (!sel.length) return;
    board.deleteObjects(sel);
    setSel([]);
  }, [sel, board]);

  const applyColor = (c) => {
    const ids = objects.filter((o) => sel.includes(o.id) && COLORABLE.includes(o.type)).map((o) => o.id);
    if (ids.length) board.patchObjectsNow(ids, { color: c });
  };

  const resetView = () => setView({ x: 0, y: 0, k: 1 });

  const clearBoard = () => {
    if (!objects.length) return;
    if (!confirm("Clear every item and vote from this board? This can't be undone.")) return;
    board.deleteObjects(objects.map((o) => o.id));
    setSel([]);
  };

  const commitBoardName = () => {
    const name = boardNameDraft.trim() || "Untitled board";
    setRenamingBoard(false);
    if (board.board && name !== board.board.name) board.renameBoard(name);
  };

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const down = (e) => {
      const t = e.target;
      const typing = t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable || editing !== null;
      if (typing) return;

      if (e.code === "Space" && !e.repeat) setSpaceDown(true);

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
      }
      if (e.key === "Escape") {
        setSel([]);
        setEditing(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        e.shiftKey ? ungroup() : group();
      }
      if (e.key === "v") setTool("select");
      if (e.key === "h") setTool("hand");
      if (e.key === "n") setTool("sticky");
    };
    const up = (e) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  if (board.status === "loading") {
    return <div className="board-loading">Loading board…</div>;
  }
  if (board.status === "not-found") {
    return (
      <div className="board-error">
        <p>This board doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
        <button className="wb-btn" onClick={() => navigate("/")}>
          Back to my boards
        </button>
      </div>
    );
  }

  /* ---------------- derived ---------------- */

  const voteCount = (id) => votes.filter((v) => v.object_id === id).length;
  const voters = (id) => [...new Set(votes.filter((v) => v.object_id === id).map((v) => v.user_id))];

  const groupBoxes = (() => {
    const map = {};
    objects.forEach((o) => {
      if (!o.group_id) return;
      const b = map[o.group_id];
      map[o.group_id] = b
        ? { x: Math.min(b.x, o.x), y: Math.min(b.y, o.y), r: Math.max(b.r, o.x + o.w), bm: Math.max(b.bm, o.y + o.h) }
        : { x: o.x, y: o.y, r: o.x + o.w, bm: o.y + o.h };
    });
    return Object.entries(map).map(([id, b]) => ({
      id,
      x: b.x - 14,
      y: b.y - 14,
      w: b.r - b.x + 28,
      h: b.bm - b.y + 28,
    }));
  })();

  const paletteAnchor = (() => {
    if (tool !== "select" || editing) return null;
    const items = objects.filter((o) => sel.includes(o.id) && COLORABLE.includes(o.type));
    if (!items.length) return null;
    const left = Math.min(...items.map((o) => o.x));
    const right = Math.max(...items.map((o) => o.x + o.w));
    const top = Math.min(...items.map((o) => o.y));
    return {
      cx: ((left + right) / 2) * view.k + view.x,
      top: top * view.k + view.y,
      current: items.length === 1 ? items[0].color : null,
      shapesOnly: items.every((o) => o.type !== "sticky"),
    };
  })();

  const cursor =
    tool === "hand" || spaceDown ? "grab" : tool === "vote" ? "pointer" : tool === "select" ? "default" : "crosshair";

  const onlineMembers = onlineIds.map((id) => membersById[id]).filter(Boolean);
  const otherCursors = Object.fromEntries(
    Object.entries(cursors).filter(([id]) => id !== user.id)
  );

  /* ---------------- render ---------------- */

  return (
    <div className={`wb-root ${theme === "dark" ? "wb-dark" : ""}`}>
      <header className="wb-top">
        <div className="wb-title">
          <button className="wb-tool wb-back" onClick={() => navigate("/")} title="Back to my boards">
            <IconBack />
          </button>
          <span className="wb-mark" />
          <div>
            {renamingBoard ? (
              <input
                className="wb-boardname-input"
                autoFocus
                value={boardNameDraft}
                onChange={(e) => setBoardNameDraft(e.target.value)}
                onBlur={commitBoardName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenamingBoard(false);
                }}
              />
            ) : (
              <div
                className="wb-boardname"
                onDoubleClick={() => {
                  if (!isOwner || !board.board) return;
                  setBoardNameDraft(board.board.name);
                  setRenamingBoard(true);
                }}
                title={isOwner ? "Double-click to rename" : undefined}
              >
                {board.board?.name || "Untitled board"}
              </div>
            )}
            <div className="wb-sub">
              {objects.length} item{objects.length === 1 ? "" : "s"} · {votes.length} vote
              {votes.length === 1 ? "" : "s"} cast
            </div>
          </div>
        </div>

        <div className="wb-top-right">
          <div className="wb-presence">
            {onlineMembers.map((m) => (
              <span key={m.id} className={`wb-av ${m.id === user.id ? "is-me" : ""}`} style={{ background: m.color }} title={m.name}>
                {m.name[0]?.toUpperCase()}
              </span>
            ))}
          </div>

          <div className="wb-budget">
            <span className="wb-budget-dots">
              {Array.from({ length: voteBudget }).map((_, i) => (
                <span
                  key={i}
                  className="wb-budget-dot"
                  style={{ background: i < myVotes.length ? profile.color : "transparent" }}
                />
              ))}
            </span>
            {votesLeft} of {voteBudget} votes left
          </div>

          <button
            className={`wb-btn ${showVotes ? "" : "is-off"}`}
            onClick={() => isOwner && board.setShowVotes(!showVotes)}
            disabled={!isOwner}
            title={isOwner ? "" : "Only the board creator can toggle vote visibility"}
          >
            {showVotes ? "Hide votes" : "Show votes"}
          </button>

          <button
            className="wb-tool wb-theme"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </header>

      <nav className="wb-rail">
        {[
          ["select", "Select", <IconCursor key="a" />],
          ["hand", "Pan", <IconHand key="b" />],
          ["sticky", "Sticky note", <IconSticky key="c" />],
          ["text", "Text", <IconText key="d" />],
          ["rect", "Rectangle", <IconRect key="e" />],
          ["circle", "Circle", <IconCircle key="f" />],
          ["arrow", "Arrow", <IconArrow key="g" />],
        ].map(([id, label, icon]) => (
          <button key={id} className={`wb-tool ${tool === id ? "is-on" : ""}`} onClick={() => setTool(id)} title={label}>
            {icon}
          </button>
        ))}

        <span className="wb-rail-div" />

        <button className={`wb-tool wb-tool-vote ${tool === "vote" ? "is-on" : ""}`} onClick={() => setTool("vote")} title="Dot vote">
          <IconVote />
        </button>

        <span className="wb-rail-div" />

        <button className="wb-tool" onClick={group} title="Group selection">
          <IconGroup />
        </button>
        <button className="wb-tool" onClick={ungroup} title="Ungroup">
          <IconUngroup />
        </button>
        <button className="wb-tool" onClick={removeSelected} title="Delete selection">
          <IconTrash />
        </button>
      </nav>

      <div
        ref={surfaceRef}
        className="wb-surface"
        style={{ cursor }}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfaceHover}
        onWheel={onWheel}
      >
        <div
          className="wb-grid"
          style={{ backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        />

        <div className="wb-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          {groupBoxes.map((g) => (
            <div key={g.id} className="wb-groupbox" style={{ left: g.x, top: g.y, width: g.w, height: g.h }} />
          ))}

          {objects.map((o) => {
            const author = membersById[o.created_by];
            const n = voteCount(o.id);
            const isSel = sel.includes(o.id);
            return (
              <div
                key={o.id}
                data-obj
                data-tinted={o.color ? "" : undefined}
                className={`wb-obj wb-${o.type} ${isSel ? "is-sel" : ""}`}
                style={{ left: o.x, top: o.y, width: o.w, height: o.h, background: o.color || undefined }}
                onPointerDown={(e) => onObjectPointerDown(e, o)}
              >
                {o.type === "arrow" ? (
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="wb-arrowsvg">
                    <line x1="4" y1="20" x2="88" y2="20" />
                    <polyline points="74,8 92,20 74,32" />
                  </svg>
                ) : editing === o.id ? (
                  <NoteEditor
                    value={o.text}
                    onChange={(val) => board.patchObject(o.id, { text: val })}
                    onDone={() => {
                      board.flushObject(o.id);
                      setEditing(null);
                    }}
                  />
                ) : (
                  <div className="wb-objtext">{o.text || <span className="wb-ph">Double-click to write</span>}</div>
                )}

                <div className="wb-byline" title={`Added by ${author?.name || "someone"}`}>
                  <span className="wb-bydot" style={{ background: author?.color || "#9BA6B4" }} />
                  {author?.name || "…"}
                </div>

                {n > 0 && showVotes && (
                  <div className="wb-votepill">
                    <span className="wb-votedots">
                      {voters(o.id).map((uidv) => (
                        <span key={uidv} className="wb-votedot" style={{ background: membersById[uidv]?.color || "#9BA6B4" }} />
                      ))}
                    </span>
                    {n}
                  </div>
                )}
                {n > 0 && !showVotes && <div className="wb-votepill is-muted">voted</div>}

                {isSel && sel.length === 1 && <span className="wb-handle" onPointerDown={(e) => onResizePointerDown(e, o)} />}
              </div>
            );
          })}

          {marquee && (
            <div className="wb-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
          )}

          <Cursors cursors={otherCursors} />
        </div>

        {paletteAnchor && (
          <div className="wb-palette" style={{ left: paletteAnchor.cx, top: paletteAnchor.top - 14 }} onPointerDown={(e) => e.stopPropagation()}>
            {STICKY_COLORS.map((c) => (
              <button key={c} className={`wb-swatch ${paletteAnchor.current === c ? "is-on" : ""}`} style={{ background: c }} onClick={() => applyColor(c)} title="Set colour" />
            ))}
            {paletteAnchor.shapesOnly && (
              <>
                <span className="wb-palette-div" />
                <button className={`wb-swatch wb-swatch-none ${paletteAnchor.current === null ? "is-on" : ""}`} onClick={() => applyColor(null)} title="No fill" />
              </>
            )}
          </div>
        )}

        {objects.length === 0 && (
          <div className="wb-empty">
            <p className="wb-empty-h">Start with one idea.</p>
            <p className="wb-empty-p">
              Pick the sticky note in the rail, then click anywhere on the board. Invite others by sharing this
              page&rsquo;s link — they&rsquo;ll join as soon as they sign in.
            </p>
          </div>
        )}
      </div>

      <footer className="wb-bottom">
        <div className="wb-zoom">
          <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k / 1.2) }))}>−</button>
          <span>{Math.round(view.k * 100)}%</span>
          <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}>+</button>
          <button className="wb-zoom-reset" onClick={resetView}>
            Reset
          </button>
        </div>

        <p className="wb-help">
          {tool === "vote"
            ? "Click an item to spend a vote. Shift-click takes it back."
            : "Scroll to zoom · space-drag to pan · shift-click for multi-select · ⌘G to group"}
        </p>

        {isOwner ? (
          <button className="wb-clear" onClick={clearBoard}>
            Clear board
          </button>
        ) : (
          <span />
        )}
      </footer>

      {hint && <div className="wb-toast">{hint}</div>}
    </div>
  );
}
