"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";

type TeamRole = "delegate" | "delegate_user";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  createdAt: string | null;
};

type TeamMembersResponse = {
  members?: TeamMember[];
  error?: string;
};

function formatRoleLabel(role: TeamRole) {
  return role === "delegate" ? "Delegate" : "User";
}

export default function TeamPage() {
  const { me, loading, logout } = usePortalSession();
  const [delegateName, setDelegateName] = useState("");
  const [delegateEmail, setDelegateEmail] = useState("");
  const [delegatePassword, setDelegatePassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [targetRole, setTargetRole] = useState<TeamRole>("delegate");
  const [updateReason, setUpdateReason] = useState("");
  const [updatingAccess, setUpdatingAccess] = useState(false);

  const canCreateUsers = me?.role === "customer" || me?.role === "delegate";
  const canViewUsers = me?.role === "customer" || me?.role === "delegate";
  const canEditAccess = me?.role === "customer";

  const loadTeamMembers = useCallback(async () => {
    if (!me || !canViewUsers) {
      setTeamMembers([]);
      setSelectedMemberId("");
      return;
    }

    setMembersLoading(true);

    try {
      const res = await fetch("/api/delegates", { cache: "no-store" });
      const data = (await res.json()) as TeamMembersResponse;

      if (!res.ok) {
        setMessage(data.error ?? "Could not load team members.");
        setTeamMembers([]);
        setSelectedMemberId("");
        return;
      }

      const members = data.members ?? [];
      setTeamMembers(members);
      setSelectedMemberId((current) =>
        members.some((member) => member.id === current) ? current : "",
      );
    } catch {
      setMessage("Could not load team members.");
      setTeamMembers([]);
      setSelectedMemberId("");
    } finally {
      setMembersLoading(false);
    }
  }, [canViewUsers, me]);

  useEffect(() => {
    if (loading || !me) {
      return;
    }

    void loadTeamMembers();
  }, [loadTeamMembers, loading, me]);

  useEffect(() => {
    const selected = teamMembers.find((member) => member.id === selectedMemberId);
    if (!selected) {
      return;
    }

    setTargetRole(selected.role === "delegate" ? "delegate_user" : "delegate");
  }, [selectedMemberId, teamMembers]);

  const selectedMember = teamMembers.find((member) => member.id === selectedMemberId) ?? null;

  if (loading || !me) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading team workspace...</p>
        </BlockCard>
      </main>
    );
  }

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
    await loadTeamMembers();
  }

  async function updateAccess(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");

    if (!selectedMemberId) {
      setMessage("Choose a team account first.");
      return;
    }

    if (!updateReason.trim()) {
      setMessage("Please provide a reason for this access change.");
      return;
    }

    setUpdatingAccess(true);

    const res = await fetch("/api/delegates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: selectedMemberId,
        targetRole,
        reason: updateReason.trim(),
      }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setUpdatingAccess(false);

    if (!res.ok) {
      setMessage(data.error ?? "Could not update team access.");
      return;
    }

    setMessage(data.message ?? "Team access updated.");
    setUpdateReason("");
    await loadTeamMembers();
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
            Your role cannot create users. Contact your partner administrator for access.
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

      {canViewUsers ? (
        <BlockCard as="article" interactive>
          <BlockTitle
            icon={<UserPlus size={14} />}
            title="Manage Existing Team Access"
            subtitle="View team accounts and switch delegate or user role from one place."
          />

          {membersLoading ? (
            <p className="block-subtitle">Loading team members...</p>
          ) : teamMembers.length === 0 ? (
            <p className="block-subtitle">No delegate or user accounts found yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Email</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((member) => (
                    <tr key={member.id}>
                      <td style={{ padding: "0.35rem 0" }}>{member.name}</td>
                      <td style={{ padding: "0.35rem 0" }}>{member.email}</td>
                      <td style={{ padding: "0.35rem 0" }}>{formatRoleLabel(member.role)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!canEditAccess ? (
            <p className="inline-alert inline-alert-warning" style={{ marginTop: "0.9rem" }}>
              You can view team accounts, but only partner account can edit roles.
            </p>
          ) : (
            <form onSubmit={updateAccess} className="form-grid" style={{ marginTop: "0.9rem" }}>
              <div>
                <label className="label" htmlFor="edit-member">
                  Team Account
                </label>
                <select
                  id="edit-member"
                  className="input"
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  required
                >
                  <option value="">Choose account</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} ({member.email}) - {formatRoleLabel(member.role)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="edit-role">
                  Switch Role To
                </label>
                <select
                  id="edit-role"
                  className="input"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as TeamRole)}
                  required
                  disabled={!selectedMember}
                >
                  <option value="delegate">Delegate</option>
                  <option value="delegate_user">User</option>
                </select>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label className="label" htmlFor="edit-reason">
                  Reason For Change
                </label>
                <textarea
                  id="edit-reason"
                  className="input"
                  value={updateReason}
                  minLength={5}
                  maxLength={280}
                  rows={3}
                  onChange={(e) => setUpdateReason(e.target.value)}
                  placeholder="Write why this role switch is needed"
                  required
                />
              </div>

              {selectedMember ? (
                <p className="block-subtitle" style={{ marginTop: 0 }}>
                  Current role: {formatRoleLabel(selectedMember.role)}
                </p>
              ) : null}

              <button className="btn btn-primary" type="submit" disabled={updatingAccess || !selectedMember}>
                {updatingAccess ? "Saving..." : "Save Access Change"}
              </button>
            </form>
          )}
        </BlockCard>
      ) : null}
    </PortalFrame>
  );
}
