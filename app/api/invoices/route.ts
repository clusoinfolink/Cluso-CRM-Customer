import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import Invoice from "@/lib/models/Invoice";
import type {
  InvoiceCurrencyTotal,
  InvoiceLineItem,
  InvoicePartyDetails,
  InvoiceRecord,
  PortalRole,
} from "@/lib/types";

const SUPPORTED_CURRENCY_SET = new Set<string>(SUPPORTED_CURRENCIES);
const BILLING_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value;
}

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return numeric;
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeGstRate(value: unknown, fallback = 18) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (numeric < 0) {
    return 0;
  }

  if (numeric > 100) {
    return 100;
  }

  return Math.round(numeric * 100) / 100;
}

function getCurrentBillingMonth(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeBillingMonth(value: unknown): string {
  const candidate = normalizeWhitespace(asString(value));
  return BILLING_MONTH_REGEX.test(candidate) ? candidate : "";
}

function resolveInvoiceBillingMonth(doc: Record<string, unknown>) {
  const explicitBillingMonth = normalizeBillingMonth(doc.billingMonth);
  if (explicitBillingMonth) {
    return explicitBillingMonth;
  }

  const createdAt = new Date(String(doc.createdAt ?? ""));
  if (Number.isNaN(createdAt.getTime())) {
    return getCurrentBillingMonth();
  }

  return getCurrentBillingMonth(createdAt);
}

function toIsoDate(value: unknown) {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString();
}

function toIdString(value: unknown): string {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const objectLike = value as { toHexString?: () => string; toString?: () => string };
  if (typeof objectLike.toHexString === "function") {
    const hex = normalizeWhitespace(objectLike.toHexString());
    if (hex) {
      return hex;
    }
  }

  const raw = value as Record<string, unknown>;

  if ("$oid" in raw) {
    return toIdString(raw.$oid);
  }

  if ("id" in raw && raw.id && raw.id !== value) {
    const nestedId = toIdString(raw.id);
    if (nestedId) {
      return nestedId;
    }
  }

  if ("_id" in raw && raw._id && raw._id !== value) {
    const nestedUnderscoreId = toIdString(raw._id);
    if (nestedUnderscoreId) {
      return nestedUnderscoreId;
    }
  }

  const text = typeof objectLike.toString === "function" ? objectLike.toString() : String(value);
  if (!text || text === "[object Object]") {
    return "";
  }

  return normalizeWhitespace(text);
}

function normalizePartyDetails(value: unknown): InvoicePartyDetails {
  const raw = asRecord(value);

  return {
    companyName: normalizeWhitespace(asString(raw.companyName)),
    loginEmail: normalizeWhitespace(asString(raw.loginEmail)),
    gstin: normalizeWhitespace(asString(raw.gstin)).toUpperCase(),
    cinRegistrationNumber: normalizeWhitespace(asString(raw.cinRegistrationNumber)),
    address: normalizeWhitespace(asString(raw.address)),
    invoiceEmail: normalizeWhitespace(asString(raw.invoiceEmail)),
    billingSameAsCompany: Boolean(raw.billingSameAsCompany),
    billingAddress: normalizeWhitespace(asString(raw.billingAddress)),
  };
}

function normalizeLineItems(value: unknown): InvoiceLineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const raw = asRecord(entry);
      const serviceId = toIdString(raw.serviceId);
      const serviceName = normalizeWhitespace(asString(raw.serviceName));
      const currencyRaw = normalizeWhitespace(asString(raw.currency, "INR")).toUpperCase();
      const currency = SUPPORTED_CURRENCY_SET.has(currencyRaw) ? currencyRaw : "INR";
      const price = Math.max(0, asNumber(raw.price));
      const usageCountRaw = asNumber(raw.usageCount, 1);
      const usageCount = usageCountRaw > 0 ? Math.floor(usageCountRaw) : 1;
      const lineTotalRaw = asNumber(raw.lineTotal, price * usageCount);
      const lineTotal = lineTotalRaw >= 0 ? lineTotalRaw : price * usageCount;

      if (!serviceId || !serviceName) {
        return null;
      }

      return {
        serviceId,
        serviceName,
        usageCount,
        price,
        lineTotal,
        currency,
      } as InvoiceLineItem;
    })
    .filter((entry): entry is InvoiceLineItem => Boolean(entry));
}

function normalizeTotalsByCurrency(value: unknown): InvoiceCurrencyTotal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const raw = asRecord(entry);
      const currencyRaw = normalizeWhitespace(asString(raw.currency, "INR")).toUpperCase();
      const currency = SUPPORTED_CURRENCY_SET.has(currencyRaw) ? currencyRaw : "INR";
      const subtotal = Math.max(0, asNumber(raw.subtotal));

      return {
        currency,
        subtotal,
      } as InvoiceCurrencyTotal;
    })
    .filter((entry) => entry.subtotal >= 0);
}

function normalizeInvoiceRecord(doc: Record<string, unknown>): InvoiceRecord {
  const customerRaw = doc.customer;

  return {
    id: toIdString(doc._id),
    invoiceNumber: asString(doc.invoiceNumber),
    billingMonth: resolveInvoiceBillingMonth(doc),
    gstEnabled: asBoolean(doc.gstEnabled, false),
    gstRate: normalizeGstRate(doc.gstRate, 18),
    customerId:
      typeof customerRaw === "string"
        ? customerRaw
        : customerRaw
          ? String((customerRaw as { _id?: unknown })._id ?? customerRaw)
          : "",
    customerName: asString(doc.customerName),
    customerEmail: asString(doc.customerEmail),
    enterpriseDetails: normalizePartyDetails(doc.enterpriseDetails),
    clusoDetails: normalizePartyDetails(doc.clusoDetails),
    lineItems: normalizeLineItems(doc.lineItems),
    totalsByCurrency: normalizeTotalsByCurrency(doc.totalsByCurrency),
    generatedByName: asString(doc.generatedByName),
    createdAt: toIsoDate(doc.createdAt),
    updatedAt: toIsoDate(doc.updatedAt),
  };
}

function canAccessInvoices(auth: { role: PortalRole } | null) {
  if (!auth) {
    return false;
  }

  return auth.role === "customer" || auth.role === "delegate" || auth.role === "delegate_user";
}

function companyIdFromAuth(auth: {
  userId: string;
  role: PortalRole;
  parentCustomerId: string | null;
}) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

export async function GET(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!canAccessInvoices(auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
  }

  await connectMongo();

  const invoiceDocs = await Invoice.find({ customer: companyId })
    .sort({ billingMonth: -1, createdAt: -1 })
    .lean();

  return NextResponse.json({
    invoices: invoiceDocs.map((doc) =>
      normalizeInvoiceRecord(doc as unknown as Record<string, unknown>),
    ),
  });
}
