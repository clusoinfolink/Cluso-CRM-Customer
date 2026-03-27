"use client";

import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";

export default function SettingsPage() {
  const { me, loading, logout } = usePortalSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [changing, setChanging] = useState(false);

  if (loading || !me) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading settings...</p>
        </BlockCard>
      </main>
    );
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");

    if (newPassword !== confirmPassword) {
      setMessage("New password and confirm password must match.");
      return;
    }

    setChanging(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setChanging(false);

    if (!res.ok) {
      setMessage(data.error ?? "Could not change password.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage(data.message ?? "Password changed successfully.");
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Security Settings"
      subtitle="Manage your account password in a dedicated secure panel."
    >
      <BlockCard as="article" interactive>
        <BlockTitle
          icon={<KeyRound size={14} />}
          title="Change Password"
          subtitle="Use a strong password and avoid reusing old credentials."
        />

        <form onSubmit={changePassword} className="form-grid">
          <div>
            <label className="label" htmlFor="current-password">
              Current Password
            </label>
            <input
              id="current-password"
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="new-password">
              New Password
            </label>
            <input
              id="new-password"
              className="input"
              type="password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="confirm-password">
              Confirm New Password
            </label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {message ? <p className={`inline-alert ${getAlertTone(message)}`}>{message}</p> : null}

          <button className="btn btn-primary" type="submit" disabled={changing}>
            {changing ? "Updating..." : "Change Password"}
          </button>
        </form>
      </BlockCard>
    </PortalFrame>
  );
}
