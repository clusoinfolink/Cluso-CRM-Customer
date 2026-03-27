"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardPlus, ListChecks, ShieldAlert, UserPlus } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import { useRequestsData } from "@/lib/hooks/useRequestsData";

export default function DashboardOverviewPage() {
  const { me, loading, logout } = usePortalSession();
  const { items, loading: requestsLoading, refreshRequests } = useRequestsData();
  const [requestsReady, setRequestsReady] = useState(false);

  useEffect(() => {
    if (!me) {
      return;
    }

    let active = true;

    (async () => {
      await refreshRequests();
      if (active) {
        setRequestsReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [me, refreshRequests]);

  if (loading || requestsLoading || !me || !requestsReady) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading your workspace...</p>
        </BlockCard>
      </main>
    );
  }

  const pendingCount = items.filter((item) => item.status === "pending").length;
  const approvedCount = items.filter((item) => item.status === "approved").length;
  const rejectedCount = items.filter((item) => item.status === "rejected").length;
  const recentItems = [...items]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Customer Overview"
      subtitle="Use quick actions to complete one task at a time with less clutter."
    >
      {rejectedCount > 0 ? (
        <p className="inline-alert inline-alert-warning">
          {rejectedCount} rejected request{rejectedCount > 1 ? "s" : ""} need attention. Open Requests to review and resubmit.
        </p>
      ) : null}

      <section className="portal-stats-grid" aria-label="Request overview">
        <article className="portal-stat">
          <p className="portal-stat-label">Pending</p>
          <p className="portal-stat-value">{pendingCount}</p>
        </article>
        <article className="portal-stat">
          <p className="portal-stat-label">Approved</p>
          <p className="portal-stat-value">{approvedCount}</p>
        </article>
        <article className="portal-stat">
          <p className="portal-stat-label">Rejected</p>
          <p className="portal-stat-value">{rejectedCount}</p>
        </article>
        <article className="portal-stat">
          <p className="portal-stat-label">Total</p>
          <p className="portal-stat-value">{items.length}</p>
        </article>
      </section>

      <section className="quick-actions-grid" aria-label="Quick actions">
        <Link href="/dashboard/orders" className="quick-action-card" aria-label="Go to orders">
          <div className="quick-action-head">
            <span className="icon-chip" aria-hidden="true">
              <ClipboardPlus size={14} />
            </span>
            <strong>Create New Order</strong>
          </div>
          <p className="block-subtitle">Submit candidate verification requests with assigned services.</p>
          <span className="quick-action-link">
            Open Orders
            <ArrowRight size={14} />
          </span>
        </Link>

        <Link href="/dashboard/requests" className="quick-action-card" aria-label="Go to requests">
          <div className="quick-action-head">
            <span className="icon-chip" aria-hidden="true">
              <ListChecks size={14} />
            </span>
            <strong>Review Requests</strong>
          </div>
          <p className="block-subtitle">Track pending, approved, and rejected items with a focused request view.</p>
          <span className="quick-action-link">
            Open Requests
            <ArrowRight size={14} />
          </span>
        </Link>

        <Link href="/dashboard/team" className="quick-action-card" aria-label="Go to team">
          <div className="quick-action-head">
            <span className="icon-chip" aria-hidden="true">
              <UserPlus size={14} />
            </span>
            <strong>Manage Team Access</strong>
          </div>
          <p className="block-subtitle">Create delegate or user accounts without leaving this workspace.</p>
          <span className="quick-action-link">
            Open Team
            <ArrowRight size={14} />
          </span>
        </Link>
      </section>

      <BlockCard interactive>
        <BlockTitle
          icon={<ShieldAlert size={14} />}
          title="Latest Activity"
          subtitle="Most recent request entries for quick visibility."
        />

        {recentItems.length === 0 ? (
          <p className="block-subtitle">No requests yet. Start by creating your first order.</p>
        ) : (
          <div className="recent-request-list">
            {recentItems.map((item) => (
              <article key={item._id} className="recent-request-item">
                <div>
                  <strong>{item.candidateName}</strong>
                  <p className="block-subtitle recent-request-meta">{item.candidateEmail}</p>
                </div>
                <div className="recent-request-right">
                  <span className={`status-pill status-pill-${item.status}`} style={{ textTransform: "capitalize" }}>
                    {item.status}
                  </span>
                  <span className="recent-request-meta">{new Date(item.createdAt).toLocaleDateString()}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </BlockCard>
    </PortalFrame>
  );
}
