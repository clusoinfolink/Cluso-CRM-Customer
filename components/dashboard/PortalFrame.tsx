"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BellRing,
  Clipboard,
  ListChecks,
  LogOut,
  Settings,
  Sparkles,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PortalUser } from "@/lib/types";
import { BlockCard } from "@/components/ui/blocks";

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
  { href: "/dashboard/team", label: "Team", icon: ListChecks },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const PREFETCH_ROUTES = new Set(["/dashboard/orders", "/dashboard/requests"]);

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

  const prefetchNavRoute = useCallback((href: string) => {
    if (!PREFETCH_ROUTES.has(href)) {
      return;
    }

    router.prefetch(href);
  }, [router]);

  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationsSeen, setNotificationsSeen] = useState(false);
  const notificationPanelRef = useRef<HTMLDivElement>(null);

  const notificationItems = useMemo(
    () => [
      { id: "order", title: "Order Received", detail: "A new verification order was received." },
      { id: "note", title: "Admin Note", detail: "A request needs additional details." },
    ],
    [],
  );

  const unreadCount = notificationsSeen ? 0 : notificationItems.length;

  useEffect(() => {
    if (!notificationOpen) return;

    function handlePointerDown(e: PointerEvent) {
      if (!notificationPanelRef.current) return;
      if (!notificationPanelRef.current.contains(e.target as Node)) setNotificationOpen(false);
    }

    function handleKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") setNotificationOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationOpen]);

  return (
    <main className="portal-shell">
      <div className="admin-layout">
        <aside className="glass-card admin-sidebar" aria-label="Portal navigation menu">
          <div className="sidebar-brand">
            <span className="portal-banner-icon" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <strong>Cluso</strong>
              <p>Partner portal</p>
            </div>
          </div>

          <nav className="portal-nav" aria-label="Portal sections">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`portal-nav-link ${isNavActive(pathname, item.href) ? "active" : ""}`}
                  onMouseEnter={() => prefetchNavRoute(item.href)}
                  onFocus={() => prefetchNavRoute(item.href)}
                  onClick={() => prefetchNavRoute(item.href)}
                >
                  <span className="portal-nav-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="sidebar-footer-chip">
            <BellRing size={14} />
            Live status
          </div>
        </aside>

        <section className="admin-main">
          <header className="glass-card admin-topbar">
            <div className="admin-topbar-copy">
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>

            <div className="account-actions-wrap">
              <div className="notification-wrap" ref={notificationPanelRef}>
                <button
                  type="button"
                  className={`notification-bell ${notificationOpen ? "active" : ""}`}
                  aria-label="Open notifications"
                  aria-haspopup="dialog"
                  aria-expanded={notificationOpen}
                  aria-controls="portal-notifications-panel"
                  onClick={() => {
                    setNotificationOpen((prev) => {
                      const nextOpen = !prev;
                      if (nextOpen) setNotificationsSeen(true);
                      return nextOpen;
                    });
                  }}
                >
                  <Bell size={18} />
                  {unreadCount > 0 ? <span className="notification-badge">{unreadCount}</span> : null}
                </button>

                {notificationOpen ? (
                  <section id="portal-notifications-panel" className="glass-card notification-panel" role="dialog">
                    <div className="notification-panel-head">
                      <strong>Notifications</strong>
                      <span>{notificationItems.length} updates</span>
                    </div>
                    <ul className="notification-list">
                      {notificationItems.map((item) => (
                        <li key={item.id} className="notification-item">
                          <span className="notification-item-dot" aria-hidden="true" />
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.detail}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>

              <Link href="/dashboard/settings" className="btn btn-ghost title-with-icon" aria-label="Open settings">
                <Settings size={16} />
                Settings
              </Link>
              <button className="btn btn-secondary title-with-icon" onClick={onLogout} type="button">
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </header>

          <BlockCard tone="accent" className="portal-banner" interactive>
            <div className="portal-banner-content">
              <span className="portal-banner-icon" aria-hidden="true">
                <Sparkles size={16} />
              </span>
              <div>
                <strong>{me.name}</strong>
                <div className="block-subtitle">{me.email}</div>
              </div>
            </div>
            <div className="portal-banner-tag">
              <BellRing size={14} />
              Live status updates
            </div>
          </BlockCard>

          <div className="dashboard-stack">{children}</div>
        </section>
      </div>
    </main>
  );
}
