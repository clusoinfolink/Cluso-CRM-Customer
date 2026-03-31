"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  ClipboardPlus,
  Layers3,
  ListChecks,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard } from "@/components/ui/blocks";
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import { useRequestsData } from "@/lib/hooks/useRequestsData";

type CountCard = {
  label: string;
  value: number;
  tone: string;
  icon: LucideIcon;
  href: string;
};

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
      await refreshRequests(false);
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
  const cards: CountCard[] = [
    { label: "Pending", value: pendingCount, tone: "portal-stat-sky", icon: ClipboardPlus, href: "/dashboard/requests" },
    { label: "Approved", value: approvedCount, tone: "portal-stat-emerald", icon: BadgeCheck, href: "/dashboard/requests" },
    { label: "Rejected", value: rejectedCount, tone: "portal-stat-rose", icon: TriangleAlert, href: "/dashboard/requests" },
    { label: "Total", value: items.length, tone: "portal-stat-violet", icon: Layers3, href: "/dashboard/requests" },
  ];

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Partner Overview"
      subtitle="Use quick actions to complete one task at a time with less clutter."
    >
      {rejectedCount > 0 ? (
        <p className="inline-alert inline-alert-warning">
          {rejectedCount} rejected request{rejectedCount > 1 ? "s" : ""} need attention. Open Requests to review and resubmit.
        </p>
      ) : null}

      <section className="portal-stats-grid" aria-label="Request overview">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className={`portal-stat portal-stat-link ${card.tone}`}
              aria-label={`Open ${card.label.toLowerCase()} requests`}
            >
              <div className="portal-stat-head">
                <p className="portal-stat-value">{card.value}</p>
                <span className="portal-stat-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
              </div>
              <p className="portal-stat-label">{card.label}</p>
            </Link>
          );
        })}
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

    </PortalFrame>
  );
}
