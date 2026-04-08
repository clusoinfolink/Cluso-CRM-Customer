"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { UserPlus, Users, Shield, AlertCircle } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";

type TeamRole = "delegate" | "delegate_user";
type AccessAction = "switch_role" | "deactivate";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  isActive: boolean;
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

  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userParentDelegateId, setUserParentDelegateId] = useState("");
  const [submittingUser, setSubmittingUser] = useState(false);

  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [accessAction, setAccessAction] = useState<AccessAction>("switch_role");
  const [targetRole, setTargetRole] = useState<TeamRole>("delegate");
  const [updateReason, setUpdateReason] = useState("");
  const [updatingAccess, setUpdatingAccess] = useState(false);

  const canCreateUsers = me?.role === "customer" || me?.role === "delegate";
  const canViewUsers =
    me?.role === "customer" || me?.role === "delegate" || me?.role === "delegate_user";
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

    if (selected.isActive === false) {
      setTargetRole(selected.role);
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

  const teamRosterSubtitle =
    me.role === "customer"
      ? "Manage and view all registered delegate accounts underneath your organization."
      : "View all users registered under your delegate account.";
  const emptyTeamText =
    me.role === "customer"
      ? "You have not added any delegate logins yet."
      : "No users are registered under this delegate yet.";

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

  async function createUserByAdmin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");

    if (!userParentDelegateId) {
      setMessage("Please select a delegate to assign this user to.");
      return;
    }

    setSubmittingUser(true);

    const res = await fetch("/api/delegates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: userName,
        email: userEmail,
        password: userPassword,
        roleToCreate: "delegate_user",
        parentDelegateId: userParentDelegateId,
      }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setSubmittingUser(false);

    if (!res.ok) {
      setMessage(data.error ?? "Could not create user.");
      return;
    }

    setUserName("");
    setUserEmail("");
    setUserPassword("");
    setUserParentDelegateId("");
    setMessage(data.message ?? "User created successfully.");
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

    if (accessAction === "deactivate" && selectedMember?.isActive === false) {
      setMessage("Selected account is already deactivated.");
      return;
    }

    setUpdatingAccess(true);

    const payload: {
      userId: string;
      action: AccessAction;
      reason: string;
      targetRole?: TeamRole;
    } = {
      userId: selectedMemberId,
      action: accessAction,
      reason: updateReason.trim(),
    };

    if (accessAction === "switch_role") {
      payload.targetRole = targetRole;
    }

    const res = await fetch("/api/delegates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setUpdatingAccess(false);

    if (!res.ok) {
      setMessage(data.error ?? "Could not update team access.");
      return;
    }

    setMessage(data.message ?? "Team access updated.");
    setUpdateReason("");
    setAccessAction("switch_role");
    await loadTeamMembers();
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Team Workspace"
      subtitle="Manage delegate or user logins, including role switch and deactivation."
    >
      {message ? <p className={`inline-alert ${getAlertTone(message)} mb-6`}>{message}</p> : null}

      <div className="flex flex-col gap-6 w-full">
        {/* Top Forms Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 w-full items-stretch">
          {!canCreateUsers ? (
            <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-orange-800 text-sm lg:col-span-2 xl:col-span-3">
              Your role cannot create users. Contact your enterprise administrator for access.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col h-full">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex-none">
                <h2 style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <UserPlus className="w-4 h-4 text-blue-600" />
                  {me.role === "customer" ? "Create Delegate Login" : "Create User Login"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {me.role === "customer"
                    ? "Create sub-logins for delegates."
                    : "Create users with delegate permissions."}
                </p>
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <form onSubmit={createDelegate} className="flex flex-col gap-4 flex-1">
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="team-name">
                      {me.role === "customer" ? "Delegate Name" : "User Name"}
                    </label>
                    <input
                      id="team-name"
                      placeholder={me.role === "customer" ? "Enter delegate's full name" : "Enter user's full name"}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm outline-none placeholder:text-slate-400"
                      value={delegateName}
                      onChange={(e) => setDelegateName(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="team-email">
                      {me.role === "customer" ? "Delegate Email" : "User Email"}
                    </label>
                    <input
                      id="team-email"
                      placeholder={me.role === "customer" ? "delegate@example.com" : "user@example.com"}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm outline-none placeholder:text-slate-400"
                      type="email"
                      value={delegateEmail}
                      onChange={(e) => setDelegateEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="team-password">
                      {me.role === "customer" ? "Delegate Password" : "User Password"}
                    </label>
                    <input
                      id="team-password"
                      placeholder="Minimum 6 characters"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm outline-none placeholder:text-slate-400"
                      type="password"
                      minLength={6}
                      value={delegatePassword}
                      onChange={(e) => setDelegatePassword(e.target.value)}
                      required
                    />
                  </div>

                  <button className="w-full mt-auto bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm shadow-md shadow-blue-500/20" type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : me.role === "customer" ? "Create Delegate" : "Create User"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {me.role === "customer" && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col h-full">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex-none">
                <h2 style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <UserPlus className="w-4 h-4 text-emerald-600" />
                  Create User (By Admin)
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Create a user login assigned to a specific delegate.
                </p>
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <form onSubmit={createUserByAdmin} className="flex flex-col gap-4 flex-1">
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="user-parent">
                      Assign to Delegate
                    </label>
                    <select
                      id="user-parent"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm outline-none"
                      value={userParentDelegateId}
                      onChange={(e) => setUserParentDelegateId(e.target.value)}
                      required
                    >
                      <option value="">Select Delegate...</option>
                      {teamMembers
                        .filter(member => member.role === "delegate")
                        .map(member => (
                          <option key={member.id} value={member.id}>
                            {member.name} ({member.email})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="user-name">
                      User Name
                    </label>
                    <input
                      id="user-name"
                      placeholder="Enter user's full name"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm outline-none placeholder:text-slate-400"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="user-email">
                      User Email
                    </label>
                    <input
                      id="user-email"
                      placeholder="user@example.com"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm outline-none placeholder:text-slate-400"
                      type="email"
                      value={userEmail}
                      onChange={(e) => setUserEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="user-password">
                      User Password
                    </label>
                    <input
                      id="user-password"
                      placeholder="Minimum 6 characters"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm outline-none placeholder:text-slate-400"
                      type="password"
                      minLength={6}
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                      required
                    />
                  </div>

                  <button className="w-full mt-auto bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm shadow-md shadow-emerald-500/20" type="submit" disabled={submittingUser}>
                    {submittingUser ? "Creating..." : "Create User"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {canViewUsers && canEditAccess ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col h-full">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex-none">
                <h2 style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <Shield className="w-4 h-4 text-blue-600" />
                  Modify Team Access
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Change roles or deactivate existing team accounts securely.
                </p>
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <form onSubmit={updateAccess} className="flex flex-col gap-4 flex-1">
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="edit-member">
                      Team Account
                    </label>
                    <select
                      id="edit-member"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm outline-none"
                      value={selectedMemberId}
                      onChange={(e) => setSelectedMemberId(e.target.value)}
                      required
                    >
                      <option value="">Choose account</option>
                      {teamMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name} ({member.email}) &mdash; {formatRoleLabel(member.role)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="edit-action">
                      Access Action
                    </label>
                    <select
                      id="edit-action"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm outline-none"
                      value={accessAction}
                      onChange={(e) => setAccessAction(e.target.value as AccessAction)}
                      required
                      disabled={!selectedMember}
                    >
                      <option value="switch_role">Switch Role</option>
                      <option value="deactivate">Deactivate Account</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="edit-role">
                      Target Role
                    </label>
                    <select
                      id="edit-role"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm outline-none disabled:opacity-60"
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value as TeamRole)}
                      required
                      disabled={!selectedMember || accessAction !== "switch_role"}
                    >
                      <option value="delegate">Delegate</option>
                      <option value="delegate_user">User</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5" htmlFor="edit-reason">
                      {accessAction === "deactivate" ? "Reason For Deactivation" : "Reason For Change"}
                    </label>
                    <textarea
                      id="edit-reason"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm outline-none resize-none placeholder:text-slate-400"
                      value={updateReason}
                      minLength={5}
                      maxLength={280}
                      rows={3}
                      onChange={(e) => setUpdateReason(e.target.value)}
                      placeholder={
                        accessAction === "deactivate"
                          ? "Explain why this account is being deactivated..."
                          : "Explain why this role switch is needed..."
                      }
                      required
                    />
                  </div>

                  {selectedMember && selectedMember.isActive === false ? (
                    <div className="flex gap-2 items-start bg-orange-50 text-orange-800 p-3 rounded-lg border border-orange-100 mt-1">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-orange-600" />
                      <p className="text-xs leading-relaxed">
                        This account is currently deactivated. Use the <strong>Switch Role</strong> action to reactivate it.
                      </p>
                    </div>
                  ) : null}

                  <button
                    className="w-full mt-3 bg-slate-800 hover:bg-slate-900 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm shadow-md shadow-slate-800/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    type="submit"
                    disabled={
                      updatingAccess ||
                      !selectedMember ||
                      (accessAction === "deactivate" && selectedMember.isActive === false)
                    }
                  >
                    {updatingAccess
                      ? "Saving..."
                      : accessAction === "deactivate"
                        ? "Deactivate Account"
                        : "Save Access Change"}
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </div>

        {/* Bottom Full-Width Content (Table) */}
        <div className="w-full">
          {canViewUsers ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
              <div className="px-6 py-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <Users className="w-5 h-5 text-blue-600" />
                    Team Roster
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {teamRosterSubtitle}
                  </p>
                </div>
              </div>

              {membersLoading ? (
                <div className="p-10 flex flex-col items-center justify-center text-slate-500 gap-3">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm">Loading team members...</p>
                </div>
              ) : teamMembers.length === 0 ? (
                <div className="p-12 text-center flex flex-col items-center">
                  <Users className="w-12 h-12 text-slate-300 mb-3" />
                  <p className="text-slate-600 font-medium">No accounts found</p>
                  <p className="text-sm text-slate-400 mt-1">{emptyTeamText}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50/50 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-4 font-semibold tracking-wider">Account Member</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Role</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                        {canEditAccess && <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {teamMembers.map((member) => (
                        <tr key={member.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900">{member.name}</div>
                            <div className="text-slate-500 text-xs mt-0.5">{member.email}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                              {formatRoleLabel(member.role)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${
                                member.isActive
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-orange-50 text-orange-700 border-orange-200"
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${member.isActive ? "bg-emerald-500" : "bg-orange-500"}`}></span>
                              {member.isActive ? "Active" : "Deactivated"}
                            </span>
                          </td>
                          {canEditAccess && (
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => {
                                  setSelectedMemberId(member.id);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="text-blue-600 hover:text-blue-800 font-medium text-xs bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded transition-colors cursor-pointer"
                              >
                                Edit Settings
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
          
          {canViewUsers && !canEditAccess && (
            <p className="inline-alert inline-alert-warning mt-4 text-sm bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-xl">
              You can view team accounts, but only enterprise administrators can edit roles or deactivate users.
            </p>
          )}
        </div>
      </div>
    </PortalFrame>
  );
}
