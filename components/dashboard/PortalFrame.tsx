"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CheckCheck,
  Clipboard,
  ListChecks,
  MoreHorizontal,
  LogOut,
  Settings,
  LayoutDashboard,
  ReceiptText,
  User,
  type LucideIcon,
} from "lucide-react";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PortalUser, RequestItem } from "@/lib/types";

type PortalFrameProps = {
  me: PortalUser;
  onLogout: () => void | Promise<void>;
  title: string;
  subtitle: string;
  children: ReactNode;
};

type NavItem = {
  href: string;
  label: string;
};

type IconNavItem = NavItem & { icon: LucideIcon };

const navItems: IconNavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/orders", label: "Orders", icon: Clipboard },
  { href: "/dashboard/requests", label: "Requests", icon: ListChecks },
  { href: "/dashboard/invoices", label: "Invoices", icon: ReceiptText },
  { href: "/dashboard/team", label: "Team", icon: ListChecks },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const REQUESTS_QUERY_KEY = ["customer-requests"];
const REQUESTS_STALE_TIME_MS = 5 * 60 * 1000;

type NotificationItem = {
  id: string;
  requestId: string;
  title: string;
  detail: string;
  status: RequestItem["status"];
  createdAtMs: number;
};

async function fetchRequestsForNotifications() {
  const response = await fetch("/api/orders", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load requests.");
  }

  const data = (await response.json()) as { items?: RequestItem[] };
  return data.items ?? [];
}

function getCustomerNotificationContent(item: RequestItem) {
  const appeal = item.reverificationAppeal;
  if (appeal) {
    const appealedServiceNames = (appeal.services ?? [])
      .map((service) => service.serviceName)
      .filter((name) => typeof name === "string" && name.trim().length > 0);
    if (appealedServiceNames.length === 0 && appeal.serviceName?.trim()) {
      appealedServiceNames.push(appeal.serviceName.trim());
    }
    const appealedServicesLabel = appealedServiceNames.length > 0 ? appealedServiceNames.join(", ") : "requested services";

    if (appeal.status === "open") {
      return {
        title: "Reverification appeal submitted",
        detail: `${item.candidateName} was appealed for ${appealedServicesLabel}`,
      };
    }

    if (appeal.status === "resolved") {
      const resolvedSource = appeal.resolvedAt || item.reportMetadata?.customerSharedAt || "";
      const parsedResolvedAt = Date.parse(resolvedSource);
      const resolvedDateLabel = Number.isNaN(parsedResolvedAt)
        ? ""
        : new Date(parsedResolvedAt).toLocaleDateString("en-IN");

      return {
        title: "Request reverified",
        detail: resolvedDateLabel
          ? `${item.candidateName} was reverified for ${appealedServicesLabel} on ${resolvedDateLabel}`
          : `${item.candidateName} was reverified for ${appealedServicesLabel}`,
      };
    }
  }

  if (item.status === "verified") {
    return {
      title: "Request verified",
      detail: `${item.candidateName} verification is now verified`,
    };
  }

  if (item.status === "approved") {
    return {
      title: "Request approved by enterprise",
      detail: `${item.candidateName} verification was approved by enterprise`,
    };
  }

  if (item.status === "rejected") {
    const rejectionReason = item.rejectionNote ? ` - ${item.rejectionNote}` : "";
    return {
      title: "Request rejected by enterprise",
      detail: `${item.candidateName}${rejectionReason}`,
    };
  }

  return {
    title: "New request created",
    detail: `${item.candidateName} is waiting for review`,
  };
}

function isNavActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname.startsWith(href);
}

