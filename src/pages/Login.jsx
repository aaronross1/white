import { useState } from "react";
import { useAuthContext } from "../context/AuthContext";

export default function Login() {
  const { signInWithEmail } = useAuthContext();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError("");
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-mark" />
        <h1>Whiteboard</h1>
        {sent ? (
          <>
            <p className="auth-lead">Check your email</p>
            <p className="auth-sub">
              We sent a sign-in link to <strong>{email}</strong>. Open it on this
              device to continue.
            </p>
            <button className="auth-link-btn" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </>
        ) : (
          <>
            <p className="auth-lead">Sign in to continue</p>
            <p className="auth-sub">
              Enter your email and we&rsquo;ll send you a magic link — no password
              needed.
            </p>
            <form onSubmit={submit}>
              <input
                type="email"
                required
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send magic link"}
              </button>
            </form>
            {error && <p className="auth-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
