"use client";

import { FormEvent, useState } from "react";
import { UserPlus } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";

export default function TeamPage() {
  const { me, loading, logout } = usePortalSession();
  const [delegateName, setDelegateName] = useState("");
  const [delegateEmail, setDelegateEmail] = useState("");
  const [delegatePassword, setDelegatePassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading || !me) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading team workspace...</p>
        </BlockCard>
      </main>
    );
  }

  const canCreateUsers = me.role === "customer" || me.role === "delegate";

  async function createDelegate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    const res = await fetch("/api/delegates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: delegateName,
        email: delegateEmail,
        password: delegatePassword,
      }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setSubmitting(false);

    if (!res.ok) {
      setMessage(data.error ?? "Could not create user.");
      return;
    }

    setDelegateName("");
    setDelegateEmail("");
    setDelegatePassword("");
    setMessage(data.message ?? "User created.");
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Team Workspace"
      subtitle="Manage delegate or user logins in a dedicated, cleaner flow."
    >
      {message ? <p className={`inline-alert ${getAlertTone(message)}`}>{message}</p> : null}

      {!canCreateUsers ? (
        <BlockCard tone="muted">
          <p className="inline-alert inline-alert-warning">
            Your role cannot create users. Contact your customer administrator for access.
          </p>
        </BlockCard>
      ) : (
        <BlockCard as="article" interactive>
          <BlockTitle
            icon={<UserPlus size={14} />}
            title={me.role === "customer" ? "Create Delegate Login" : "Create User Login"}
            subtitle={
              me.role === "customer"
                ? "Create sub-logins for delegates."
                : "Create users with delegate permissions."
            }
          />

          <form onSubmit={createDelegate} className="form-grid">
            <div>
              <label className="label" htmlFor="team-name">
                {me.role === "customer" ? "Delegate Name" : "User Name"}
              </label>
              <input
                id="team-name"
                className="input"
                value={delegateName}
                onChange={(e) => setDelegateName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="team-email">
                {me.role === "customer" ? "Delegate Email" : "User Email"}
              </label>
              <input
                id="team-email"
                className="input"
                type="email"
                value={delegateEmail}
                onChange={(e) => setDelegateEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="team-password">
                {me.role === "customer" ? "Delegate Password" : "User Password"}
              </label>
              <input
                id="team-password"
                className="input"
                type="password"
                minLength={6}
                value={delegatePassword}
                onChange={(e) => setDelegatePassword(e.target.value)}
                required
              />
            </div>

            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Creating..." : me.role === "customer" ? "Create Delegate" : "Create User"}
            </button>
          </form>
        </BlockCard>
      )}
    </PortalFrame>
  );
}
