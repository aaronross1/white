import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles/app.css";
import { AuthProvider, useAuthContext } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Board from "./pages/Board";

function RequireAuth({ children }) {
  const { loading, session } = useAuthContext();
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
