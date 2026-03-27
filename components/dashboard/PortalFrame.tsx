"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, LogOut, Settings, Sparkles } from "lucide-react";
import { ReactNode } from "react";
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

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/requests", label: "Requests" },
  { href: "/dashboard/team", label: "Team" },
  { href: "/dashboard/settings", label: "Settings" },
];

function isNavActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname.startsWith(href);
}

export function PortalFrame({ me, onLogout, title, subtitle, children }: PortalFrameProps) {
  const pathname = usePathname();

  return (
    <main className="portal-shell">
      <div className="dashboard-stack">
        <BlockCard tone="accent" className="portal-banner" interactive>
          <div className="portal-banner-content">
            <span className="portal-banner-icon" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <strong>{title}</strong>
              <div className="block-subtitle">{subtitle}</div>
            </div>
          </div>
          <div className="portal-banner-tag">
            <BellRing size={14} />
            Live status updates
          </div>
        </BlockCard>

        <BlockCard className="account-strip" interactive>
          <div>
            <strong>{me.name}</strong>
            <div className="role-meta">
              {me.email} ({me.role})
            </div>
          </div>

          <div className="account-actions-wrap">
            <Link href="/dashboard/settings" className="btn btn-ghost title-with-icon" aria-label="Open account settings">
              <Settings size={16} />
              Settings
            </Link>
            <button className="btn btn-secondary title-with-icon" onClick={onLogout} type="button">
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </BlockCard>

        <nav className="portal-nav" aria-label="Portal sections">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`portal-nav-link ${isNavActive(pathname, item.href) ? "active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {children}
      </div>
    </main>
  );
}
