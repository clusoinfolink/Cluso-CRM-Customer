"use client";

import { useEffect, useState, useMemo } from "react";
import { AreaChart, Download, FileText, ReceiptText, TrendingUp, Calendar, FileSearch, Building, PieChart } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks"; 
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import { useRequestsData } from "@/lib/hooks/useRequestsData";
import { getAlertTone } from "@/lib/alerts";
import type { InvoiceRecord } from "@/lib/types";

const CHART_DAYS = 30;

type TimelinePoint = {
  date: string;
  count: number;
};

type InvoiceTotalWithGst = {
  currency: string;
  subtotal: number;
  gstAmount: number;
  total: number;
};

type MonthSummaryRow = {
  srNo: number;
  requestId: string;
  requestedAt: string;
  candidateName: string;
  requestStatus: string;
  serviceName: string;
  currency: string;
  priceWithoutGst: number;
  gstAmount: number;
  priceWithGst: number;
};

function clampGstRate(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 100) / 100;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function buildInvoiceTotalsWithGst(invoice: InvoiceRecord): InvoiceTotalWithGst[] {
  const gstRate = clampGstRate(invoice.gstRate);

  return invoice.totalsByCurrency.map((entry) => {
    const subtotal = roundMoney(entry.subtotal);
    const gstAmount = invoice.gstEnabled ? roundMoney((subtotal * gstRate) / 100) : 0;
    const total = roundMoney(subtotal + gstAmount);

    return {
      currency: entry.currency,
      subtotal,
      gstAmount,
      total,
    };
  });
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
}

function formatCurrencySymbol(currency: string) {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "INR",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);

    return parts.find((part) => part.type === "currency")?.value || (currency || "INR");
  } catch {
    return currency || "INR";
  }
}

function formatBillingMonth(monthStr: string) {
  if (!monthStr || monthStr.length !== 7) return monthStr;
  const [yyyy, mm] = monthStr.split("-");
  const d = new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, 1);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function formatBillingPeriod(monthStr: string) {
  if (!monthStr || monthStr.length !== 7) return monthStr;
  const [yyyy, mm] = monthStr.split("-");
  const d = new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, 1);
  const mName = d.toLocaleString("default", { month: "long" });
  return `01 ${mName} - ${new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0).getDate()} ${mName} ${yyyy}`;
}

