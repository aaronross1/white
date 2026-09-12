import React, { useState, useRef, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Demo identities — stands in for real auth until Supabase is wired  */
/* ------------------------------------------------------------------ */
const USERS = [
  { id: "u1", name: "You", color: "#2F6FED" },
  { id: "u2", name: "Sam", color: "#128A6E" },
  { id: "u3", name: "Riley", color: "#B5387A" },
];

const STICKY_COLORS = [
  "#FFE27A",
  "#A8DCC0",
  "#F7B7C2",
  "#A9C8F0",
  "#E2C9F0",
  "#F5CDA0",
];

const COLORABLE = ["sticky", "rect", "circle"];
const EDITABLE = ["sticky", "text", "rect", "circle"];
const VOTE_BUDGET = 5;
const STORE_KEY = "whiteboard:board:demo";

const DEFAULTS = {
  sticky: { w: 180, h: 180, text: "" },
  text: { w: 240, h: 60, text: "" },
  rect: { w: 200, h: 130, text: "" },
  circle: { w: 160, h: 160, text: "" },
  arrow: { w: 180, h: 60, text: "" },
};

let seq = 0;
const uid = () => `o${Date.now().toString(36)}${(seq++).toString(36)}`;

/* ------------------------------------------------------------------ */

export default function Whiteboard() {
  const [objects, setObjects] = useState([]);
  const [votes, setVotes] = useState([]); // [{ objectId, userId }]
  const [sel, setSel] = useState([]);
  const [tool, setTool] = useState("select");
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [me, setMe] = useState("u1");
  const [showVotes, setShowVotes] = useState(true);
  const [editing, setEditing] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [hint, setHint] = useState("");
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState("light");

  const surfaceRef = useRef(null);
  const drag = useRef(null);
  const colorTick = useRef(0);
  const lastClick = useRef(null);

  const meUser = USERS.find((u) => u.id === me);
  const myVotes = votes.filter((v) => v.userId === me).length;
  const votesLeft = VOTE_BUDGET - myVotes;

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(STORE_KEY);
        const saved = res ? JSON.parse(res.value) : null;
        if (!cancelled && saved) {
          setObjects(saved.objects || []);
          setVotes(saved.votes || []);
          if (typeof saved.showVotes === "boolean") setShowVotes(saved.showVotes);
          if (saved.theme) setTheme(saved.theme);
        }
      } catch {
        /* first run — nothing saved yet */
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      window.storage
        .set(STORE_KEY, JSON.stringify({ objects, votes, showVotes, theme }))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [objects, votes, showVotes, theme, ready]);

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
        ids.map((id) => objects.find((o) => o.id === id)?.groupId).filter(Boolean)
      );
      if (!groups.size) return ids;
      const out = new Set(ids);
      objects.forEach((o) => {
        if (o.groupId && groups.has(o.groupId)) out.add(o.id);
      });
      return [...out];
    },
    [objects]
  );

  /* ---------------- object creation ---------------- */

  const createAt = (type, world) => {
    const d = DEFAULTS[type];
    const obj = {
      id: uid(),
      type,
      x: Math.round(world.x - d.w / 2),
      y: Math.round(world.y - d.h / 2),
      w: d.w,
      h: d.h,
      text: d.text,
      color:
        type === "sticky"
          ? STICKY_COLORS[colorTick.current++ % STICKY_COLORS.length]
          : null,
      createdBy: me,
      groupId: null,
    };
    setObjects((o) => [...o, obj]);
    setSel([obj.id]);
    setTool("select");
    if (type === "sticky" || type === "text") setEditing(obj.id);
  };

  /* ---------------- voting ---------------- */

  const castVote = (objectId, remove) => {
    setVotes((v) => {
      if (remove) {
        const i = v.findIndex((x) => x.objectId === objectId && x.userId === me);
        if (i === -1) return v;
        const copy = v.slice();
        copy.splice(i, 1);
        return copy;
      }
      if (v.filter((x) => x.userId === me).length >= VOTE_BUDGET) {
        flash(`You've used all ${VOTE_BUDGET} votes. Shift-click to take one back.`);
        return v;
      }
      return [...v, { objectId, userId: me }];
    });
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
      drag.current = {
        mode: "pan",
        sx: e.clientX,
        sy: e.clientY,
        ox: view.x,
        oy: view.y,
      };
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
        .filter(
          (o) =>
            o.x < box.x + box.w &&
            o.x + o.w > box.x &&
            o.y < box.y + box.h &&
            o.y + o.h > box.y
        )
        .map((o) => o.id);
      setSel(expandGroup(d.additive ? [...new Set([...d.base, ...hits])] : hits));
      return;
    }

    if (d.mode === "move") {
      const dx = world.x - d.start.x;
      const dy = world.y - d.start.y;
      setObjects((os) =>
        os.map((o) =>
          d.origins[o.id]
            ? { ...o, x: Math.round(d.origins[o.id].x + dx), y: Math.round(d.origins[o.id].y + dy) }
            : o
        )
      );
      return;
    }

    if (d.mode === "resize") {
      const dx = world.x - d.start.x;
      const dy = world.y - d.start.y;
      setObjects((os) =>
        os.map((o) =>
          o.id === d.objId
            ? {
                ...o,
                w: Math.max(70, Math.round(d.ow + dx)),
                h: Math.max(48, Math.round(d.oh + dy)),
              }
            : o
        )
      );
    }
  };

  const endDrag = () => {
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
    const isDouble =
      lastClick.current && lastClick.current.id === obj.id && now - lastClick.current.t < 350;
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
    drag.current = {
      mode: "resize",
      objId: obj.id,
      start: toWorld(e.clientX, e.clientY),
      ow: obj.w,
      oh: obj.h,
    };
  };

  /* ---------------- commands ---------------- */

  const group = () => {
    if (sel.length < 2) return flash("Select two or more items to group them.");
    const gid = `g${Date.now().toString(36)}`;
    setObjects((os) => os.map((o) => (sel.includes(o.id) ? { ...o, groupId: gid } : o)));
  };

  const ungroup = () => {
    setObjects((os) => os.map((o) => (sel.includes(o.id) ? { ...o, groupId: null } : o)));
  };

  const removeSelected = useCallback(() => {
    setObjects((os) => os.filter((o) => !sel.includes(o.id)));
    setVotes((v) => v.filter((x) => !sel.includes(x.objectId)));
    setSel([]);
  }, [sel]);

  const applyColor = (c) => {
    setObjects((os) =>
      os.map((o) => (sel.includes(o.id) && COLORABLE.includes(o.type) ? { ...o, color: c } : o))
    );
  };

  const resetView = () => setView({ x: 0, y: 0, k: 1 });

  const clearBoard = () => {
    setObjects([]);
    setVotes([]);
    setSel([]);
  };

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const down = (e) => {
      const t = e.target;
      const typing =
        t.tagName === "TEXTAREA" ||
        t.tagName === "INPUT" ||
        t.isContentEditable ||
        editing !== null;
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

  /* ---------------- derived ---------------- */

  const voteCount = (id) => votes.filter((v) => v.objectId === id).length;
  const voters = (id) => [...new Set(votes.filter((v) => v.objectId === id).map((v) => v.userId))];
  const groupBoxes = (() => {
    const map = {};
    objects.forEach((o) => {
      if (!o.groupId) return;
      const b = map[o.groupId];
      map[o.groupId] = b
        ? {
            x: Math.min(b.x, o.x),
            y: Math.min(b.y, o.y),
            r: Math.max(b.r, o.x + o.w),
            bm: Math.max(b.bm, o.y + o.h),
          }
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
    tool === "hand" || spaceDown
      ? "grab"
      : tool === "vote"
      ? "pointer"
      : tool === "select"
      ? "default"
      : "crosshair";

  /* ---------------- render ---------------- */

  return (
    <div className={`wb-root ${theme === "dark" ? "wb-dark" : ""}`}>
      <style>{CSS}</style>

      {/* top bar */}
      <header className="wb-top">
        <div className="wb-title">
          <span className="wb-mark" />
          <div>
            <div className="wb-boardname">Product kickoff — idea round</div>
            <div className="wb-sub">
              {objects.length} item{objects.length === 1 ? "" : "s"} · {votes.length} vote
              {votes.length === 1 ? "" : "s"} cast
            </div>
          </div>
        </div>

        <div className="wb-top-right">
          <div className="wb-presence">
            {USERS.map((u) => (
              <button
                key={u.id}
                className={`wb-av ${u.id === me ? "is-me" : ""}`}
                style={{ background: u.color }}
                onClick={() => setMe(u.id)}
                title={`Act as ${u.name}`}
              >
                {u.name[0]}
              </button>
            ))}
          </div>

          <div className="wb-budget">
            <span className="wb-budget-dots">
              {Array.from({ length: VOTE_BUDGET }).map((_, i) => (
                <span
                  key={i}
                  className="wb-budget-dot"
                  style={{ background: i < myVotes ? meUser.color : "transparent" }}
                />
              ))}
            </span>
            {votesLeft} of {VOTE_BUDGET} votes left
          </div>

          <button
            className={`wb-btn ${showVotes ? "" : "is-off"}`}
            onClick={() => setShowVotes((s) => !s)}
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

      {/* left rail */}
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
          <button
            key={id}
            className={`wb-tool ${tool === id ? "is-on" : ""}`}
            onClick={() => setTool(id)}
            title={label}
          >
            {icon}
          </button>
        ))}

        <span className="wb-rail-div" />

        <button
          className={`wb-tool wb-tool-vote ${tool === "vote" ? "is-on" : ""}`}
          onClick={() => setTool("vote")}
          title="Dot vote"
        >
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

      {/* canvas */}
      <div
        ref={surfaceRef}
        className="wb-surface"
        style={{ cursor }}
        onPointerDown={onSurfacePointerDown}
        onWheel={onWheel}
      >
        <div
          className="wb-grid"
          style={{
            backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        />

        <div
          className="wb-world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          {groupBoxes.map((g) => (
            <div
              key={g.id}
              className="wb-groupbox"
              style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
            />
          ))}

          {objects.map((o) => {
            const author = USERS.find((u) => u.id === o.createdBy);
            const n = voteCount(o.id);
            const isSel = sel.includes(o.id);
            return (
              <div
                key={o.id}
                data-obj
                data-tinted={o.color ? "" : undefined}
                className={`wb-obj wb-${o.type} ${isSel ? "is-sel" : ""}`}
                style={{
                  left: o.x,
                  top: o.y,
                  width: o.w,
                  height: o.h,
                  background: o.color || undefined,
                }}
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
                    onChange={(val) =>
                      setObjects((os) =>
                        os.map((x) => (x.id === o.id ? { ...x, text: val } : x))
                      )
                    }
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <div className="wb-objtext">
                    {o.text || <span className="wb-ph">Double-click to write</span>}
                  </div>
                )}

                <div className="wb-byline" title={`Added by ${author?.name}`}>
                  <span className="wb-bydot" style={{ background: author?.color }} />
                  {author?.name}
                </div>

                {n > 0 && showVotes && (
                  <div className="wb-votepill">
                    <span className="wb-votedots">
                      {voters(o.id).map((uidv) => (
                        <span
                          key={uidv}
                          className="wb-votedot"
                          style={{ background: USERS.find((u) => u.id === uidv)?.color }}
                        />
                      ))}
                    </span>
                    {n}
                  </div>
                )}
                {n > 0 && !showVotes && <div className="wb-votepill is-muted">voted</div>}

                {isSel && sel.length === 1 && (
                  <span
                    className="wb-handle"
                    onPointerDown={(e) => onResizePointerDown(e, o)}
                  />
                )}
              </div>
            );
          })}

          {marquee && (
            <div
              className="wb-marquee"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
              }}
            />
          )}
        </div>

        {paletteAnchor && (
          <div
            className="wb-palette"
            style={{ left: paletteAnchor.cx, top: paletteAnchor.top - 14 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                className={`wb-swatch ${paletteAnchor.current === c ? "is-on" : ""}`}
                style={{ background: c }}
                onClick={() => applyColor(c)}
                title="Set colour"
              />
            ))}
            {paletteAnchor.shapesOnly && (
              <>
                <span className="wb-palette-div" />
                <button
                  className={`wb-swatch wb-swatch-none ${
                    paletteAnchor.current === null ? "is-on" : ""
                  }`}
                  onClick={() => applyColor(null)}
                  title="No fill"
                />
              </>
            )}
          </div>
        )}

        {objects.length === 0 && ready && (
          <div className="wb-empty">
            <p className="wb-empty-h">Start with one idea.</p>
            <p className="wb-empty-p">
              Pick the sticky note in the rail, then click anywhere on the board. Switch
              identities up top to see how attribution and vote budgets work with a few people
              in the room.
            </p>
          </div>
        )}
      </div>

      {/* bottom bar */}
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

        <button className="wb-clear" onClick={clearBoard}>
          Clear board
        </button>
      </footer>

      {hint && <div className="wb-toast">{hint}</div>}
    </div>
  );
}