export function PortalFrame({ me, onLogout, title, subtitle, children }: PortalFrameProps) {
  const pathname = usePathname();
  const router = useRouter();
  const visibleNav = navItems;
  const notificationWrapRef = useRef<HTMLDivElement | null>(null);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [clearedNotificationIds, setClearedNotificationIds] = useState<string[]>([]);

  const requestsQuery = useQuery<RequestItem[]>({
    queryKey: REQUESTS_QUERY_KEY,
    queryFn: fetchRequestsForNotifications,
    staleTime: REQUESTS_STALE_TIME_MS,
    enabled: Boolean(me.id),
    refetchInterval: 60 * 1000,
  });

  const notificationStorageKey = useMemo(
    () => `cluso-customer-cleared-notifications:${me.id}`,
    [me.id],
  );

  const notifications = useMemo<NotificationItem[]>(() => {
    return (requestsQuery.data ?? [])
      .map((item) => {
        const parsedCreatedAt = Date.parse(item.createdAt);
        const requestCreatedAtMs = Number.isNaN(parsedCreatedAt) ? 0 : parsedCreatedAt;
        const parsedAppealEventAt =
          item.reverificationAppeal?.status === "open"
            ? Date.parse(item.reverificationAppeal.submittedAt)
            : item.reverificationAppeal?.status === "resolved"
              ? Date.parse(item.reverificationAppeal.resolvedAt || item.reportMetadata?.customerSharedAt || "")
              : Number.NaN;
        const createdAtMs = Number.isNaN(parsedAppealEventAt) ? requestCreatedAtMs : parsedAppealEventAt;
        const content = getCustomerNotificationContent(item);
        const appealKey = item.reverificationAppeal
          ? `${item.reverificationAppeal.status}:${item.reverificationAppeal.submittedAt}:${item.reverificationAppeal.resolvedAt ?? ""}:${item.reportMetadata?.customerSharedAt ?? ""}`
          : "none";

        return {
          id: `${item._id}:${item.status}:${appealKey}`,
          requestId: item._id,
          title: content.title,
          detail: content.detail,
          status: item.status,
          createdAtMs,
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [requestsQuery.data]);

  const persistClearedNotifications = useCallback(
    (ids: string[]) => {
      try {
        localStorage.setItem(notificationStorageKey, JSON.stringify(ids));
      } catch {
        // Ignore storage write errors and keep in-memory state.
      }
    },
    [notificationStorageKey],
  );

  useEffect(() => {
    let nextClearedIds: string[] = [];

    try {
      const storedValue = localStorage.getItem(notificationStorageKey);
      if (!storedValue) {
        nextClearedIds = [];
      } else {
        const parsed = JSON.parse(storedValue);
        if (!Array.isArray(parsed)) {
          nextClearedIds = [];
        } else {
          nextClearedIds = parsed.filter((item): item is string => typeof item === "string");
        }
      }
    } catch {
      nextClearedIds = [];
    }

    const timer = window.setTimeout(() => {
      setClearedNotificationIds(nextClearedIds);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notificationStorageKey]);

  useEffect(() => {
    if (!isNotificationOpen) {
      return;
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!notificationWrapRef.current?.contains(target)) {
        setIsNotificationOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsNotificationOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isNotificationOpen]);

  const clearedSet = useMemo(() => new Set(clearedNotificationIds), [clearedNotificationIds]);

  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !clearedSet.has(item.id)),
    [clearedSet, notifications],
  );

  const clearNotification = useCallback(
    (id: string) => {
      setClearedNotificationIds((prev) => {
        if (prev.includes(id)) {
          return prev;
        }

        const next = [...prev, id];
        persistClearedNotifications(next);
        return next;
      });
    },
    [persistClearedNotifications],
  );

  const clearAllNotifications = useCallback(() => {
    const next = notifications.map((item) => item.id);
    setClearedNotificationIds(next);
    persistClearedNotifications(next);
  }, [notifications, persistClearedNotifications]);

  const openRequestFromNotification = useCallback(
    (requestId: string) => {
      setIsNotificationOpen(false);
      router.push(`/dashboard/requests?requestId=${encodeURIComponent(requestId)}`);
    },
    [router, setIsNotificationOpen],
  );

  return (
    <div className="admin-layout">
      <aside
        id="customer-mobile-nav"
        className={`admin-sidebar ${isMobileNavOpen ? "mobile-open" : ""}`}
        aria-label="Portal navigation menu"
      >
        <div className="sidebar-brand flex items-center justify-center p-4">
          <Image
            src="/images/cluso-infolink-logo.png"
            alt="Cluso Infolink"
            width={220}
            height={40}
            className="h-10 w-auto object-contain"
            priority
          />
        </div>

        <nav className="portal-nav" aria-label="Portal sections">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileNavOpen(false)}
                className={`portal-nav-link ${isNavActive(pathname, item.href) ? "active" : ""}`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {isMobileNavOpen ? (
        <button
          type="button"
          className="portal-mobile-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setIsMobileNavOpen(false)}
        />
      ) : null}

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="portal-topbar-leading" style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
            <button
              type="button"
              className="portal-nav-overflow-trigger"
              onClick={() => setIsMobileNavOpen((prev) => !prev)}
              aria-label="More options"
              aria-expanded={isMobileNavOpen}
              aria-controls="customer-mobile-nav"
            >
              <MoreHorizontal size={18} />
            </button>
            <div style={{ display: "grid", gap: "0.15rem" }}>
              <h1 className="admin-topbar-title">{title || "Enterprise Panel"}</h1>
              {subtitle ? (
                <p style={{ margin: 0, color: "#6B7A90", fontSize: "0.85rem" }}>{subtitle}</p>
              ) : null}
            </div>
          </div>
          <div className="account-actions-wrap">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 500 }}>
              <User size={18} />
              {me.name}
            </div>
            <div ref={notificationWrapRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setIsNotificationOpen((prev) => !prev)}
                aria-expanded={isNotificationOpen}
                aria-haspopup="dialog"
                aria-label={`Notifications (${unreadNotifications.length} unread)`}
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "2.2rem",
                  height: "2.2rem",
                  borderRadius: "999px",
                  border: "1px solid #D7DDE5",
                  background: "#FFFFFF",
                  color: "#2D405E",
                  cursor: "pointer",
                }}
              >
                <Bell size={16} />
                {unreadNotifications.length > 0 ? (
                  <span
                    style={{
                      position: "absolute",
                      top: "-0.3rem",
                      right: "-0.3rem",
                      minWidth: "1.1rem",
                      height: "1.1rem",
                      borderRadius: "999px",
                      background: "#DC3545",
                      color: "#FFFFFF",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      padding: "0 0.2rem",
                    }}
                  >
                    {unreadNotifications.length > 99 ? "99+" : unreadNotifications.length}
                  </span>
                ) : null}
              </button>

              {isNotificationOpen ? (
                <div
                  role="dialog"
                  aria-label="Notifications"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 0.5rem)",
                    right: 0,
                    width: "min(24rem, calc(100vw - 2rem))",
                    maxHeight: "22rem",
                    overflow: "hidden",
                    border: "1px solid #D7DDE5",
                    borderRadius: "12px",
                    background: "#FFFFFF",
                    boxShadow: "0 14px 30px rgba(45, 64, 94, 0.18)",
                    zIndex: 30,
                    display: "grid",
                    gridTemplateRows: "auto 1fr",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.7rem 0.85rem",
                      borderBottom: "1px solid #E6ECF3",
                    }}
                  >
                    <strong style={{ color: "#2D405E" }}>Notifications</strong>
                    {unreadNotifications.length > 0 ? (
                      <button
                        type="button"
                        onClick={clearAllNotifications}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#2D405E",
                          cursor: "pointer",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                        }}
                      >
                        <CheckCheck size={14} />
                        Clear all
                      </button>
                    ) : null}
                  </div>

                  <div style={{ overflowY: "auto", padding: "0.75rem", display: "grid", gap: "0.6rem" }}>
                    {requestsQuery.isLoading ? (
                      <p style={{ margin: 0, color: "#6B7A90" }}>Loading activity...</p>
                    ) : unreadNotifications.length === 0 ? (
                      <p style={{ margin: 0, color: "#6B7A90" }}>No new activity.</p>
                    ) : (
                      unreadNotifications.map((notification) => {
                        const tone =
                          notification.status === "verified"
                            ? { border: "#9DDCCB", background: "#E8F8F3" }
                            : notification.status === "approved"
                            ? { border: "#BFE8C9", background: "#ECF8EF" }
                            : notification.status === "rejected"
                              ? { border: "#F5C2C7", background: "#FDF2F3" }
                              : { border: "#C4D9F8", background: "#EEF4FF" };

                        return (
                          <article
                            key={notification.id}
                            style={{
                              border: `1px solid ${tone.border}`,
                              background: tone.background,
                              borderRadius: "10px",
                              padding: "0.6rem 0.65rem",
                              display: "grid",
                              gap: "0.3rem",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "0.5rem",
                              }}
                            >
                              <strong style={{ color: "#2D405E", fontSize: "0.9rem" }}>
                                {notification.title}
                              </strong>
                              <button
                                type="button"
                                onClick={() => clearNotification(notification.id)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#2D405E",
                                  cursor: "pointer",
                                  fontSize: "0.8rem",
                                  fontWeight: 600,
                                  padding: 0,
                                }}
                              >
                                Clear
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => openRequestFromNotification(notification.requestId)}
                              style={{
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                textAlign: "left",
                                display: "grid",
                                gap: "0.25rem",
                                cursor: "pointer",
                                color: "inherit",
                              }}
                            >
                              <span style={{ color: "#44536A", fontSize: "0.84rem" }}>{notification.detail}</span>
                              <span style={{ color: "#667892", fontSize: "0.77rem" }}>
                                {notification.createdAtMs > 0
                                  ? new Date(notification.createdAtMs).toLocaleString()
                                  : "Unknown time"}
                              </span>
                            </button>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <button onClick={onLogout} className="logout-btn" type="button">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </header>

        <div className="portal-shell">
          <div className="dashboard-stack">{children}</div>
        </div>
      </main>
    </div>
  );
}
