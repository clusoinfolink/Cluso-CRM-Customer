"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Login failed");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="auth-layout">
      <section className="auth-grid">
        <BlockCard tone="accent" interactive>
          <p className="block-kicker">Cluso Verification Network</p>
          <BlockTitle
            icon={<Sparkles size={14} />}
            title="Futuristic Partner Workspace"
            subtitle="Securely submit candidate requests, manage delegates, and track status updates in one command center."
          />
          <div className="auth-hero-list">
            <div className="auth-hero-item">
              <CheckCircle2 size={16} />
              Live request lifecycle status.
            </div>
            <div className="auth-hero-item">
              <CheckCircle2 size={16} />
              Role-based workspace access.
            </div>
            <div className="auth-hero-item">
              <CheckCircle2 size={16} />
              Secure account and password controls.
            </div>
          </div>
        </BlockCard>

        <BlockCard interactive>
          <BlockTitle
            icon={<LockKeyhole size={14} />}
            title="Partner Login"
            subtitle="No self-signup is enabled. Use your company account created by Cluso Admin."
          />

          <form onSubmit={onSubmit} className="form-grid">
            <div>
              <label className="label" htmlFor="email">
                <span className="title-with-icon">
                  <Mail size={14} />
                  Email
                </span>
              </label>
              <input
                id="email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                <span className="title-with-icon">
                  <LockKeyhole size={14} />
                  Password
                </span>
              </label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error ? <p className="inline-alert inline-alert-danger">{error}</p> : null}

            <button className="btn btn-primary" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </BlockCard>
      </section>
    </main>
  );
}
