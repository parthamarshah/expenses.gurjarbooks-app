import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./AuthContext";

const G = {
  bg: "#FFF", bg2: "#F5F5F5", bdr: "#D4D4D4",
  t1: "#111", t2: "#555", t3: "#888", tm: "#AAA",
  bk: "#000", wh: "#FFF",
};

const inp = {
  width: "100%", padding: "14px 16px", borderRadius: 12,
  border: `2px solid ${G.bdr}`, fontSize: 16, outline: "none",
  boxSizing: "border-box", color: G.t1, background: G.bg2, marginBottom: 10,
};

// ── Password Reset (shown when user arrives via reset-password link) ─────────
export function PasswordReset() {
  const [pw,   setPw]   = useState("");
  const [pw2,  setPw2]  = useState("");
  const [err,  setErr]  = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setErr(""); setInfo("");
    if (pw.length < 6)    { setErr("Password must be at least 6 characters"); return; }
    if (pw !== pw2)        { setErr("Passwords do not match"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) setErr(error.message);
      else setInfo("Password updated! Signing you in…");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 390, margin: "0 auto", minHeight: "100dvh", display: "flex",
                  flexDirection: "column", justifyContent: "center", background: G.bg,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
                  padding: "0 24px", boxSizing: "border-box" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: G.bk, color: G.wh,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 26, fontWeight: 800, marginBottom: 16 }}>₹</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>Set New Password</div>
      </div>

      {err  && <div style={{ background: "#FFF0F0", border: "1.5px solid #FFCCCC", borderRadius: 10,
                             padding: "12px 16px", fontSize: 14, color: "#CC0000", marginBottom: 14 }}>{err}</div>}
      {info && <div style={{ background: "#F0FFF4", border: "1.5px solid #B2F2CC", borderRadius: 10,
                             padding: "12px 16px", fontSize: 14, color: "#007A33", marginBottom: 14 }}>{info}</div>}

      <input type="password" placeholder="New password" value={pw} onChange={e => setPw(e.target.value)}
             onKeyDown={e => e.key === "Enter" && handle()} style={inp} autoFocus />
      <input type="password" placeholder="Confirm password" value={pw2} onChange={e => setPw2(e.target.value)}
             onKeyDown={e => e.key === "Enter" && handle()} style={{ ...inp, marginBottom: 20 }} />

      <button onClick={handle} disabled={busy}
              style={{ width: "100%", padding: 16, borderRadius: 14, border: "none",
                       background: busy ? G.tm : G.bk, color: G.wh, fontSize: 18,
                       fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
        {busy ? "…" : "Update Password"}
      </button>
    </div>
  );
}

// ── Main Auth screen ─────────────────────────────────────────────────────────
export default function Auth() {
  const { needsPasswordReset } = useAuth();
  if (needsPasswordReset) return <PasswordReset />;

  return <AuthInner />;
}

function useStats() {
  const [state, setState] = useState({ stats: null, status: "loading" });
  useEffect(() => {
    fetch("/api/stats").then(r => r.json())
      .then(d => setState(d.ok ? { stats: d, status: "success" } : { stats: null, status: "error" }))
      .catch(() => setState({ stats: null, status: "error" }));
  }, []);
  return state;
}

function useStatsHistory() {
  const [state, setState] = useState({ history: null, status: "loading" });
  useEffect(() => {
    fetch("/api/stats-history").then(r => r.json())
      .then(d => setState(d.ok ? { history: d.weeks, status: "success" } : { history: null, status: "error" }))
      .catch(() => setState({ history: null, status: "error" }));
  }, []);
  return state;
}