/* ----------------------------- editor ------------------------------ */
/* Focus is taken explicitly on the next frame rather than via autoFocus:
   the element mounts inside a transformed layer mid-pointer-event, and
   autoFocus loses the race against the browser's own focus handling. */
function NoteEditor({ value, onChange, onDone }) {
  const ref = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <textarea
      ref={ref}
      className="wb-edit"
      value={value}
      placeholder="Type here"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keep Backspace, "n", "v" etc. from reaching the board shortcuts.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
      }}
    />
  );
}

/* ------------------------------- icons ------------------------------ */
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
const IconCursor = () => (<svg viewBox="0 0 24 24" {...S}><path d="M5 3l6 17 2.5-6.5L20 11z" /></svg>);
const IconHand = () => (<svg viewBox="0 0 24 24" {...S}><path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V12m0-1a1.5 1.5 0 013 0v5a5 5 0 01-5 5h-2a5 5 0 01-5-5v-4a1.5 1.5 0 013 0" /></svg>);
const IconSticky = () => (<svg viewBox="0 0 24 24" {...S}><path d="M5 4h14v10l-5 6H5z" /><path d="M19 14h-5v6" /></svg>);
const IconText = () => (<svg viewBox="0 0 24 24" {...S}><path d="M5 6h14M12 6v13" /></svg>);
const IconRect = () => (<svg viewBox="0 0 24 24" {...S}><rect x="4" y="6" width="16" height="12" rx="1.5" /></svg>);
const IconCircle = () => (<svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="7" /></svg>);
const IconArrow = () => (<svg viewBox="0 0 24 24" {...S}><path d="M4 12h15M14 7l5 5-5 5" /></svg>);
const IconVote = () => (<svg viewBox="0 0 24 24" {...S}><circle cx="9" cy="9" r="3" /><circle cx="16" cy="14" r="3" /><circle cx="8" cy="17" r="2" /></svg>);
const IconGroup = () => (<svg viewBox="0 0 24 24" {...S}><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /><path d="M11 7h4a2 2 0 012 2v4" /></svg>);
const IconUngroup = () => (<svg viewBox="0 0 24 24" {...S}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
const IconTrash = () => (<svg viewBox="0 0 24 24" {...S}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>);
const IconMoon = () => (<svg viewBox="0 0 24 24" {...S}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>);
const IconSun = () => (<svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></svg>);

/* -------------------------------- css ------------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap');

.wb-root{
  --paper:#EDEFF2; --dot:#D3D9E1; --ink:#1B2430; --ink-2:#5D6B7D;
  --line:#E1E5EB; --surface:#FFFFFF; --accent:#2F6FED; --vote:#D6455D;
  position:absolute; inset:0; display:flex; flex-direction:column;
  font-family:'Instrument Sans',system-ui,sans-serif; color:var(--ink);
  background:var(--paper); overflow:hidden; user-select:none;
}
.wb-root.wb-dark{
  --paper:#14171C; --dot:#2B313A; --ink:#E7ECF3; --ink-2:#8C99AA;
  --line:#2A303A; --surface:#1C2027; --accent:#5A8CF5; --vote:#E56A7E;
}
.wb-root button{font:inherit; color:inherit; cursor:pointer; border:none; background:none;}
.wb-root button:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}

/* top */
.wb-top{
  position:relative; z-index:20; display:flex; align-items:center; justify-content:space-between;
  gap:16px; padding:10px 16px; background:var(--surface); border-bottom:1px solid var(--line);
}
.wb-title{display:flex; align-items:center; gap:11px; min-width:0;}
.wb-mark{width:22px; height:22px; border-radius:6px; flex:none;
  background:linear-gradient(135deg,#2F6FED 0%,#B5387A 100%);}
.wb-boardname{font-size:15px; font-weight:600; letter-spacing:-0.01em;}
.wb-sub{font-size:12px; color:var(--ink-2); margin-top:1px;}
.wb-top-right{display:flex; align-items:center; gap:14px; flex-wrap:wrap;}

.wb-presence{display:flex;}
.wb-av{width:28px; height:28px; border-radius:50%; color:#fff; font-size:12px; font-weight:600;
  display:grid; place-items:center; margin-left:-6px; box-shadow:0 0 0 2px var(--surface);
  transition:transform .12s ease;}
.wb-av:first-child{margin-left:0;}
.wb-av.is-me{transform:translateY(-1px); box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--ink);}

.wb-budget{display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-2);}
.wb-budget-dots{display:flex; gap:3px;}
.wb-budget-dot{width:8px; height:8px; border-radius:50%; border:1.5px solid var(--ink-2);}

.wb-btn{padding:6px 12px; border-radius:7px; font-size:13px; font-weight:500;
  border:1px solid var(--line); background:var(--surface);}
.wb-btn:hover{border-color:#C6CDD7;}
.wb-btn.is-off{background:var(--ink); color:#fff; border-color:var(--ink);}

/* rail */
.wb-rail{
  position:absolute; left:14px; top:50%; transform:translateY(-40%); z-index:20;
  display:flex; flex-direction:column; gap:2px; padding:6px;
  background:var(--surface); border:1px solid var(--line); border-radius:12px;
  box-shadow:0 6px 20px rgba(27,36,48,.10);
}
.wb-tool{width:36px; height:36px; border-radius:8px; display:grid; place-items:center; color:var(--ink-2);}
.wb-tool svg{width:19px; height:19px;}
.wb-tool:hover{background:#F1F4F8; color:var(--ink);}
.wb-tool.is-on{background:var(--ink); color:#fff;}
.wb-tool-vote.is-on{background:var(--vote);}
.wb-rail-div{height:1px; background:var(--line); margin:5px 4px;}

/* surface */
.wb-surface{position:relative; flex:1; overflow:hidden; touch-action:none;}
.wb-grid{position:absolute; inset:0;
  background-image:radial-gradient(circle, var(--dot) 1px, transparent 1px);}
.wb-world{position:absolute; inset:0; transform-origin:0 0;}

.wb-obj{position:absolute; box-sizing:border-box; display:flex; align-items:flex-start;
  padding:14px 14px 26px; border-radius:4px; font-size:15px; line-height:1.34;}
.wb-obj.is-sel{box-shadow:0 0 0 2px var(--accent);}
.wb-sticky{box-shadow:0 2px 6px rgba(27,36,48,.16);}
.wb-sticky.is-sel{box-shadow:0 2px 6px rgba(27,36,48,.16),0 0 0 2px var(--accent);}
.wb-text{background:transparent; padding:6px 8px 22px;}
.wb-rect{background:var(--surface); border:1.5px solid #9BA6B4; border-radius:6px;}
.wb-circle{background:var(--surface); border:1.5px solid #9BA6B4; border-radius:50%;
  align-items:center; justify-content:center; text-align:center; padding:20px 20px 26px;}
.wb-arrow{padding:0; color:#6C7889;}
.wb-arrowsvg{width:100%; height:100%; fill:none; stroke:currentColor; stroke-width:2;
  stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke;}

.wb-objtext{white-space:pre-wrap; overflow:hidden; width:100%; word-break:break-word;}
.wb-ph{color:var(--ink-2); opacity:.85;}

/* tinted fills stay light, so force dark text on them in either theme */
.wb-obj[data-tinted]{color:#1B2430;}
.wb-obj[data-tinted] .wb-ph{color:rgba(27,36,48,.36);}
.wb-obj[data-tinted] .wb-byline{color:rgba(27,36,48,.55);}
.wb-edit{width:100%; height:100%; border:none; outline:none; resize:none; background:transparent;
  font:inherit; line-height:1.34; color:inherit; padding:0; user-select:text; cursor:text;}
.wb-edit::placeholder{color:currentColor; opacity:.34;}

.wb-byline{position:absolute; left:12px; bottom:7px; display:flex; align-items:center; gap:5px;
  font-size:10.5px; font-weight:500; color:var(--ink-2);}
.wb-text .wb-byline{left:8px;}
.wb-bydot{width:6px; height:6px; border-radius:50%;}

.wb-votepill{position:absolute; right:-9px; top:-9px; display:flex; align-items:center; gap:5px;
  padding:3px 8px; border-radius:20px; background:var(--surface); border:1px solid var(--line);
  font-size:12px; font-weight:600; box-shadow:0 2px 7px rgba(27,36,48,.14);}
.wb-votepill.is-muted{font-weight:500; font-size:10.5px; color:var(--ink-2);}
.wb-votedots{display:flex; gap:2px;}
.wb-votedot{width:7px; height:7px; border-radius:50%;}

.wb-handle{position:absolute; right:-5px; bottom:-5px; width:11px; height:11px; border-radius:3px;
  background:var(--surface); border:2px solid var(--accent); cursor:nwse-resize;}
.wb-groupbox{position:absolute; border:1.5px dashed #A9B4C2; border-radius:10px;
  background:rgba(47,111,237,.03); pointer-events:none;}
.wb-marquee{position:absolute; border:1px solid var(--accent);
  background:rgba(47,111,237,.09); pointer-events:none;}

/* colour palette */
.wb-palette{position:absolute; z-index:25; transform:translate(-50%,-100%);
  display:flex; align-items:center; gap:5px; padding:6px 8px; border-radius:10px;
  background:var(--surface); border:1px solid var(--line);
  box-shadow:0 6px 20px rgba(0,0,0,.18);}
.wb-swatch{width:20px; height:20px; border-radius:50%; border:1.5px solid rgba(0,0,0,.12);}
.wb-swatch:hover{transform:scale(1.12);}
.wb-swatch.is-on{box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--accent);}
.wb-swatch-none{background:var(--surface); border:1.5px solid var(--ink-2); position:relative;}
.wb-swatch-none::after{content:''; position:absolute; inset:2px;
  background:linear-gradient(45deg,transparent 45%,var(--ink-2) 45%,var(--ink-2) 55%,transparent 55%);}
.wb-palette-div{width:1px; height:18px; background:var(--line);}
.wb-theme{width:30px; height:30px;}

.wb-empty{position:absolute; left:50%; top:46%; transform:translate(-50%,-50%);
  max-width:380px; text-align:center; pointer-events:none;}
.wb-empty-h{margin:0 0 8px; font-size:21px; font-weight:600; letter-spacing:-0.015em;}
.wb-empty-p{margin:0; font-size:13.5px; line-height:1.55; color:var(--ink-2);}

/* bottom */
.wb-bottom{position:relative; z-index:20; display:flex; align-items:center; justify-content:space-between;
  gap:16px; padding:8px 16px; background:var(--surface); border-top:1px solid var(--line);}
.wb-zoom{display:flex; align-items:center; gap:4px; font-size:12.5px; color:var(--ink-2);}
.wb-zoom button{width:26px; height:26px; border-radius:6px; font-size:15px;}
.wb-zoom button:hover{background:#F1F4F8;}
.wb-zoom span{min-width:42px; text-align:center; font-variant-numeric:tabular-nums;}
.wb-zoom-reset{width:auto !important; padding:0 9px; font-size:12.5px;}
.wb-help{margin:0; font-size:12px; color:var(--ink-2); text-align:center;}
.wb-clear{font-size:12.5px; color:var(--ink-2); padding:5px 9px; border-radius:6px;}
.wb-clear:hover{background:#F1F4F8; color:var(--ink);}

.wb-toast{position:absolute; left:50%; bottom:60px; transform:translateX(-50%); z-index:40;
  padding:9px 15px; border-radius:8px; background:var(--ink); color:#fff; font-size:13px;
  box-shadow:0 6px 20px rgba(27,36,48,.25);}

@media (max-width:720px){
  .wb-sub,.wb-help{display:none;}
  .wb-rail{top:auto; bottom:54px; left:50%; transform:translateX(-50%); flex-direction:row;}
  .wb-rail-div{width:1px; height:auto; margin:4px 5px;}
}
@media (prefers-reduced-motion:reduce){ .wb-root *{transition:none !important;} }
`;