function formatDateTime(isoString: string) {
  if (!isoString) return "-";
  return new Date(isoString).toLocaleString("default", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSummaryDate(isoString: string) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("default", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function TimelineChart({ points }: { points: TimelinePoint[] }) {
  if (!points || points.length === 0) {
    return (
      <p style={{ color: "#94A3B8", fontSize: "0.85rem", margin: "1rem 0" }}>
        No request attempts found.
      </p>
    );
  }

  const width = 360;
  const height = 140;
  const padding = { top: 14, right: 10, bottom: 26, left: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => point.count), 1);
  const stepX = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;

  const toX = (index: number) => padding.left + index * stepX;
  const toY = (value: number) => padding.top + chartHeight - (value / maxValue) * chartHeight;

  const pathData = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${toX(index)} ${toY(point.count)}`)
    .join(" ");

  const firstLabel = points[0]?.date ?? "";
  const lastLabel = points[points.length - 1]?.date ?? "";

  return (
    <div style={{ marginTop: "0.9rem" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "140px", display: "block" }}
        role="img"
        aria-label="Day-wise request attempts line graph"
      >
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#D9E2EC"
          strokeWidth={1}
        />

        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = padding.top + chartHeight * ratio;
          return (
            <line
              key={`grid-${ratio}`}
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#EEF2F7"
              strokeWidth={1}
            />
          );
        })}

        <path
          d={pathData}
          fill="none"
          stroke="#2563EB"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((point, index) => (
          <circle
            key={`${point.date}-${index}`}
            cx={toX(index)}
            cy={toY(point.count)}
            r={2.1}
            fill="#1D4ED8"
          >
            <title>{`${point.date}: ${point.count} attempts`}</title>
          </circle>
        ))}
      </svg>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "0.35rem",
          fontSize: "0.75rem",
          color: "#64748B",
        }}
      >
        <span>{firstLabel}</span>
        <span>Request attempts</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}

export default function CustomerInvoicesPage() {
  const { me, loading, logout } = usePortalSession();
  const { items: requestItems } = useRequestsData();
  const [message, setMessage] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedBillingMonth, setSelectedBillingMonth] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    if (me?.id) fetchInvoices();
  }, [me]);

  async function fetchInvoices() {
    try {
      const res = await fetch("/api/invoices");
      const data = (await res.json()) as { invoices?: InvoiceRecord[]; error?: string };
      if (!res.ok) {
        setMessage(data.error || "Failed to load invoices.");
        return;
      }

      setInvoices(data.invoices ?? []);
    } catch (err) {
      setMessage("Failed to load invoices.");
    }
  }

  async function downloadInvoicePdf(invoiceId: string) {
    if (!invoiceId) return;
    setDownloadingId(invoiceId);
    try {
      const resp = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/pdf`);
      if (!resp.ok) {
        setMessage("Failed to download PDF.");
        setDownloadingId(null);
        return;
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `Invoice_${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setMessage(e.message || "Error building PDF.");
    }
    setDownloadingId(null);
  }

  const filteredInvoices = useMemo(() => {
    if (!selectedBillingMonth) return invoices;
    return invoices.filter((i) => i.billingMonth === selectedBillingMonth);
  }, [invoices, selectedBillingMonth]);

  const selectedInvoice = useMemo(() => {
    return invoices.find((i) => i.id === selectedInvoiceId) || (filteredInvoices.length > 0 ? filteredInvoices[0] : null);
  }, [invoices, selectedInvoiceId, filteredInvoices]);

  const invoiceTotal = invoices.length;
  const requestTotal = invoices.reduce((acc, curr) => acc + (curr.lineItems?.reduce((sum, item) => sum + (item.usageCount || 0), 0) || 0), 0) || 0;

  const invoiceTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    invoices.forEach((inv) => {
      buildInvoiceTotalsWithGst(inv).forEach((row) => {
        totals[row.currency] = (totals[row.currency] || 0) + row.total;
      });
    });

    return Object.entries(totals)
      .map(([currency, total]) => ({ currency, total: roundMoney(total) }))
      .sort((first, second) => first.currency.localeCompare(second.currency));
  }, [invoices]);

  const totalAmountCardSymbol = useMemo(() => {
    if (invoiceTotals.length !== 1) {
      return "¤";
    }

    return formatCurrencySymbol(invoiceTotals[0].currency);
  }, [invoiceTotals]);

  const timelinePoints = useMemo<TimelinePoint[]>(() => {
    const attemptsByDay: Record<string, number> = {};

    requestItems.forEach((item) => {
      const createdAt = new Date(item.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        return;
      }

      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}-${String(createdAt.getDate()).padStart(2, "0")}`;
      attemptsByDay[key] = (attemptsByDay[key] || 0) + 1;
    });

    const pts: TimelinePoint[] = [];
    const now = new Date();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);

      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      pts.push({
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        count: attemptsByDay[key] || 0,
      });
    }

    return pts;
  }, [requestItems]);

  const billingMonths = useMemo(() => {
    const set = new Set(invoices.map(i => i.billingMonth).filter(Boolean));
    return Array.from(set).sort().reverse();
  }, [invoices]);

  const selectedInvoiceTotalsWithGst = useMemo(() => {
    if (!selectedInvoice) {
      return [] as InvoiceTotalWithGst[];
    }

    return buildInvoiceTotalsWithGst(selectedInvoice);
  }, [selectedInvoice]);

  const selectedMonthRequestRows = useMemo(() => {
    if (!selectedInvoice) {
      return [] as MonthSummaryRow[];
    }

    const gstRate = clampGstRate(selectedInvoice.gstRate);
    const invoiceRatesByServiceId = new Map<string, { serviceName: string; currency: string; price: number }>();
    const invoiceRatesByServiceName = new Map<string, { serviceName: string; currency: string; price: number }>();

    selectedInvoice.lineItems.forEach((lineItem) => {
      const serviceId = (lineItem.serviceId || "").trim();
      const serviceName = (lineItem.serviceName || "Service Not Available").trim();
      const serviceNameKey = serviceName.toLowerCase();
      const entry = {
        serviceName,
        currency: (lineItem.currency || "INR").toUpperCase(),
        price: roundMoney(Number(lineItem.price) || 0),
      };

      if (serviceId) {
        invoiceRatesByServiceId.set(serviceId, entry);
      }

      if (serviceNameKey && !invoiceRatesByServiceName.has(serviceNameKey)) {
        invoiceRatesByServiceName.set(serviceNameKey, entry);
      }
    });

    const [yearText, monthText] = selectedInvoice.billingMonth.split("-");
    const billingYear = Number.parseInt(yearText, 10);
    const billingMonthIndex = Number.parseInt(monthText, 10) - 1;

    if (!Number.isFinite(billingYear) || !Number.isFinite(billingMonthIndex)) {
      return [] as MonthSummaryRow[];
    }

    const monthRequests = requestItems
      .map((request) => {
        const generatedAt = new Date(request.reportMetadata?.generatedAt ?? "");
        const sharedAt = new Date(request.reportMetadata?.customerSharedAt ?? "");
        const requestDate = new Date(request.createdAt ?? "");

        const resolvedRequestDate = Number.isNaN(requestDate.getTime())
          ? sharedAt
          : requestDate;

        return {
          request,
          generatedAt,
          sharedAt,
          requestDate: resolvedRequestDate,
          hasGeneratedReport: !Number.isNaN(generatedAt.getTime()),
        };
      })
      .filter(({ hasGeneratedReport, sharedAt }) => {
        if (!hasGeneratedReport || Number.isNaN(sharedAt.getTime())) {
          return false;
        }

        return (
          sharedAt.getFullYear() === billingYear &&
          sharedAt.getMonth() === billingMonthIndex
        );
      })
      .sort((first, second) => first.requestDate.getTime() - second.requestDate.getTime());

    const rows: MonthSummaryRow[] = [];

    monthRequests.forEach(({ request, requestDate }) => {
      const selectedServices =
        request.selectedServices?.map((service) => ({
          serviceId: service.serviceId || "",
          serviceName: service.serviceName || "Unknown Service",
          currency: service.currency || request.invoiceSnapshot?.currency || "INR",
          price: roundMoney(Number(service.price) || 0),
        })) ?? [];

      const snapshotServices =
        request.invoiceSnapshot?.items?.map((service) => ({
          serviceId: service.serviceId || "",
          serviceName: service.serviceName || "Unknown Service",
          currency: request.invoiceSnapshot?.currency || "INR",
          price: roundMoney(Number(service.price) || 0),
        })) ?? [];

      const services = selectedServices.length > 0 ? selectedServices : snapshotServices;
      const normalizedServices = services.length > 0
        ? services
        : [{ serviceId: "", serviceName: "Service Not Available", currency: request.invoiceSnapshot?.currency || "INR", price: 0 }];

      normalizedServices.forEach((service) => {
        const normalizedServiceId = (service.serviceId || "").trim();
        const normalizedServiceName = (service.serviceName || "").trim().toLowerCase();
        const matchedInvoiceRate =
          (normalizedServiceId ? invoiceRatesByServiceId.get(normalizedServiceId) : undefined) ??
          invoiceRatesByServiceName.get(normalizedServiceName);

        const resolvedCurrency = (matchedInvoiceRate?.currency || service.currency || "INR").toUpperCase();
        const priceWithoutGst = roundMoney(Number(matchedInvoiceRate?.price ?? service.price) || 0);
        const gstAmount = selectedInvoice.gstEnabled
          ? roundMoney((priceWithoutGst * gstRate) / 100)
          : 0;

        rows.push({
          srNo: rows.length + 1,
          requestId: request._id,
          requestedAt: Number.isNaN(requestDate.getTime())
            ? ""
            : requestDate.toISOString(),
          candidateName: request.candidateName || "-",
          requestStatus: request.status || "pending",
          serviceName: matchedInvoiceRate?.serviceName || service.serviceName || "Service Not Available",
          currency: resolvedCurrency,
          priceWithoutGst,
          gstAmount,
          priceWithGst: roundMoney(priceWithoutGst + gstAmount),
        });
      });
    });

    return rows;
  }, [requestItems, selectedInvoice]);

  const selectedMonthRequestCount = useMemo(
    () => new Set(selectedMonthRequestRows.map((row) => row.requestId)).size,
    [selectedMonthRequestRows],
  );

  const selectedMonthSummaryTotals = useMemo(() => {
    const totals: Record<string, InvoiceTotalWithGst> = {};

    selectedMonthRequestRows.forEach((row) => {
      const existing = totals[row.currency];
      if (!existing) {
        totals[row.currency] = {
          currency: row.currency,
          subtotal: row.priceWithoutGst,
          gstAmount: row.gstAmount,
          total: row.priceWithGst,
        };
        return;
      }

      existing.subtotal = roundMoney(existing.subtotal + row.priceWithoutGst);
      existing.gstAmount = roundMoney(existing.gstAmount + row.gstAmount);
      existing.total = roundMoney(existing.total + row.priceWithGst);
    });

    return Object.values(totals).sort((first, second) =>
      first.currency.localeCompare(second.currency),
    );
  }, [selectedMonthRequestRows]);

  if (loading || !me) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading your workspace...</p>
        </BlockCard>
      </main>
    );
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Invoices & Billing"
      subtitle="Manage your monthly invoices, view detailed usage reports, and track billing history."
    >
      {message ? <p className={`inline-alert ${getAlertTone(message)}`}>{message}</p> : null}

      {/* Top Stats - Redesigned */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem", marginBottom: "1.8rem" }}>
        
        <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: "16px", padding: "1.5rem", color: "white", boxShadow: "0 10px 25px rgba(15,23,42,0.12)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: 0, color: "#94A3B8", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Generated Invoices</p>
            <p style={{ margin: "0.4rem 0 0", fontSize: "2.4rem", fontWeight: 800, lineHeight: 1 }}>{invoiceTotal}</p>
            <p style={{ margin: "0.4rem 0 0", color: "#CBD5E1", fontSize: "0.82rem" }}>Total available for account</p>
          </div>
          <div style={{ background: "rgba(255,255,255,0.1)", padding: "0.8rem", borderRadius: "14px" }}>
            <ReceiptText size={24} color="#38BDF8" />
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%)", borderRadius: "16px", padding: "1.5rem", color: "white", boxShadow: "0 10px 25px rgba(29,78,216,0.15)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: 0, color: "#93C5FD", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Requests</p>
            <p style={{ margin: "0.4rem 0 0", fontSize: "2.4rem", fontWeight: 800, lineHeight: 1 }}>{requestTotal}</p>
            <p style={{ margin: "0.4rem 0 0", color: "#DBEAFE", fontSize: "0.82rem" }}>Verified candidates in workspace</p>
          </div>
          <div style={{ background: "rgba(255,255,255,0.15)", padding: "0.8rem", borderRadius: "14px" }}>
            <FileText size={24} color="#DBEAFE" />
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg, #6D28D9 0%, #7C3AED 100%)", borderRadius: "16px", padding: "1.5rem", color: "white", boxShadow: "0 10px 25px rgba(109,40,217,0.15)", display: "flex", flex: 1 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, color: "#C4B5FD", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Amount To Be Paid</p>
            {invoiceTotals.length === 0 ? (
              <p style={{ margin: "0.4rem 0 0", color: "#EDE9FE", fontSize: "0.85rem" }}>No invoice totals yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.7rem", flex: 1 }}>
                {invoiceTotals.map((entry) => (
                  <div key={entry.currency} style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.12)", paddingBottom: "0.4rem" }}>
                    <div style={{ textAlign: "right", color: "white", fontWeight: 800, fontSize: "1.2rem" }}>
                      {formatMoney(entry.total, entry.currency)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ background: "rgba(255,255,255,0.15)", padding: "0.8rem", borderRadius: "14px", marginLeft: "1.5rem", alignSelf: "flex-start" }}>
            <span style={{ color: "#DDD6FE", fontSize: "1.6rem", fontWeight: 800, lineHeight: 1 }}>
              {totalAmountCardSymbol}
            </span>
          </div>
        </div>
      </section>

      {/* Main Master-Detail Layout */}
      <section style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "flex-start", marginBottom: "3rem" }}>
        
        {/* Left Nav */}
        <div style={{ flex: "1 1 360px", minWidth: "320px", display: "flex", flexDirection: "column", gap: "1.2rem" }}>
          
          {/* Timeline Section */}
          <BlockCard>
            <BlockTitle
              icon={<AreaChart size={14} color="#0EA5E9" />}
              title="Day-Wise Request Attempts"
              subtitle={`Request attempts made day by day for the last ${CHART_DAYS} days.`}
              action={
                <span className="neo-badge" style={{ gap: "0.3rem", background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" }}>
                  <TrendingUp size={13} strokeWidth={2.5} />
                  Live Trend
                </span>
              }
            />
            <div style={{ marginTop: "1rem" }}>
              <TimelineChart points={timelinePoints} />
            </div>
          </BlockCard>

          <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: "14px", padding: "1.2rem", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <div style={{ background: "#F1F5F9", padding: "0.4rem", borderRadius: "8px" }}>
                <Calendar size={16} color="#475569" />
              </div>
              <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#1E293B", fontWeight: 700 }}>Billing Period</h3>
            </div>
            
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input
                id="customer-invoice-month-filter"
                className="input"
                type="month"
                value={selectedBillingMonth}
                onChange={(event) => setSelectedBillingMonth(event.target.value)}
                style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
              />
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#64748B", fontSize: "0.85rem" }}>
                Showing invoices for <strong>{selectedBillingMonth ? formatBillingMonth(selectedBillingMonth) : "All Months"}</strong>
              </span>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, background: "#F1F5F9", color: "#475569", padding: "0.2rem 0.6rem", borderRadius: "20px" }}>
                {filteredInvoices.length} results
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            {filteredInvoices.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1px dashed #CBD5E1", borderRadius: "12px", background: "#F8FAFC" }}>
                <ReceiptText size={28} color="#94A3B8" style={{ margin: "0 auto 0.5rem" }} />
                <p style={{ margin: 0, color: "#64748B", fontSize: "0.9rem" }}>No invoices for this month.</p>
              </div>
            ) : (
              filteredInvoices.map((invoice) => {
                const active = selectedInvoice?.id === invoice.id;
                const cardTotals = buildInvoiceTotalsWithGst(invoice);

                return (
                  <button
                    key={invoice.id}
                    type="button"
                    onClick={() => setSelectedInvoiceId(invoice.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: active ? "2px solid #3B82F6" : "1px solid #E2E8F0",
                      borderRadius: "14px",
                      padding: "1rem",
                      background: active ? "#EFF6FF" : "#FFFFFF",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.8rem",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      boxShadow: active ? "0 4px 12px rgba(59, 130, 246, 0.12)" : "0 2px 4px rgba(0,0,0,0.02)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                      <div>
                        <p style={{ margin: 0, color: active ? "#1E3A8A" : "#334155", fontWeight: 800, fontSize: "1rem" }}>
                          {invoice.invoiceNumber}
                        </p>
                        <p style={{ margin: "0.25rem 0 0", color: "#64748B", fontSize: "0.8rem" }}>
                          {formatBillingMonth(invoice.billingMonth)}
                        </p>
                      </div>
                      <div style={{ background: active ? "#DBEAFE" : "#F8FAFC", padding: "0.5rem", borderRadius: "50%", border: active ? "none" : "1px solid #E2E8F0" }}>
                         <ReceiptText size={14} strokeWidth={2.5} color={active ? "#2563EB" : "#94A3B8"} />
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {cardTotals.map((total) => (
                        <span
                          key={`${invoice.id}-${total.currency}`}
                          style={{
                            background: active ? "#BFDBFE" : "#F1F5F9",
                            color: active ? "#1E40AF" : "#475569",
                            borderRadius: "6px",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            padding: "0.25rem 0.5rem",
                          }}
                        >
                          {total.currency} {formatMoney(total.total, total.currency)}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Main Content */}
        <div style={{ flex: "2 1 640px", display: "flex", flexDirection: "column", gap: "1.5rem", minWidth: 0 }}>
          {selectedInvoice ? (
            <>
              {/* Inject Previous Invoice Preview Block here implicitly from code */}
              <BlockCard>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
                  <h3 style={{ margin: 0, color: "#1E293B", fontSize: "1.2rem" }}>Invoice Preview</h3>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => downloadInvoicePdf(selectedInvoice.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      padding: "0.4rem 0.8rem",
                      fontSize: "0.85rem",
                      background: "#FFFFFF",
                      border: "1px solid #CBD5E1",
                      borderRadius: "8px",
                      color: "#334155",
                      fontWeight: 600,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                    }}
                  >
                    <Download size={16} color="#64748B" />
                    Download PDF
                  </button>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <article
                style={{
                  minWidth: "880px",
                  background: "#E8E8E8",
                  border: "3px solid #8E1525",
                  padding: "4px",
                  boxShadow: "0 8px 30px rgba(15, 23, 42, 0.18)",
                }}
              >
                <div
                  style={{
                    border: "1px solid #BBB26A",
                    padding: "2rem 2.4rem 1.5rem",
                    color: "#111111",
                    fontFamily: '"Times New Roman", Georgia, serif',
                  }}
                >
                  <header
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "1.2rem",
                    }}
                  >
                    <div>
                      <h2
                        style={{
                          margin: 0,
                          color: "#1F4597",
                          fontWeight: 700,
                          fontSize: "3rem",
                          lineHeight: 1.1,
                        }}
                      >
                        Invoice
                      </h2>
                      <p style={{ margin: "0.2rem 0 0", color: "#4B5563", fontSize: "1rem" }}>
                        Billing Period: {formatBillingPeriod(selectedInvoice.billingMonth)}
                      </p>
                      <img
                        src="/images/cluso-infolink-logo.png"
                        alt="Cluso Infolink logo"
                        style={{
                          marginTop: "0.45rem",
                          width: "160px",
                          height: "auto",
                          objectFit: "contain",
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => downloadInvoicePdf(selectedInvoice.id)}
                        style={{
                          marginTop: "0.55rem",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          padding: "0.3rem 0.55rem",
                          fontSize: "0.76rem",
                        }}
                      >
                        <Download size={14} />
                        Download PDF
                      </button>
                    </div>

                    <div
                      style={{
                        color: "#5A5A5A",
                        fontSize: "1rem",
                        lineHeight: 1.45,
                        textAlign: "right",
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 700, color: "#474747" }}>Invoice #:</span>{" "}
                        {selectedInvoice.invoiceNumber}
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, color: "#474747" }}>Generated:</span>{" "}
                        {formatDateTime(selectedInvoice.createdAt)}
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, color: "#474747" }}>Billing Month:</span>{" "}
                        {formatBillingMonth(selectedInvoice.billingMonth)}
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, color: "#474747" }}>Billing Period:</span>{" "}
                        {formatBillingPeriod(selectedInvoice.billingMonth)}
                      </div>
                    </div>
                  </header>

                  <section
                    style={{
                      border: "1px solid #D1D1D1",
                      borderRadius: "6px",
                      padding: "0.8rem 1rem",
                      background: "rgba(255,255,255,0.43)",
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      columnGap: "1.3rem",
                      rowGap: "0.25rem",
                      fontSize: "1rem",
                      marginTop: "1.1rem",
                    }}
                  >
                    <div>
                      <h4 style={{ margin: "0 0 0.35rem", color: "#1F4597", fontSize: "1.15rem" }}>
                        Customer Details - Enterprise Details
                      </h4>
                      <div>
                        <strong>Company Name:</strong>{" "}
                        {selectedInvoice.enterpriseDetails.companyName || "-"}
                      </div>
                      <div>
                        <strong>Login Email:</strong> {selectedInvoice.enterpriseDetails.loginEmail || "-"}
                      </div>
                      <div><strong>GSTIN:</strong> {selectedInvoice.enterpriseDetails.gstin || "-"}</div>
                      <div>
                        <strong>CIN / Registration:</strong>{" "}
                        {selectedInvoice.enterpriseDetails.cinRegistrationNumber || "-"}
                      </div>
                      <div><strong>Address:</strong> {selectedInvoice.enterpriseDetails.address || "-"}</div>
                      <div>
                        <strong>Invoice Email:</strong> {selectedInvoice.enterpriseDetails.invoiceEmail || "-"}
                      </div>
                      <div>
                        <strong>Billing same as company:</strong>{" "}
                        {selectedInvoice.enterpriseDetails.billingSameAsCompany ? "Yes" : "No"}
                      </div>
                      <div>
                        <strong>Billing Address:</strong>{" "}
                        {selectedInvoice.enterpriseDetails.billingAddress || "-"}
                      </div>
                    </div>

                    <div>
                      <h4 style={{ margin: "0 0 0.35rem", color: "#1F4597", fontSize: "1.15rem" }}>
                        Cluso Infolink Details
                      </h4>
                      <div>
                        <strong>Company Name:</strong> {selectedInvoice.clusoDetails.companyName || "-"}
                      </div>
                      <div><strong>Login Email:</strong> {selectedInvoice.clusoDetails.loginEmail || "-"}</div>
                      <div><strong>GSTIN:</strong> {selectedInvoice.clusoDetails.gstin || "-"}</div>
                      <div>
                        <strong>CIN / Registration:</strong>{" "}
                        {selectedInvoice.clusoDetails.cinRegistrationNumber || "-"}
                      </div>
                      <div><strong>Address:</strong> {selectedInvoice.clusoDetails.address || "-"}</div>
                      <div><strong>Invoice Email:</strong> {selectedInvoice.clusoDetails.invoiceEmail || "-"}</div>
                      <div>
                        <strong>Billing same as company:</strong>{" "}
                        {selectedInvoice.clusoDetails.billingSameAsCompany ? "Yes" : "No"}
                      </div>
                      <div><strong>Billing Address:</strong> {selectedInvoice.clusoDetails.billingAddress || "-"}</div>
                    </div>
                  </section>

                  <section style={{ marginTop: "1.2rem" }}>
                    <h3 style={{ margin: "0 0 0.45rem", color: "#1F4597", fontSize: "1.5rem" }}>
                      Invoice Items (Monthly Service Usage)
                    </h3>
                    <div style={{ overflowX: "auto" }}>
                      <table
                        style={{
                          width: "100%",
                          minWidth: "660px",
                          borderCollapse: "collapse",
                          fontSize: "0.95rem",
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderTop: "1px solid #232323",
                              borderBottom: "1px solid #666666",
                              textAlign: "left",
                            }}
                          >
                            <th style={{ padding: "0.35rem 0.2rem" }}>Service</th>
                            <th style={{ padding: "0.35rem 0.2rem", width: "12%" }}>Candidates</th>
                            <th style={{ padding: "0.35rem 0.2rem", width: "14%" }}>Currency</th>
                            <th style={{ padding: "0.35rem 0.2rem", width: "16%" }}>Rate</th>
                            <th style={{ padding: "0.35rem 0.2rem", width: "18%" }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedInvoice.lineItems.map((item, index) => (
                            <tr
                              key={`${selectedInvoice.id}-line-${index}`}
                              style={{ borderBottom: "1px solid #666666" }}
                            >
                              <td style={{ padding: "0.35rem 0.2rem" }}>{item.serviceName}</td>
                              <td style={{ padding: "0.35rem 0.2rem" }}>{item.usageCount}</td>
                              <td style={{ padding: "0.35rem 0.2rem" }}>{item.currency}</td>
                              <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                {formatMoney(item.price, item.currency)}
                              </td>
                              <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                {formatMoney(item.lineTotal, item.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
                      <table
                        style={{
                          width: "100%",
                          minWidth: "560px",
                          borderCollapse: "collapse",
                          fontSize: "0.95rem",
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              textAlign: "left",
                              borderTop: "1px solid #232323",
                              borderBottom: "1px solid #666666",
                            }}
                          >
                            <th style={{ padding: "0.35rem 0.2rem" }}>Currency</th>
                            <th style={{ padding: "0.35rem 0.2rem" }}>Sub Total</th>
                            <th style={{ padding: "0.35rem 0.2rem" }}>
                              {selectedInvoice.gstEnabled
                                ? `GST @${clampGstRate(selectedInvoice.gstRate)}%`
                                : "GST"}
                            </th>
                            <th style={{ padding: "0.35rem 0.2rem" }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedInvoiceTotalsWithGst.map((row) => (
                            <tr
                              key={`${selectedInvoice.id}-${row.currency}-gst`}
                              style={{ borderBottom: "1px solid #666666" }}
                            >
                              <td style={{ padding: "0.35rem 0.2rem" }}>{row.currency}</td>
                              <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                {formatMoney(row.subtotal, row.currency)}
                              </td>
                              <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                {selectedInvoice.gstEnabled
                                  ? formatMoney(row.gstAmount, row.currency)
                                  : "-"}
                              </td>
                              <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                {formatMoney(row.total, row.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </article>
                </div>
              </BlockCard>

              {/* Synced Summary UI with Admin */}
              <BlockCard>
                <div style={{ overflowX: "auto" }}>
                  <article
                    style={{
                      minWidth: "960px",
                      background: "#F6F2E9",
                      border: "2px solid #8E1525",
                      padding: "6px",
                      boxShadow: "0 8px 30px rgba(15, 23, 42, 0.15)",
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid #D2C8B6",
                        padding: "1.4rem 1.6rem 1.2rem",
                        color: "#1F2937",
                        fontFamily: '"Times New Roman", Georgia, serif',
                        background: "#FFFDF8",
                      }}
                    >
                      <header
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "1rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <h2
                            style={{
                              margin: 0,
                              color: "#1F4597",
                              fontWeight: 700,
                              fontSize: "2rem",
                              lineHeight: 1.15,
                            }}
                          >
                            Billable Requests Summary
                          </h2>
                          <div style={{ marginTop: "0.35rem", color: "#4B5563", fontSize: "0.95rem" }}>
                            <div><strong>Billing Month:</strong> {formatBillingMonth(selectedInvoice.billingMonth)}</div>
                            <div><strong>Billing Period:</strong> {formatBillingPeriod(selectedInvoice.billingMonth)}</div>
                            <div><strong>Total Billable Requests:</strong> {selectedMonthRequestCount}</div>
                          </div>
                        </div>

                        <img
                          src="/images/cluso-infolink-logo.png"
                          alt="Cluso Infolink logo"
                          style={{ width: "170px", height: "auto", objectFit: "contain" }}
                        />
                      </header>

                      <p
                        style={{
                          margin: "0.8rem 0 0",
                          color: "#92400E",
                          fontSize: "0.9rem",
                          background: "#FEF3C7",
                          border: "1px solid #FDE68A",
                          borderRadius: "6px",
                          padding: "0.55rem 0.7rem",
                        }}
                      >
                        This summary includes only billable requests: reports that were generated and shared to customer in this billing month.
                      </p>

                      <section
                        style={{
                          border: "1px solid #D1D1D1",
                          borderRadius: "6px",
                          padding: "0.8rem 1rem",
                          background: "rgba(255,255,255,0.7)",
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          columnGap: "1.3rem",
                          rowGap: "0.25rem",
                          fontSize: "1rem",
                          marginTop: "1rem",
                        }}
                      >
                        <div>
                          <h4 style={{ margin: "0 0 0.35rem", color: "#1F4597", fontSize: "1.15rem" }}>
                            Customer Details - Enterprise Details
                          </h4>
                          <div><strong>Company Name:</strong> {selectedInvoice.enterpriseDetails.companyName || "-"}</div>
                          <div><strong>Login Email:</strong> {selectedInvoice.enterpriseDetails.loginEmail || "-"}</div>
                          <div><strong>GSTIN:</strong> {selectedInvoice.enterpriseDetails.gstin || "-"}</div>
                          <div><strong>CIN / Registration:</strong> {selectedInvoice.enterpriseDetails.cinRegistrationNumber || "-"}</div>
                          <div><strong>Address:</strong> {selectedInvoice.enterpriseDetails.address || "-"}</div>
                          <div><strong>Invoice Email:</strong> {selectedInvoice.enterpriseDetails.invoiceEmail || "-"}</div>
                          <div>
                            <strong>Billing same as company:</strong>{" "}
                            {selectedInvoice.enterpriseDetails.billingSameAsCompany ? "Yes" : "No"}
                          </div>
                          <div><strong>Billing Address:</strong> {selectedInvoice.enterpriseDetails.billingAddress || "-"}</div>
                        </div>

                        <div>
                          <h4 style={{ margin: "0 0 0.35rem", color: "#1F4597", fontSize: "1.15rem" }}>
                            Cluso Infolink Details
                          </h4>
                          <div><strong>Company Name:</strong> {selectedInvoice.clusoDetails.companyName || "-"}</div>
                          <div><strong>Login Email:</strong> {selectedInvoice.clusoDetails.loginEmail || "-"}</div>
                          <div><strong>GSTIN:</strong> {selectedInvoice.clusoDetails.gstin || "-"}</div>
                          <div><strong>CIN / Registration:</strong> {selectedInvoice.clusoDetails.cinRegistrationNumber || "-"}</div>
                          <div><strong>Address:</strong> {selectedInvoice.clusoDetails.address || "-"}</div>
                          <div><strong>Invoice Email:</strong> {selectedInvoice.clusoDetails.invoiceEmail || "-"}</div>
                          <div>
                            <strong>Billing same as company:</strong>{" "}
                            {selectedInvoice.clusoDetails.billingSameAsCompany ? "Yes" : "No"}
                          </div>
                          <div><strong>Billing Address:</strong> {selectedInvoice.clusoDetails.billingAddress || "-"}</div>
                        </div>
                      </section>

                      <section style={{ marginTop: "1rem" }}>
                        <h4 style={{ margin: "0 0 0.45rem", color: "#1F4597", fontSize: "1.25rem" }}>
                          Candidate-wise Billable Summary
                        </h4>

                        {selectedMonthRequestRows.length === 0 ? (
                          <p style={{ margin: 0, color: "#6B7280" }}>
                            No billable requests found for the selected month.
                          </p>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", minWidth: "1120px", borderCollapse: "collapse", fontSize: "0.92rem" }}>
                              <thead>
                                <tr style={{ borderTop: "1px solid #232323", borderBottom: "1px solid #666666", textAlign: "left" }}>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "6%" }}>Sr No.</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "14%" }}>Requested Date</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "16%" }}>Name of Candidate</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "10%" }}>Status</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "22%" }}>Service</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "8%" }}>Currency</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "9%" }}>Price (Excl. GST)</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "7%" }}>
                                    {selectedInvoice.gstEnabled
                                      ? `GST @${clampGstRate(selectedInvoice.gstRate)}%`
                                      : "GST"}
                                  </th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "8%" }}>Price (Incl. GST)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedMonthRequestRows.map((row, index) => (
                                  <tr key={`month-summary-${row.srNo}-${index}`} style={{ borderBottom: "1px solid #D1D5DB" }}>
                                    <td style={{ padding: "0.35rem 0.2rem" }}>{row.srNo}</td>
                                    <td style={{ padding: "0.35rem 0.2rem" }}>{formatSummaryDate(row.requestedAt)}</td>
                                    <td style={{ padding: "0.35rem 0.2rem" }}>{row.candidateName}</td>
                                    <td style={{ padding: "0.35rem 0.2rem", textTransform: "capitalize" }}>{row.requestStatus}</td>
                                    <td style={{ padding: "0.35rem 0.2rem" }}>{row.serviceName}</td>
                                    <td style={{ padding: "0.35rem 0.2rem" }}>{row.currency}</td>
                                    <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                      {formatMoney(row.priceWithoutGst, row.currency)}
                                    </td>
                                    <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                      {selectedInvoice.gstEnabled
                                        ? formatMoney(row.gstAmount, row.currency)
                                        : "-"}
                                    </td>
                                    <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                      {formatMoney(row.priceWithGst, row.currency)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>

                      {selectedMonthSummaryTotals.length > 0 ? (
                        <section style={{ marginTop: "0.9rem", overflowX: "auto" }}>
                          <table style={{ width: "100%", minWidth: "560px", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                            <thead>
                              <tr style={{ textAlign: "left", borderTop: "1px solid #232323", borderBottom: "1px solid #666666" }}>
                                <th style={{ padding: "0.35rem 0.2rem" }}>Currency</th>
                                <th style={{ padding: "0.35rem 0.2rem" }}>Sub Total</th>
                                <th style={{ padding: "0.35rem 0.2rem" }}>
                                  {selectedInvoice.gstEnabled
                                    ? `GST @${clampGstRate(selectedInvoice.gstRate)}%`
                                    : "GST"}
                                </th>
                                <th style={{ padding: "0.35rem 0.2rem" }}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedMonthSummaryTotals.map((row) => (
                                <tr key={`month-summary-total-${row.currency}`} style={{ borderBottom: "1px solid #D1D5DB" }}>
                                  <td style={{ padding: "0.35rem 0.2rem" }}>{row.currency}</td>
                                  <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                    {formatMoney(row.subtotal, row.currency)}
                                  </td>
                                  <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                    {selectedInvoice.gstEnabled
                                      ? formatMoney(row.gstAmount, row.currency)
                                      : "-"}
                                  </td>
                                  <td style={{ padding: "0.35rem 0.2rem", fontWeight: 700 }}>
                                    {formatMoney(row.total, row.currency)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </section>
                      ) : null}
                    </div>
                  </article>
                </div>
              </BlockCard>
            </>
          ) : (
            <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "4rem 2rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ background: "#F8FAFC", padding: "1.5rem", borderRadius: "50%", marginBottom: "1.5rem" }}>
                <FileSearch size={48} color="#94A3B8" strokeWidth={1.5} />
              </div>
              <h3 style={{ margin: 0, color: "#334155", fontSize: "1.4rem", fontWeight: 800 }}>No Invoice Selected</h3>
              <p style={{ margin: "0.6rem 0 0", color: "#64748B", maxWidth: "420px", lineHeight: 1.5 }}>
                Choose an invoice from the list on the left or select a different billing month to view details, usage reports, and to download the PDF.
              </p>
            </div>
          )}
        </div>
      </section>

    </PortalFrame>
  );
}
