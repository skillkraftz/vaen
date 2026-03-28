"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "set-password">("signin");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Handle auth tokens in URL hash fragments (invite, recovery, magic links).
  // @supabase/ssr's createBrowserClient does NOT auto-detect hash fragments,
  // so we parse them manually and call setSession.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token=")) return;

    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type"); // "recovery", "invite", "signup", "magiclink"

    if (!accessToken || !refreshToken) return;

    // Clear the hash so tokens aren't visible / re-processed on refresh
    window.history.replaceState(null, "", window.location.pathname);

    const supabase = createClient();
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError(`Auth error: ${sessionError.message}`);
          return;
        }
        if (type === "recovery") {
          // User clicked a password recovery link — let them set a new password
          setMode("set-password");
          setMessage("Set your new password below.");
        } else {
          // invite, signup confirmation, magic link — go straight to dashboard
          router.push("/dashboard");
          router.refresh();
        }
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const supabase = createClient();

    if (mode === "set-password") {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } else if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Check your email for a confirmation link.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    }

    setLoading(false);
  }

  return (
    <div className="page-narrow" style={{ paddingTop: "6rem" }} data-testid="login-page">
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>
          vaen.space
        </h1>
        <p className="text-muted text-sm" style={{ marginBottom: "1.5rem" }}>
          {mode === "set-password"
            ? "Set your password"
            : mode === "signin"
              ? "Sign in to your account"
              : "Create a new account"}
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <form onSubmit={handleSubmit}>
          {mode !== "set-password" && (
            <div className="form-group">
              <label className="form-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="form-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              {mode === "set-password" ? "New Password" : "Password"}
            </label>
            <input
              id="password"
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%", justifyContent: "center" }}
            data-testid="login-submit"
          >
            {loading
              ? "Loading..."
              : mode === "set-password"
                ? "Set Password"
                : mode === "signin"
                  ? "Sign In"
                  : "Create Account"}
          </button>
        </form>

        {mode !== "set-password" && <p className="text-sm text-muted" style={{ marginTop: "1rem", textAlign: "center" }}>
          {mode === "signin" ? (
            <>
              No account?{" "}
              <button
                onClick={() => { setMode("signup"); setError(""); setMessage(""); }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-primary)",
                  cursor: "pointer",
                  fontSize: "inherit",
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("signin"); setError(""); setMessage(""); }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-primary)",
                  cursor: "pointer",
                  fontSize: "inherit",
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>}
      </div>
    </div>
  );
}
