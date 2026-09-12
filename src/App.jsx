import { useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "./styles/app.css";
import { AuthProvider, useAuthContext } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Board from "./pages/Board";
import Join from "./pages/Join";

const REDIRECT_KEY = "whiteboard:redirect_after_login";

function RequireAuth({ children }) {
  const { loading, session } = useAuthContext();
  const location = useLocation();

  // Remember where we were headed (e.g. a shared /join/:id link) so we can
  // send the user there once they finish signing in — otherwise the magic
  // link round-trip drops them on the app root with no memory of the invite.
  useEffect(() => {
    if (!loading && !session) {
      localStorage.setItem(REDIRECT_KEY, location.pathname);
    }
  }, [loading, session, location.pathname]);

  if (loading) return <div className="board-loading">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function RedirectIfAuthed({ children }) {
  const { loading, session } = useAuthContext();
  if (loading) return <div className="board-loading">Loading…</div>;
  if (session) return <Navigate to="/" replace />;
  return children;
}

// Consumes the stashed pending path (if any) the first time a session
// appears, so a signed-out visit to a share link resumes where it left off.
function PostLoginRedirect() {
  const { session } = useAuthContext();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (!session || handled.current) return;
    const target = localStorage.getItem(REDIRECT_KEY);
    if (target && target !== "/login") {
      handled.current = true;
      localStorage.removeItem(REDIRECT_KEY);
      navigate(target, { replace: true });
    }
  }, [session, navigate]);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PostLoginRedirect />
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <Login />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/board/:boardId"
            element={
              <RequireAuth>
                <Board />
              </RequireAuth>
            }
          />
          <Route
            path="/join/:boardId"
            element={
              <RequireAuth>
                <Join />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