function ActivityChart({ weeks }) {
  if (!weeks || weeks.length < 2) return null;
  const W = 280, H = 90;
  const points = weeks.map((w, i) => ({
    x: 4 + (i / (weeks.length - 1)) * (W - 8),
    entries: w.entries,
  }));
  const maxVal = Math.max(1, ...points.map(p => p.entries));
  const toY = (v) => H - 16 - Math.round((v / maxVal) * (H - 28));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${toY(p.entries)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${H - 16} L ${points[0].x.toFixed(1)} ${H - 16} Z`;
  const last = points[points.length - 1];
  const endY = toY(last.entries);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 90 }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF9500" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#FF9500" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#cg)" />
      <path d={linePath} fill="none" stroke="#FF9500" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x.toFixed(1)} cy={endY} r={3} fill="#FF9500" />
      <line x1={4} y1={H - 16} x2={W - 4} y2={H - 16} stroke={G.bdr} strokeWidth={1} />
      <text x={W - 4} y={H - 5} fontSize={7} fill="#FF9500" textAnchor="end">{last.entries.toLocaleString("en-IN")} last week</text>
    </svg>
  );
}

function AuthInner() {
  const [mode,     setMode]     = useState("login");   // "login" | "register" | "forgot"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [info,     setInfo]     = useState("");
  const [busy,     setBusy]     = useState(false);
  const { stats, status: statsStatus } = useStats();
  const { history, status: historyStatus } = useStatsHistory();
  const [statsShown, setStatsShown] = useState(false);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (statsStatus === "success") {
      if (reduceMotion) { setStatsShown(true); return; }
      const raf = requestAnimationFrame(() => setStatsShown(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [statsStatus, reduceMotion]);

  const reset = (m) => { setMode(m); setErr(""); setInfo(""); };

  const handleGoogle = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "https://expenses.gurjarbooks.com" },
    });
    if (error) { setErr(error.message); setBusy(false); }
  };

  const handleForgot = async () => {
    setErr(""); setInfo("");
    if (!email.trim()) { setErr("Enter your email first"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: "https://expenses.gurjarbooks.com",
      });
      if (error) setErr(error.message);
      else setInfo("Check your email for the password reset link.");
    } finally { setBusy(false); }
  };

  const [resending, setResending] = useState(false);
  const [signedUpEmail, setSignedUpEmail] = useState("");

  const handleResend = async () => {
    if (!signedUpEmail) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: signedUpEmail });
      if (error) setErr(error.message);
      else setInfo("Confirmation email resent! Check your inbox and spam folder.");
    } finally { setResending(false); }
  };

  const handle = async () => {
    if (mode === "forgot") { handleForgot(); return; }
    setErr(""); setInfo("");
    if (!email.trim() || !password) { setErr("Email and password required"); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          if (/email.*not.*confirmed/i.test(error.message))
            setErr("Please confirm your email first. Check your inbox (and spam folder).");
          else if (/invalid.*credentials|invalid.*password|invalid.*login/i.test(error.message))
            setErr("Wrong email or password. Try again or reset your password.");
          else setErr(error.message);
        }
      } else {
        const { data: signUpData, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) {
          if (/already registered|already exists|already.*sign/i.test(error.message)) setErr("__exists__");
          else setErr(error.message);
        } else if (signUpData?.user?.identities?.length === 0) {
          // Supabase returns fake success for existing emails (anti-enumeration)
          setErr("__exists__");
        } else {
          setSignedUpEmail(email.trim());
          setInfo("__confirm__");
          setMode("login");
          setPassword("");
        }
      }
    } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 390, margin: "0 auto", minHeight: "100dvh", display: "flex",
                  flexDirection: "column", justifyContent: "center", background: G.bg,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
                  padding: "0 24px", boxSizing: "border-box" }}>

      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: G.bk, color: G.wh,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 26, fontWeight: 800, marginBottom: 16 }}>₹</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: G.t1 }}>Expense Tracker</div>
        <div style={{ fontSize: 15, color: G.t3, marginTop: 6 }}>
          {mode === "login"    ? "Sign in to your account"
          : mode === "register" ? "Create a new account"
          :                       "Reset your password"}
        </div>
      </div>

      {err  && <div style={{ background: "#FFF0F0", border: "1.5px solid #FFCCCC", borderRadius: 10,
                             padding: "12px 16px", fontSize: 14, color: "#CC0000", marginBottom: 14 }}>
        {err === "__exists__" ? (<>Account already exists — <button onClick={() => reset("login")} style={{ background: "none", border: "none", padding: 0, fontSize: 14, fontWeight: 700, color: "#CC0000", cursor: "pointer", textDecoration: "underline" }}>try signing in</button></>) : err}
      </div>}
      {info && (info === "__confirm__" ? (
        <div style={{ background: "#F0F7FF", border: "2px solid #CCE0FF", borderRadius: 14,
                      padding: "18px 18px", marginBottom: 16, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0055CC", marginBottom: 6 }}>Confirmation Email Sent!</div>
          <div style={{ fontSize: 14, color: "#0055CC", lineHeight: 1.5, marginBottom: 10 }}>
            Check your inbox (and spam folder) for <strong>{signedUpEmail}</strong>. Click the link to verify, then sign in below.
          </div>
          <button onClick={handleResend} disabled={resending} style={{ background: "none", border: "none", padding: 0, fontSize: 14, fontWeight: 700, color: "#0055CC", cursor: "pointer", textDecoration: "underline" }}>{resending ? "Sending…" : "Resend email"}</button>
        </div>
      ) : (
        <div style={{ background: "#F0F7FF", border: "1.5px solid #CCE0FF", borderRadius: 10,
                      padding: "12px 16px", fontSize: 14, color: "#0055CC", marginBottom: 14 }}>{info}</div>
      ))}

      {/* Email */}
      <input type="email" placeholder="Email" value={email} autoComplete="email"
             onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()}
             style={inp} />

      {/* Password (hidden on forgot mode) */}
      {mode !== "forgot" && (
        <input type="password" placeholder="Password (min 6 chars)" value={password}
               autoComplete={mode === "login" ? "current-password" : "new-password"}
               onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()}
               style={{ ...inp, marginBottom: mode === "login" ? 4 : 20 }} />
      )}

      {/* Forgot password link (login mode only) */}
      {mode === "login" && (
        <div style={{ textAlign: "right", marginBottom: 16 }}>
          <button onClick={() => reset("forgot")}
                  style={{ background: "none", border: "none", padding: 0, fontSize: 13,
                           color: G.t3, cursor: "pointer" }}>
            Forgot password?
          </button>
        </div>
      )}

      {/* Primary action button */}
      <button onClick={handle} disabled={busy}
              style={{ width: "100%", padding: 16, borderRadius: 14, border: "none",
                       background: busy ? G.tm : G.bk, color: G.wh, fontSize: 18,
                       fontWeight: 700, cursor: busy ? "default" : "pointer", marginBottom: 14 }}>
        {busy ? "…"
          : mode === "login"    ? "Sign In"
          : mode === "register" ? "Create Account"
          :                       "Send Reset Link"}
      </button>

      {/* Google OAuth (login / register only) */}
      {mode !== "forgot" && (
        <button onClick={handleGoogle} disabled={busy}
                style={{ width: "100%", padding: 14, borderRadius: 14,
                         border: `2px solid ${G.bdr}`, background: G.bg,
                         color: G.t1, fontSize: 16, fontWeight: 600,
                         cursor: busy ? "default" : "pointer", display: "flex",
                         alignItems: "center", justifyContent: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
      )}

      {/* Mode switcher */}
      <div style={{ textAlign: "center", marginTop: 20, fontSize: 15, color: G.t3 }}>
        {mode === "login" ? (
          <>No account? <button onClick={() => reset("register")}
            style={{ background: "none", border: "none", padding: 0, fontSize: 15, fontWeight: 700, color: G.t1, cursor: "pointer" }}>Register</button></>
        ) : mode === "register" ? (
          <>Have an account? <button onClick={() => reset("login")}
            style={{ background: "none", border: "none", padding: 0, fontSize: 15, fontWeight: 700, color: G.t1, cursor: "pointer" }}>Sign In</button></>
        ) : (
          <button onClick={() => reset("login")}
            style={{ background: "none", border: "none", padding: 0, fontSize: 15, fontWeight: 700, color: G.t1, cursor: "pointer" }}>Back to Sign In</button>
        )}
      </div>

      {mode === "login" && (
        <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: G.tm, lineHeight: 1.5 }}>
          Forgot which email you used? Try your common addresses, or use Google sign-in if that's how you registered.
        </div>
      )}

      {/* Anonymous aggregate stats + activity chart */}
      {(statsStatus === "loading" || stats) && (
        <div style={{ marginTop: 28, borderTop: `1px solid ${G.bdr}`, paddingTop: 20,
                      opacity: statsStatus === "loading" || statsShown ? 1 : 0,
                      transform: reduceMotion || statsStatus === "loading" || statsShown ? "translateY(0)" : "translateY(6px)",
                      transition: reduceMotion ? "none" : "opacity 280ms ease, transform 280ms ease" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: G.tm, textTransform: "uppercase",
                        letterSpacing: 1.2, textAlign: "center", marginBottom: 12 }}>
            Community Stats
          </div>
          {statsStatus === "loading" ? (
            <div style={{ display: "flex", gap: 8 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ flex: 1, height: 62, background: G.bg2,
                                      border: `1px solid ${G.bdr}`, borderRadius: 12 }} />
              ))}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { label: "Expenses logged", value: stats.total_expenses.toLocaleString("en-IN") },
                  { label: "Last 7 days", value: stats.expenses_this_week.toLocaleString("en-IN") },
                  { label: "Active users (7d)", value: stats.active_users_this_week.toLocaleString("en-IN") },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, textAlign: "center", background: G.bg2,
                                              border: `1px solid ${G.bdr}`, borderRadius: 12, padding: "10px 6px" }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: G.t1, letterSpacing: -0.5 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 10, color: G.t3, marginTop: 3, lineHeight: 1.3 }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
              {stats.active_users_this_week > 0 && stats.expenses_this_week < 1000
                && Math.round(stats.expenses_this_week / stats.active_users_this_week) >= 1 && (
                <div style={{ textAlign: "center", fontSize: 12, fontWeight: 500, color: G.t2, marginTop: 10 }}>
                  {(() => {
                    const avg = Math.round(stats.expenses_this_week / stats.active_users_this_week);
                    return `~${avg} ${avg === 1 ? "entry" : "entries"} per active user this week`;
                  })()}
                </div>
              )}
              {historyStatus === "success" && history && history.length >= 2 && (
                <div style={{ background: G.bg2, borderRadius: 12, padding: "12px 12px 8px", marginTop: 14 }}>
                  <div style={{ fontSize: 10, color: G.t3, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>
                    Activity · last {history.length} weeks
                  </div>
                  <ActivityChart weeks={history} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
