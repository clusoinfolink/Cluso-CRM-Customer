"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Download, FileText, ReceiptText, TrendingUp, Calendar, FileSearch, X } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks"; 
import { MonthPicker } from "@/components/MonthPicker";
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import { useRequestsData } from "@/lib/hooks/useRequestsData";
import { getAlertTone } from "@/lib/alerts";
import type { InvoiceRecord } from "@/lib/types";

const CHART_DAYS = 30;
const PAYMENT_REQUEST_TIMEOUT_MS = 20000;

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
  userName: string;
  verifierName: string;
  requestStatus: string;
  serviceName: string;
  currency: string;
  priceWithoutGst: number;
  gstAmount: number;
  priceWithGst: number;
};

type PaymentMethod = "upi" | "wireTransfer";

function getPaymentProofMethodLabel(method: "upi" | "wireTransfer" | "adminUpload") {
  if (method === "adminUpload") {
    return "Admin Upload";
  }

  return method === "wireTransfer" ? "Wire Transfer" : "UPI";
}

function getPaymentStatusMeta(status: InvoiceRecord["paymentStatus"]) {
  if (status === "paid") {
    return {
      label: "Paid",
      background: "#DCFCE7",
      border: "#86EFAC",
      color: "#166534",
      openAllowed: false,
    };
  }

  if (status === "submitted") {
    return {
      label: "Payment Under Process",
      background: "#ECFDF5",
      border: "#6EE7B7",
      color: "#047857",
      openAllowed: true,
    };
  }

  return {
    label: "Click to Pay",
    border: "#BFDBFE",
    color: "#1D4ED8",
    openAllowed: true,
  };
}

function getPaymentActionMeta(invoice: InvoiceRecord) {
  if (invoice.paymentStatus === "submitted") {
    return {
      ...getPaymentStatusMeta("submitted"),
      openAllowed: true,
    };
  }

  return getPaymentStatusMeta(invoice.paymentStatus);
}

function clampGstRate(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 100) / 100;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeServiceUsageCount(value: unknown) {
  const usageCount = Number(value);
  if (!Number.isFinite(usageCount) || usageCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(usageCount));
}

function resolveRequestVerifierName(request: {
  serviceVerifications?: Array<{
    attempts?: Array<{
      verifierName?: string;
      managerName?: string;
      attemptedAt?: string;
    }>;
  }>;
}) {
  let latestVerifierName = "";
  let latestAttemptedAt = -1;

  for (const verification of request.serviceVerifications ?? []) {
    for (const attempt of verification.attempts ?? []) {
      const resolvedVerifierName =
        (attempt.verifierName || "").trim() || (attempt.managerName || "").trim();
      if (!resolvedVerifierName) {
        continue;
      }

      const attemptedAt = new Date(attempt.attemptedAt || "");
      const attemptedAtMs = Number.isNaN(attemptedAt.getTime())
        ? -1
        : attemptedAt.getTime();

      if (attemptedAtMs >= latestAttemptedAt) {
        latestAttemptedAt = attemptedAtMs;
        latestVerifierName = resolvedVerifierName;
      }
    }
  }

  return latestVerifierName || "-";
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
  const { items: requestItems } = useRequestsData({
    enabled: Boolean(me) && me?.companyAccessStatus !== "inactive",
  });
  const [message, setMessage] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedBillingMonth, setSelectedBillingMonth] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("upi");
  const [isPaymentMethodEntered, setIsPaymentMethodEntered] = useState(false);
  const [paymentReceiptData, setPaymentReceiptData] = useState("");
  const [paymentReceiptFileName, setPaymentReceiptFileName] = useState("");
  const [paymentReceiptMimeType, setPaymentReceiptMimeType] = useState("");
  const [paymentReceiptFileSize, setPaymentReceiptFileSize] = useState(0);
  const [relatedInfoData, setRelatedInfoData] = useState("");
  const [relatedInfoFileName, setRelatedInfoFileName] = useState("");
  const [relatedInfoMimeType, setRelatedInfoMimeType] = useState("");
  const [relatedInfoFileSize, setRelatedInfoFileSize] = useState(0);
  const [submittingPaymentReceipt, setSubmittingPaymentReceipt] = useState(false);
  const [removingPaymentReceipt, setRemovingPaymentReceipt] = useState(false);
  const [uploadingRelatedInfo, setUploadingRelatedInfo] = useState(false);
  const [paymentModalMessage, setPaymentModalMessage] = useState("");
  const [overviewCardIndex, setOverviewCardIndex] = useState(0);
  const overviewCardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const paymentReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const relatedInfoInputRef = useRef<HTMLInputElement | null>(null);

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
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Error building PDF.";
      setMessage(reason);
    }
    setDownloadingId(null);
  }

  function handleOverviewDotClick(index: number) {
    setOverviewCardIndex(index);
    overviewCardRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
  }

  function handleOverviewScroll(event: React.UIEvent<HTMLElement>) {
    const container = event.currentTarget;
    const cards = container.querySelectorAll<HTMLElement>(".customer-invoice-overview-card");
    if (cards.length === 0) {
      return;
    }

    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.clientWidth / 2;
      const distance = Math.abs(cardCenter - containerCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    if (nearestIndex !== overviewCardIndex) {
      setOverviewCardIndex(nearestIndex);
    }
  }

  function clearSelectedPaymentReceipt() {
    setPaymentReceiptData("");
    setPaymentReceiptFileName("");
    setPaymentReceiptMimeType("");
    setPaymentReceiptFileSize(0);
    if (paymentReceiptInputRef.current) {
      paymentReceiptInputRef.current.value = "";
    }
  }

  function openPaymentReceiptPicker() {
    paymentReceiptInputRef.current?.click();
  }

  function clearSelectedRelatedInfoFile() {
    setRelatedInfoData("");
    setRelatedInfoFileName("");
    setRelatedInfoMimeType("");
    setRelatedInfoFileSize(0);
    if (relatedInfoInputRef.current) {
      relatedInfoInputRef.current.value = "";
    }
  }

  function openRelatedInfoPicker() {
    relatedInfoInputRef.current?.click();
  }

  function openPaymentModal(invoice: InvoiceRecord) {
    if (!getPaymentActionMeta(invoice).openAllowed) {
      return;
    }

    setPaymentInvoiceId(invoice.id);
    setIsPaymentMethodEntered(false);
    clearSelectedPaymentReceipt();
    clearSelectedRelatedInfoFile();
    setUploadingRelatedInfo(false);
    setPaymentModalMessage("");

    if (invoice.paymentStatus === "submitted" && invoice.paymentProof) {
      setSelectedPaymentMethod(
        invoice.paymentProof.method === "wireTransfer" ? "wireTransfer" : "upi",
      );
      setIsPaymentMethodEntered(true);
      return;
    }

    const hasUpiDetails =
      Boolean(invoice.paymentDetails.upi.upiId) ||
      Boolean(invoice.paymentDetails.upi.qrCodeImageUrl);
    const hasWireDetails =
      Boolean(invoice.paymentDetails.wireTransfer.accountHolderName) ||
      Boolean(invoice.paymentDetails.wireTransfer.accountNumber) ||
      Boolean(invoice.paymentDetails.wireTransfer.bankName);

    if (hasUpiDetails || !hasWireDetails) {
      setSelectedPaymentMethod("upi");
      return;
    }

    setSelectedPaymentMethod("wireTransfer");
  }

  function closePaymentModal() {
    setPaymentInvoiceId(null);
    setIsPaymentMethodEntered(false);
    clearSelectedPaymentReceipt();
    clearSelectedRelatedInfoFile();
    setUploadingRelatedInfo(false);
    setPaymentModalMessage("");
  }

  function enterPaymentMethod(method: PaymentMethod) {
    setSelectedPaymentMethod(method);
    setIsPaymentMethodEntered(true);
  }

  async function onPaymentReceiptFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      clearSelectedPaymentReceipt();
      return;
    }

    if (!file.type.startsWith("image/")) {
      setPaymentModalMessage("Please upload an image screenshot for payment receipt.");
      setMessage("Please upload an image screenshot for payment receipt.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setPaymentModalMessage("Payment receipt must be 5 MB or smaller.");
      setMessage("Payment receipt must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    const fileData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.readAsDataURL(file);
    }).catch(() => "");

    if (!fileData) {
      setPaymentModalMessage("Could not read the selected file.");
      setMessage("Could not read the selected file.");
      return;
    }

    setPaymentReceiptData(fileData);
    setPaymentReceiptFileName(file.name);
    setPaymentReceiptMimeType(file.type);
    setPaymentReceiptFileSize(file.size);
    setPaymentModalMessage("");
  }

  async function onRelatedInfoFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      clearSelectedRelatedInfoFile();
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setPaymentModalMessage("Upload an image or PDF file for related information.");
      setMessage("Upload an image or PDF file for related information.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setPaymentModalMessage("Related file must be 5 MB or smaller.");
      setMessage("Related file must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    const fileData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read the selected related file."));
      reader.readAsDataURL(file);
    }).catch(() => "");

    if (!fileData) {
      setPaymentModalMessage("Could not read the selected related file.");
      setMessage("Could not read the selected related file.");
      return;
    }

    setRelatedInfoData(fileData);
    setRelatedInfoFileName(file.name);
    setRelatedInfoMimeType(file.type);
    setRelatedInfoFileSize(file.size);
    setPaymentModalMessage("");
  }

  async function submitRelatedInfoFile() {
    if (!paymentInvoice || paymentInvoice.paymentStatus !== "submitted") {
      return;
    }

    if (!relatedInfoData || !relatedInfoFileName || !relatedInfoMimeType) {
      setPaymentModalMessage("Choose a related file first. The file picker is opened for you.");
      openRelatedInfoPicker();
      setMessage("Upload a related file before submitting.");
      return;
    }

    setUploadingRelatedInfo(true);
    setPaymentModalMessage("");
    setMessage("");

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => {
      controller.abort();
    }, PAYMENT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "add-related-payment-file",
          invoiceId: paymentInvoice.id,
          fileData: relatedInfoData,
          fileName: relatedInfoFileName,
          fileMimeType: relatedInfoMimeType,
          fileSize: relatedInfoFileSize,
        }),
      });

      const data = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        setPaymentModalMessage(data.error ?? "Could not upload related information file.");
        setMessage(data.error ?? "Could not upload related information file.");
        return;
      }

      setPaymentModalMessage(data.message ?? "Related information file uploaded successfully.");
      setMessage(data.message ?? "Related information file uploaded successfully.");
      clearSelectedRelatedInfoFile();
      await fetchInvoices();
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError";
      const reason = isTimeout
        ? "Related file upload timed out. Please try again."
        : "Could not upload related information file.";
      setPaymentModalMessage(reason);
      setMessage(reason);
    } finally {
      window.clearTimeout(timeoutHandle);
      setUploadingRelatedInfo(false);
    }
  }

  async function removePreviouslyUploadedReceipt() {
    if (!paymentInvoice?.paymentProof) {
      return;
    }

    setRemovingPaymentReceipt(true);
    setPaymentModalMessage("");
    setMessage("");

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => {
      controller.abort();
    }, PAYMENT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "remove-payment-proof",
          invoiceId: paymentInvoice.id,
        }),
      });

      const data = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        setPaymentModalMessage(
          data.error ?? "Could not delete previously uploaded receipt.",
        );
        setMessage(data.error ?? "Could not delete previously uploaded receipt.");
        return;
      }

      setPaymentModalMessage("Previously uploaded receipt deleted.");
      setMessage(data.message ?? "Previously uploaded receipt deleted.");
      await fetchInvoices();
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError";
      const reason = isTimeout
        ? "Delete request timed out. Please try again."
        : "Could not delete previously uploaded receipt.";
      setPaymentModalMessage(reason);
      setMessage(reason);
    } finally {
      window.clearTimeout(timeoutHandle);
      setRemovingPaymentReceipt(false);
    }
  }

  async function submitPaymentReceipt() {
    if (!paymentInvoice) {
      return;
    }

    if (!isPaymentMethodEntered) {
      setPaymentModalMessage("Choose UPI or wire transfer and enter it first.");
      setMessage("Choose UPI or wire transfer and enter it first.");
      return;
    }

    if (!paymentReceiptData || !paymentReceiptFileName || !paymentReceiptMimeType) {
      setPaymentModalMessage("Choose a payment screenshot first. The file picker is opened for you.");
      openPaymentReceiptPicker();
      setMessage("Upload the payment screenshot before submitting.");
      return;
    }

    setSubmittingPaymentReceipt(true);
    setPaymentModalMessage("");
    setMessage("");

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => {
      controller.abort();
    }, PAYMENT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "submit-payment-proof",
          invoiceId: paymentInvoice.id,
          method: selectedPaymentMethod,
          screenshotData: paymentReceiptData,
          screenshotFileName: paymentReceiptFileName,
          screenshotMimeType: paymentReceiptMimeType,
          screenshotFileSize: paymentReceiptFileSize,
        }),
      });

      const data = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        setPaymentModalMessage(data.error ?? "Could not upload payment receipt.");
        setMessage(data.error ?? "Could not upload payment receipt.");
        return;
      }

      setPaymentModalMessage(data.message ?? "Payment receipt uploaded successfully.");
      setMessage(data.message ?? "Payment receipt uploaded successfully.");
      await fetchInvoices();
      closePaymentModal();
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError";
      const reason = isTimeout
        ? "Submit request timed out. Please try again."
        : "Could not upload payment receipt.";
      setPaymentModalMessage(reason);
      setMessage(reason);
    } finally {
      window.clearTimeout(timeoutHandle);
      setSubmittingPaymentReceipt(false);
    }
  }

  const filteredInvoices = useMemo(() => {
    if (!selectedBillingMonth) return invoices;
    return invoices.filter((i) => i.billingMonth === selectedBillingMonth);
  }, [invoices, selectedBillingMonth]);

  const selectedInvoice = useMemo(() => {
    return invoices.find((i) => i.id === selectedInvoiceId) || (filteredInvoices.length > 0 ? filteredInvoices[0] : null);
  }, [invoices, selectedInvoiceId, filteredInvoices]);

  const paymentInvoice = useMemo(() => {
    if (!paymentInvoiceId) {
      return null;
    }

    return invoices.find((invoice) => invoice.id === paymentInvoiceId) ?? null;
  }, [invoices, paymentInvoiceId]);

  const isPaymentUnderProcessViewOnly =
    paymentInvoice?.paymentStatus === "submitted" && Boolean(paymentInvoice.paymentProof);

  const invoiceTotal = invoices.length;
  const requestTotal = invoices.reduce((acc, curr) => acc + (curr.lineItems?.reduce((sum, item) => sum + (item.usageCount || 0), 0) || 0), 0) || 0;
  const outstandingInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.paymentStatus !== "paid"),
    [invoices],
  );

  const invoiceTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    outstandingInvoices.forEach((inv) => {
      buildInvoiceTotalsWithGst(inv).forEach((row) => {
        totals[row.currency] = (totals[row.currency] || 0) + row.total;
      });
    });

    return Object.entries(totals)
      .map(([currency, total]) => ({ currency, total: roundMoney(total) }))
      .sort((first, second) => first.currency.localeCompare(second.currency));
  }, [outstandingInvoices]);

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
      const verifierName = resolveRequestVerifierName(request);
      const userName =
        (request.delegateName || "").trim() ||
        (request.createdByName || "").trim() ||
        "-";
      const serviceQuantityById = new Map<string, number>();
      const serviceQuantityByName = new Map<string, number>();

      (request.candidateFormResponses ?? []).forEach((serviceResponse) => {
        const serviceId = (serviceResponse.serviceId || "").trim();
        const serviceNameKey = (serviceResponse.serviceName || "").trim().toLowerCase();
        const usageCount = normalizeServiceUsageCount(serviceResponse.serviceEntryCount);

        if (serviceId) {
          const existing = serviceQuantityById.get(serviceId) ?? 0;
          serviceQuantityById.set(serviceId, Math.max(existing, usageCount));
        }

        if (serviceNameKey) {
          const existing = serviceQuantityByName.get(serviceNameKey) ?? 0;
          serviceQuantityByName.set(serviceNameKey, Math.max(existing, usageCount));
        }
      });

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

      const requestServicesByCurrency = new Map<
        string,
        Map<string, { serviceName: string; usageCount: number; subtotal: number }>
      >();

      normalizedServices.forEach((service, serviceIndex) => {
        const normalizedServiceId = (service.serviceId || "").trim();
        const normalizedServiceName = (service.serviceName || "").trim().toLowerCase();
        const matchedInvoiceRate =
          (normalizedServiceId ? invoiceRatesByServiceId.get(normalizedServiceId) : undefined) ??
          invoiceRatesByServiceName.get(normalizedServiceName);
        const usageCount = normalizeServiceUsageCount(
          (normalizedServiceId ? serviceQuantityById.get(normalizedServiceId) : undefined) ??
            serviceQuantityByName.get(normalizedServiceName) ??
            1,
        );

        const resolvedCurrency = (matchedInvoiceRate?.currency || service.currency || "INR").toUpperCase();
        const unitPrice = roundMoney(Number(matchedInvoiceRate?.price ?? service.price) || 0);
        const serviceSubtotal = roundMoney(unitPrice * usageCount);
        const resolvedServiceName =
          matchedInvoiceRate?.serviceName || service.serviceName || "Service Not Available";
        const serviceKey =
          normalizedServiceId ||
          normalizedServiceName ||
          `${resolvedServiceName.toLowerCase()}-${serviceIndex}`;

        let currencyServices = requestServicesByCurrency.get(resolvedCurrency);
        if (!currencyServices) {
          currencyServices = new Map();
          requestServicesByCurrency.set(resolvedCurrency, currencyServices);
        }

        const existingService = currencyServices.get(serviceKey);
        if (existingService) {
          existingService.usageCount += usageCount;
          existingService.subtotal = roundMoney(existingService.subtotal + serviceSubtotal);
        } else {
          currencyServices.set(serviceKey, {
            serviceName: resolvedServiceName,
            usageCount,
            subtotal: serviceSubtotal,
          });
        }
      });

      [...requestServicesByCurrency.entries()]
        .sort(([firstCurrency], [secondCurrency]) =>
          firstCurrency.localeCompare(secondCurrency),
        )
        .forEach(([currency, serviceEntries]) => {
          const services = [...serviceEntries.values()];
          const serviceName = services
            .map((entry) =>
              entry.usageCount > 1
                ? `${entry.serviceName} x${entry.usageCount}`
                : entry.serviceName,
            )
            .join(", ");
          const priceWithoutGst = roundMoney(
            services.reduce((sum, entry) => sum + entry.subtotal, 0),
          );
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
            userName,
            verifierName,
            requestStatus: request.status || "pending",
            serviceName,
            currency,
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

  useEffect(() => {
    if (!paymentInvoice) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePaymentModal();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paymentInvoice]);

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
      <div 
        style={{ 
          position: "sticky", 
          top: 0, 
          zIndex: 40, 
          backgroundColor: "#F8FAFC", 
          paddingTop: "1rem", 
          paddingBottom: "0.5rem",
          margin: "-1rem 0 1.8rem",
          paddingLeft: "0",
          paddingRight: "0"
        }}
      >
        <section className="customer-invoice-overview" onScroll={handleOverviewScroll} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem", marginBottom: "0" }}>
        
        <div
          ref={(element) => {
            overviewCardRefs.current[0] = element;
          }}
          className="customer-invoice-overview-card"
          style={{ background: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.5rem", color: "#1E293B", boxShadow: "0 8px 18px rgba(15,23,42,0.06)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <div>
            <p style={{ margin: 0, color: "#64748B", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Generated Invoices</p>
            <p style={{ margin: "0.4rem 0 0", fontSize: "2.4rem", fontWeight: 800, lineHeight: 1 }}>{invoiceTotal}</p>
            <p style={{ margin: "0.4rem 0 0", color: "#475569", fontSize: "0.82rem" }}>Total available for account</p>
          </div>
          <div style={{ background: "#EEF2F7", border: "1px solid #E2E8F0", padding: "0.8rem", borderRadius: "14px" }}>
            <ReceiptText size={24} color="#334155" />
          </div>
        </div>

        <div
          ref={(element) => {
            overviewCardRefs.current[1] = element;
          }}
          className="customer-invoice-overview-card"
          style={{ background: "linear-gradient(135deg, #F8FBFF 0%, #EDF5FF 100%)", border: "1px solid #D9E8FF", borderRadius: "16px", padding: "1.5rem", color: "#1E293B", boxShadow: "0 8px 18px rgba(37,99,235,0.08)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <div>
            <p style={{ margin: 0, color: "#42638E", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Requests</p>
            <p style={{ margin: "0.4rem 0 0", fontSize: "2.4rem", fontWeight: 800, lineHeight: 1 }}>{requestTotal}</p>
            <p style={{ margin: "0.4rem 0 0", color: "#5B7CA8", fontSize: "0.82rem" }}>Verified candidates in workspace</p>
          </div>
          <div style={{ background: "#E3EEFF", border: "1px solid #CFE0FF", padding: "0.8rem", borderRadius: "14px" }}>
            <FileText size={24} color="#2563EB" />
          </div>
        </div>

        <div
          ref={(element) => {
            overviewCardRefs.current[2] = element;
          }}
          className="customer-invoice-overview-card"
          style={{ background: "linear-gradient(135deg, #FCFCFF 0%, #F4F4FF 100%)", border: "1px solid #E5E7FF", borderRadius: "16px", padding: "1.5rem", color: "#1E293B", boxShadow: "0 8px 18px rgba(99,102,241,0.07)", display: "flex", flex: 1 }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, color: "#6B5EA8", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Amount To Be Paid</p>
            {invoiceTotals.length === 0 ? (
              <p style={{ margin: "0.4rem 0 0", color: "#6B7280", fontSize: "0.85rem" }}>No invoice totals yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.7rem", flex: 1 }}>
                {invoiceTotals.map((entry) => (
                  <div key={entry.currency} style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", borderBottom: "1px solid #E2E8F0", paddingBottom: "0.4rem" }}>
                    <div style={{ textAlign: "right", color: "#1E293B", fontWeight: 800, fontSize: "1.2rem" }}>
                      {formatMoney(entry.total, entry.currency)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ background: "#EEEAFE", border: "1px solid #DDD6FE", padding: "0.8rem", borderRadius: "14px", marginLeft: "1.5rem", alignSelf: "flex-start" }}>
            <span style={{ color: "#6D28D9", fontSize: "1.6rem", fontWeight: 800, lineHeight: 1 }}>
              {totalAmountCardSymbol}
            </span>
          </div>
        </div>
      </section>

      <div className="customer-invoice-overview-dots" aria-label="Overview cards">
        {["Generated Invoices", "Total Requests", "Total Amount To Be Paid"].map((label, index) => (
          <button
            key={label}
            type="button"
            className={`customer-invoice-overview-dot ${overviewCardIndex === index ? "is-active" : ""}`}
            onClick={() => handleOverviewDotClick(index)}
            aria-label={`Show ${label}`}
            aria-pressed={overviewCardIndex === index}
          />
        ))}
      </div>
      </div>

      {/* Main Master-Detail Layout */}
      <section className="customer-invoice-layout" style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "flex-start", marginBottom: "3rem" }}>
        
        {/* Left Nav */}
        <div className="customer-invoice-left" style={{ flex: "1 1 360px", minWidth: "320px", display: "flex", flexDirection: "column", gap: "1.2rem" }}>
          <div className="customer-invoice-tools-row">
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

            <div className="customer-invoice-period-card" style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: "14px", padding: "1.2rem", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <div style={{ background: "#F1F5F9", padding: "0.4rem", borderRadius: "8px" }}>
                  <Calendar size={16} color="#475569" />
                </div>
                <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#1E293B", fontWeight: 700 }}>Billing Period</h3>
              </div>
              
              <div style={{ position: "relative", marginBottom: "1rem" }}>
                <MonthPicker
                  id="customer-invoice-month-filter"
                  value={selectedBillingMonth}
                  onChange={(value) => setSelectedBillingMonth(value)}
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
          </div>

          <div className="customer-invoice-list" style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            {filteredInvoices.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1px dashed #CBD5E1", borderRadius: "12px", background: "#F8FAFC" }}>
                <ReceiptText size={28} color="#94A3B8" style={{ margin: "0 auto 0.5rem" }} />
                <p style={{ margin: 0, color: "#64748B", fontSize: "0.9rem" }}>No invoices for this month.</p>
              </div>
            ) : (
              filteredInvoices.map((invoice) => {
                const active = selectedInvoice?.id === invoice.id;
                const cardTotals = buildInvoiceTotalsWithGst(invoice);
                const paymentStatusMeta = getPaymentActionMeta(invoice);

                return (
                  <article
                    key={invoice.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedInvoiceId(invoice.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedInvoiceId(invoice.id);
                      }
                    }}
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
                      outline: "none",
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

                    <div style={{ marginTop: "0.2rem" }}>
                      {invoice.paymentStatus === "submitted" && invoice.paymentProof ? (
                        <div style={{ color: "#0F766E", fontSize: "0.76rem", marginBottom: "0.35rem", fontWeight: 600 }}>
                          Payment in process ({getPaymentProofMethodLabel(invoice.paymentProof.method)})
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openPaymentModal(invoice);
                        }}
                        disabled={!paymentStatusMeta.openAllowed}
                        style={{
                          border: `1px solid ${paymentStatusMeta.border}`,
                          background: paymentStatusMeta.background,
                          color: paymentStatusMeta.color,
                          borderRadius: "8px",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          padding: "0.4rem 0.65rem",
                          cursor: paymentStatusMeta.openAllowed ? "pointer" : "not-allowed",
                          opacity: paymentStatusMeta.openAllowed ? 1 : 0.95,
                        }}
                      >
                        {paymentStatusMeta.label}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Right Main Content */}
        <div className="customer-invoice-right" style={{ flex: "2 1 640px", display: "flex", flexDirection: "column", gap: "1.5rem", minWidth: 0 }}>
          {selectedInvoice ? (
            <>
              {/* Inject Previous Invoice Preview Block here implicitly from code */}
              <BlockCard className="customer-invoice-preview-card">
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
                  minWidth: "760px",
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
                      <div><strong>SAC Code:</strong> {selectedInvoice.clusoDetails.sacCode || "-"}</div>
                      <div><strong>LTU Code:</strong> {selectedInvoice.clusoDetails.ltuCode || "-"}</div>
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
              <BlockCard className="customer-invoice-summary-card">
                <div style={{ overflowX: "auto" }}>
                  <article
                    style={{
                      minWidth: "100%",
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
                          <div><strong>SAC Code:</strong> {selectedInvoice.clusoDetails.sacCode || "-"}</div>
                          <div><strong>LTU Code:</strong> {selectedInvoice.clusoDetails.ltuCode || "-"}</div>
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
                            <table style={{ width: "100%", minWidth: "1200px", borderCollapse: "collapse", fontSize: "0.92rem" }}>
                              <thead>
                                <tr style={{ borderTop: "1px solid #232323", borderBottom: "1px solid #666666", textAlign: "left" }}>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "6%" }}>Sr No.</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "14%" }}>Requested Date</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "14%" }}>Name of Candidate</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "14%" }}>User Name</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "12%" }}>Verifier Name</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "10%" }}>Status</th>
                                  <th style={{ padding: "0.35rem 0.2rem", width: "16%" }}>Service</th>
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
                                    <td style={{ padding: "0.35rem 0.2rem" }}>{row.userName || "-"}</td>
                                    <td style={{ padding: "0.35rem 0.2rem" }}>{row.verifierName || "-"}</td>
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
            <div className="customer-invoice-empty-card" style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "4rem 2rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
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

      {paymentInvoice ? (
        <div
          role="presentation"
          onClick={closePaymentModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.56)",
            backdropFilter: "blur(2px)",
            zIndex: 110,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Invoice payment methods"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              background:
                "linear-gradient(180deg, #FFFFFF 0%, #FBFDFF 58%, #F7FAFF 100%)",
              borderRadius: "22px",
              border: "1px solid #C9D8F8",
              boxShadow: "0 26px 62px rgba(15, 23, 42, 0.34)",
              padding: "1.05rem",
              display: "grid",
              gap: "1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.8rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div>
                  <h3 style={{ margin: 0, color: "#0F172A", fontSize: "1.24rem", fontWeight: 800 }}>
                    {isPaymentUnderProcessViewOnly ? "Payment Status" : "Pay Invoice"}
                  </h3>
                  <p style={{ margin: "0.35rem 0 0", color: "#64748B", fontSize: "0.86rem", fontWeight: 600 }}>
                    {paymentInvoice.invoiceNumber} | {formatBillingMonth(paymentInvoice.billingMonth)}
                  </p>
                </div>
                <div
                  style={{
                    background: "#F0FDF4",
                    border: "1px solid #16A34A",
                    padding: "0.45rem 0.8rem",
                    borderRadius: "8px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    width: "fit-content",
                  }}
                >
                  <span style={{ fontSize: "0.82rem", color: "#166534", fontWeight: 700 }}>Amount Due:</span>
                  <span style={{ fontSize: "1.1rem", color: "#15803D", fontWeight: 900 }}>
                    {buildInvoiceTotalsWithGst(paymentInvoice)
                      .map((t) => formatMoney(t.total, t.currency))
                      .join(" + ")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={closePaymentModal}
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "999px",
                  border: "1px solid #B7CCE8",
                  background: "#F8FBFF",
                  color: "#3C556E",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
                aria-label="Close payment popup"
              >
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                border: "1px solid #D7E3F7",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #EFF6FF 0%, #E8F3FF 100%)",
                padding: "0.68rem 0.78rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.7rem",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "#1D4ED8", fontSize: "0.78rem", fontWeight: 800 }}>
                Secure payment window
              </span>
              <span style={{ color: "#334155", fontSize: "0.76rem", fontWeight: 600 }}>
                Share clear receipt proof for faster verification.
              </span>
            </div>

            {isPaymentUnderProcessViewOnly ? (
              <div
                style={{
                  border: "1px solid #6EE7B7",
                  borderRadius: "12px",
                  background: "#ECFDF5",
                  padding: "0.95rem",
                  display: "grid",
                  gap: "0.6rem",
                }}
              >
                <div style={{ color: "#047857", fontSize: "0.88rem", fontWeight: 800 }}>
                  Payment Status: Under Process
                </div>
                <div style={{ color: "#065F46", fontSize: "0.82rem" }}>
                  We received your payment proof and will review it shortly.
                </div>
                {paymentModalMessage ? (
                  <div
                    style={{
                      border: "1px solid #BFDBFE",
                      background: "#EFF6FF",
                      color: "#1E3A8A",
                      borderRadius: "9px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      padding: "0.5rem 0.65rem",
                    }}
                  >
                    {paymentModalMessage}
                  </div>
                ) : null}
                {paymentInvoice.paymentProof ? (
                  <>
                    <div style={{ color: "#0F766E", fontSize: "0.8rem" }}>
                      Method: {getPaymentProofMethodLabel(paymentInvoice.paymentProof.method)}
                    </div>
                    <div style={{ color: "#0F766E", fontSize: "0.8rem" }}>
                      Uploaded: {formatDateTime(paymentInvoice.paymentProof.uploadedAt)}
                    </div>
                    <div style={{ color: "#0F766E", fontSize: "0.8rem" }}>
                      File: {paymentInvoice.paymentProof.screenshotFileName || "Receipt screenshot"}
                    </div>
                    <img
                      src={paymentInvoice.paymentProof.screenshotData}
                      alt="Uploaded payment receipt"
                      style={{
                        width: "min(320px, 100%)",
                        border: "1px solid #A7F3D0",
                        borderRadius: "10px",
                        background: "#FFFFFF",
                        padding: "0.25rem",
                        objectFit: "contain",
                      }}
                    />

                    {paymentInvoice.paymentProof.relatedFiles.length > 0 ? (
                      <div
                        style={{
                          borderTop: "1px dashed #A7F3D0",
                          paddingTop: "0.7rem",
                          display: "grid",
                          gap: "0.55rem",
                        }}
                      >
                        <div style={{ color: "#047857", fontSize: "0.82rem", fontWeight: 700 }}>
                          Related Information Files
                        </div>
                        <div style={{ display: "grid", gap: "0.6rem" }}>
                          {paymentInvoice.paymentProof.relatedFiles.map((relatedFile, index) => {
                            const isImage = relatedFile.fileMimeType.startsWith("image/");
                            return (
                              <div
                                key={`${paymentInvoice.id}-related-file-${index}`}
                                style={{
                                  border: "1px solid #A7F3D0",
                                  borderRadius: "10px",
                                  background: "#FFFFFF",
                                  padding: "0.55rem",
                                  display: "grid",
                                  gap: "0.45rem",
                                }}
                              >
                                <div style={{ color: "#065F46", fontSize: "0.78rem", fontWeight: 700 }}>
                                  {relatedFile.fileName || `Related file ${index + 1}`}
                                </div>
                                <div style={{ color: "#0F766E", fontSize: "0.75rem" }}>
                                  Uploaded: {formatDateTime(relatedFile.uploadedAt)}
                                </div>
                                <a
                                  href={relatedFile.fileData}
                                  download={relatedFile.fileName || `related-file-${index + 1}`}
                                  style={{
                                    border: "1px solid #93C5FD",
                                    background: "#EFF6FF",
                                    color: "#1D4ED8",
                                    borderRadius: "8px",
                                    fontSize: "0.76rem",
                                    fontWeight: 700,
                                    padding: "0.32rem 0.55rem",
                                    textDecoration: "none",
                                    width: "fit-content",
                                  }}
                                >
                                  Open or Download
                                </a>
                                {isImage ? (
                                  <img
                                    src={relatedFile.fileData}
                                    alt={relatedFile.fileName || "Related information file"}
                                    style={{
                                      width: "min(220px, 100%)",
                                      border: "1px solid #CBD5E1",
                                      borderRadius: "8px",
                                      background: "#F8FAFC",
                                      padding: "0.2rem",
                                      objectFit: "contain",
                                    }}
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div
                      style={{
                        borderTop: "1px dashed #A7F3D0",
                        paddingTop: "0.75rem",
                        display: "grid",
                        gap: "0.55rem",
                      }}
                    >
                      <div style={{ color: "#047857", fontSize: "0.82rem", fontWeight: 700 }}>
                        Add Related Information File
                      </div>
                      <div style={{ color: "#0F766E", fontSize: "0.76rem", fontWeight: 600 }}>
                        Accepted: image or PDF, up to 5 MB.
                      </div>
                      <input
                        ref={relatedInfoInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(event) => {
                          void onRelatedInfoFileChange(event);
                        }}
                        style={{ display: "none" }}
                      />

                      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={openRelatedInfoPicker}
                          style={{
                            border: "1px solid #059669",
                            background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                            color: "#FFFFFF",
                            borderRadius: "8px",
                            fontSize: "0.78rem",
                            fontWeight: 800,
                            padding: "0.36rem 0.62rem",
                            cursor: "pointer",
                            boxShadow: "0 8px 16px rgba(5, 150, 105, 0.2)",
                          }}
                        >
                          {relatedInfoFileName ? "Choose Another File" : "Choose Related File"}
                        </button>
                        <span style={{ color: "#0F766E", fontSize: "0.76rem", fontWeight: 600 }}>
                          {relatedInfoFileName || "No file selected"}
                        </span>
                      </div>

                      {relatedInfoFileName ? (
                        <>
                          <div style={{ color: "#0F766E", fontSize: "0.78rem" }}>
                            Selected: {relatedInfoFileName}
                          </div>
                          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={openRelatedInfoPicker}
                              style={{
                                border: "1px solid #93C5FD",
                                background: "#EFF6FF",
                                color: "#1D4ED8",
                                borderRadius: "8px",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                padding: "0.32rem 0.55rem",
                                cursor: "pointer",
                              }}
                            >
                              Edit Selected File
                            </button>
                            <button
                              type="button"
                              onClick={clearSelectedRelatedInfoFile}
                              style={{
                                border: "1px solid #FCA5A5",
                                background: "#FEF2F2",
                                color: "#991B1B",
                                borderRadius: "8px",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                padding: "0.32rem 0.55rem",
                                cursor: "pointer",
                              }}
                            >
                              Delete Selected File
                            </button>
                          </div>
                        </>
                      ) : null}

                      {relatedInfoData && relatedInfoMimeType.startsWith("image/") ? (
                        <img
                          src={relatedInfoData}
                          alt="Related information preview"
                          style={{
                            width: "min(220px, 100%)",
                            border: "1px solid #CBD5E1",
                            borderRadius: "8px",
                            background: "#F8FAFC",
                            padding: "0.2rem",
                            objectFit: "contain",
                          }}
                        />
                      ) : null}

                      <button
                        type="button"
                        onClick={() => void submitRelatedInfoFile()}
                        disabled={uploadingRelatedInfo}
                        style={{
                          justifySelf: "start",
                          border: "1px solid #059669",
                          background: "#059669",
                          color: "#FFFFFF",
                          borderRadius: "8px",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          padding: "0.42rem 0.72rem",
                          cursor: uploadingRelatedInfo ? "wait" : "pointer",
                        }}
                      >
                        {uploadingRelatedInfo ? "Uploading..." : "Upload Related File"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gap: "0.8rem",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => enterPaymentMethod("upi")}
                    style={{
                      border:
                        selectedPaymentMethod === "upi"
                          ? "2px solid #1D4ED8"
                          : "1px solid #CFD8E7",
                      borderRadius: "14px",
                      background:
                        selectedPaymentMethod === "upi"
                          ? "linear-gradient(135deg, #F1F7FF 0%, #E9F3FF 100%)"
                          : "#FFFFFF",
                      padding: "1.25rem",
                      display: "grid",
                      gap: "0.42rem",
                      textAlign: "left",
                      cursor: "pointer",
                      boxShadow:
                        selectedPaymentMethod === "upi"
                          ? "0 10px 22px rgba(37, 99, 235, 0.14)"
                          : "0 6px 14px rgba(15, 23, 42, 0.06)",
                      position: "relative",
                    }}
                  >
                    {selectedPaymentMethod === "upi" ? (
                      <div style={{ position: "absolute", top: "12px", right: "12px", background: "#1D4ED8", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                    ) : null}
                    <img
                      src="/images/upi-icon.webp"
                      alt="UPI official logo"
                      style={{ width: "min(280px, 100%)", height: "110px", objectFit: "contain", alignSelf: "center", justifySelf: "center" }}
                    />
                    <strong style={{ color: "#0F172A", marginTop: "0.4rem" }}>UPI</strong>
                    <span style={{ color: "#64748B", fontSize: "0.82rem" }}>
                      Pay using UPI ID and QR code.
                    </span>
                    <span style={{ color: "#1D4ED8", fontSize: "0.8rem", fontWeight: 700 }}>
                      Enter UPI
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => enterPaymentMethod("wireTransfer")}
                    style={{
                      border:
                        selectedPaymentMethod === "wireTransfer"
                          ? "2px solid #1D4ED8"
                          : "1px solid #CFD8E7",
                      borderRadius: "14px",
                      background:
                        selectedPaymentMethod === "wireTransfer"
                          ? "linear-gradient(135deg, #F1F7FF 0%, #E9F3FF 100%)"
                          : "#FFFFFF",
                      padding: "1.25rem",
                      display: "grid",
                      gap: "0.42rem",
                      textAlign: "left",
                      cursor: "pointer",
                      boxShadow:
                        selectedPaymentMethod === "wireTransfer"
                          ? "0 10px 22px rgba(37, 99, 235, 0.14)"
                          : "0 6px 14px rgba(15, 23, 42, 0.06)",
                      position: "relative",
                    }}
                  >
                    {selectedPaymentMethod === "wireTransfer" ? (
                      <div style={{ position: "absolute", top: "12px", right: "12px", background: "#1D4ED8", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                    ) : null}
                    <img
                      src="/images/wire-transfer-logo.svg"
                      alt="Wire Transfer Logo"
                      style={{ width: "210px", height: "70px", objectFit: "contain", alignSelf: "center", justifySelf: "center", marginTop: "20px", marginBottom: "20px" }}
                    />
                    <strong style={{ color: "#0F172A", marginTop: "0.4rem" }}>Wire Transfer</strong>
                    <span style={{ color: "#64748B", fontSize: "0.82rem" }}>
                      Pay directly to Cluso bank account.
                    </span>
                    <span style={{ color: "#1D4ED8", fontSize: "0.8rem", fontWeight: 700 }}>
                      Enter Wire Transfer
                    </span>
                  </button>
                </div>

                {!isPaymentMethodEntered ? (
              <div
                style={{
                  border: "1px dashed #CBD5E1",
                  borderRadius: "12px",
                  padding: "0.95rem",
                  color: "#475569",
                  fontSize: "0.86rem",
                  background: "#F8FAFC",
                }}
              >
                Choose UPI or Wire Transfer above and enter into it to proceed.
              </div>
                ) : selectedPaymentMethod === "upi" ? (
              <div
                style={{
                  border: "1px solid #DBEAFE",
                  borderRadius: "12px",
                  background: "#F8FBFF",
                  padding: "0.9rem",
                  display: "grid",
                  gap: "0.8rem",
                }}
              >
                <div style={{ color: "#1D4ED8", fontSize: "0.84rem", fontWeight: 700 }}>UPI Payment</div>
                <div>
                  <div style={{ color: "#64748B", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                    UPI ID
                  </div>
                  <div
                    style={{
                      border: "1px solid #BFDBFE",
                      borderRadius: "8px",
                      background: "#FFFFFF",
                      padding: "0.5rem 0.65rem",
                      color: "#0F172A",
                      fontWeight: 700,
                      wordBreak: "break-all",
                    }}
                  >
                    {paymentInvoice.paymentDetails.upi.upiId || "Not configured yet."}
                  </div>
                </div>

                <div>
                  <div style={{ color: "#64748B", fontSize: "0.8rem", marginBottom: "0.35rem" }}>
                    UPI QR Code
                  </div>
                  {paymentInvoice.paymentDetails.upi.qrCodeImageUrl ? (
                    <img
                      src={paymentInvoice.paymentDetails.upi.qrCodeImageUrl}
                      alt="UPI QR code"
                      style={{
                        width: "min(230px, 100%)",
                        border: "1px solid #BFDBFE",
                        borderRadius: "12px",
                        background: "#FFFFFF",
                        padding: "0.55rem",
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        border: "1px dashed #93C5FD",
                        borderRadius: "12px",
                        padding: "0.9rem",
                        color: "#475569",
                        background: "#FFFFFF",
                        fontSize: "0.85rem",
                      }}
                    >
                      QR code is not configured yet. Please use wire transfer or contact admin.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  border: "1px solid #DBEAFE",
                  borderRadius: "12px",
                  background: "#F8FBFF",
                  padding: "0.9rem",
                  display: "grid",
                  gap: "0.55rem",
                }}
              >
                <div style={{ color: "#1D4ED8", fontSize: "0.84rem", fontWeight: 700 }}>
                  Wire Transfer Payment
                </div>
                {[
                  ["Account Holder", paymentInvoice.paymentDetails.wireTransfer.accountHolderName],
                  ["Account Number", paymentInvoice.paymentDetails.wireTransfer.accountNumber],
                  ["Bank Name", paymentInvoice.paymentDetails.wireTransfer.bankName],
                  ["IFSC", paymentInvoice.paymentDetails.wireTransfer.ifscCode],
                  ["Branch", paymentInvoice.paymentDetails.wireTransfer.branchName],
                  ["SWIFT", paymentInvoice.paymentDetails.wireTransfer.swiftCode],
                  ["Instructions", paymentInvoice.paymentDetails.wireTransfer.instructions],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: "grid", gridTemplateColumns: "155px minmax(0, 1fr)", gap: "0.55rem", alignItems: "start" }}>
                    <span style={{ color: "#64748B", fontSize: "0.82rem" }}>{label}</span>
                    <span style={{ color: "#0F172A", fontWeight: 600, wordBreak: "break-word" }}>
                      {value || "-"}
                    </span>
                  </div>
                ))}
              </div>
                )}

                {isPaymentMethodEntered ? (
              <div
                style={{
                  border: "1px solid #C7D5EB",
                  borderRadius: "14px",
                  padding: "0.95rem",
                  background: "linear-gradient(180deg, #FFFFFF 0%, #F9FBFF 100%)",
                  display: "grid",
                  gap: "0.8rem",
                }}
              >
                <div style={{ color: "#0F172A", fontWeight: 800, fontSize: "0.9rem" }}>
                  Upload Payment Screenshot
                </div>

                <div style={{ color: "#64748B", fontSize: "0.77rem", fontWeight: 600 }}>
                  Accepted: JPG/PNG image up to 5 MB. Ensure amount and transaction details are clearly visible.
                </div>

                {paymentModalMessage ? (
                  <div
                    style={{
                      border: "1px solid #BFDBFE",
                      background: "#EFF6FF",
                      color: "#1E3A8A",
                      borderRadius: "9px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      padding: "0.5rem 0.65rem",
                    }}
                  >
                    {paymentModalMessage}
                  </div>
                ) : null}

                <input
                  ref={paymentReceiptInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    void onPaymentReceiptFileChange(event);
                  }}
                  style={{ display: "none" }}
                />

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={openPaymentReceiptPicker}
                    style={{
                      border: "1px solid #1D4ED8",
                      background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                      color: "#FFFFFF",
                      borderRadius: "9px",
                      fontSize: "0.82rem",
                      fontWeight: 800,
                      padding: "0.46rem 0.78rem",
                      cursor: "pointer",
                      boxShadow: "0 8px 18px rgba(37, 99, 235, 0.22)",
                    }}
                  >
                    {paymentReceiptFileName ? "Choose Another Screenshot" : "Choose Screenshot File"}
                  </button>
                  <span style={{ color: "#475569", fontSize: "0.79rem", fontWeight: 600 }}>
                    {paymentReceiptFileName || "No file selected"}
                  </span>
                </div>

                {paymentReceiptFileName ? (
                  <>
                    <div style={{ color: "#475569", fontSize: "0.8rem" }}>
                      Selected: {paymentReceiptFileName}
                    </div>
                    <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={openPaymentReceiptPicker}
                        style={{
                          border: "1px solid #93C5FD",
                          background: "#EFF6FF",
                          color: "#1D4ED8",
                          borderRadius: "8px",
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          padding: "0.35rem 0.6rem",
                          cursor: "pointer",
                        }}
                      >
                        Edit Selected File
                      </button>
                      <button
                        type="button"
                        onClick={clearSelectedPaymentReceipt}
                        style={{
                          border: "1px solid #FCA5A5",
                          background: "#FEF2F2",
                          color: "#991B1B",
                          borderRadius: "8px",
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          padding: "0.35rem 0.6rem",
                          cursor: "pointer",
                        }}
                      >
                        Delete Selected File
                      </button>
                    </div>
                  </>
                ) : null}

                {paymentReceiptData ? (
                  <img
                    src={paymentReceiptData}
                    alt="Payment screenshot preview"
                    style={{
                      width: "min(280px, 100%)",
                      border: "1px solid #CBD5E1",
                      borderRadius: "10px",
                      background: "#F8FAFC",
                      padding: "0.3rem",
                      objectFit: "contain",
                    }}
                  />
                ) : null}

                {paymentInvoice.paymentProof ? (
                  <div style={{ borderTop: "1px dashed #CBD5E1", paddingTop: "0.65rem", display: "grid", gap: "0.4rem" }}>
                    <div style={{ color: "#0F766E", fontSize: "0.8rem", fontWeight: 700 }}>
                      Previously uploaded receipt
                    </div>
                    <div style={{ color: "#475569", fontSize: "0.78rem" }}>
                      Method: {getPaymentProofMethodLabel(paymentInvoice.paymentProof.method)} | Uploaded: {formatDateTime(paymentInvoice.paymentProof.uploadedAt)}
                    </div>
                    <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={openPaymentReceiptPicker}
                        style={{
                          border: "1px solid #93C5FD",
                          background: "#EFF6FF",
                          color: "#1D4ED8",
                          borderRadius: "8px",
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          padding: "0.35rem 0.6rem",
                          cursor: "pointer",
                        }}
                      >
                        Edit Receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => void removePreviouslyUploadedReceipt()}
                        disabled={removingPaymentReceipt || submittingPaymentReceipt}
                        style={{
                          border: "1px solid #FCA5A5",
                          background: "#FEF2F2",
                          color: "#991B1B",
                          borderRadius: "8px",
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          padding: "0.35rem 0.6rem",
                          cursor:
                            removingPaymentReceipt || submittingPaymentReceipt
                              ? "wait"
                              : "pointer",
                        }}
                      >
                        {removingPaymentReceipt ? "Deleting..." : "Delete Previous Receipt"}
                      </button>
                    </div>
                    <img
                      src={paymentInvoice.paymentProof.screenshotData}
                      alt="Previously uploaded payment receipt"
                      style={{
                        width: "min(220px, 100%)",
                        border: "1px solid #CBD5E1",
                        borderRadius: "10px",
                        background: "#FFFFFF",
                        padding: "0.25rem",
                        objectFit: "contain",
                      }}
                    />
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void submitPaymentReceipt()}
                  disabled={submittingPaymentReceipt || removingPaymentReceipt}
                  style={{
                    justifySelf: "start",
                    border: "1px solid #2563EB",
                    background: "#2563EB",
                    color: "#FFFFFF",
                    borderRadius: "8px",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    padding: "0.45rem 0.75rem",
                    cursor:
                      submittingPaymentReceipt || removingPaymentReceipt
                        ? "wait"
                        : "pointer",
                  }}
                >
                  {submittingPaymentReceipt ? "Submitting..." : "Submit Payment Receipt"}
                </button>
              </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}

    </PortalFrame>
  );
}

