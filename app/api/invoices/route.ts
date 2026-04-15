import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import Invoice from "@/lib/models/Invoice";
import type {
  InvoiceCurrencyTotal,
  InvoiceLineItem,
  InvoicePaymentDetails,
  InvoicePaymentMethod,
  InvoicePaymentProof,
  InvoicePaymentStatus,
  InvoicePartyDetails,
  InvoiceRecord,
  PortalRole,
} from "@/lib/types";

const SUPPORTED_CURRENCY_SET = new Set<string>(SUPPORTED_CURRENCIES);
const BILLING_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;

const submitPaymentProofSchema = z.object({
  action: z.literal("submit-payment-proof"),
  invoiceId: z.string().min(1),
  method: z.enum(["upi", "wireTransfer"]),
  screenshotData: z.string().min(1),
  screenshotFileName: z.string().min(1),
  screenshotMimeType: z.string().min(1),
  screenshotFileSize: z.number().min(1).max(MAX_PAYMENT_PROOF_BYTES),
});

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

function normalizeInvoicePaymentStatus(
  value: unknown,
  fallback: InvoicePaymentStatus = "unpaid",
): InvoicePaymentStatus {
  if (value === "unpaid" || value === "submitted" || value === "paid") {
    return value;
  }

  return fallback;
}

function normalizeInvoicePaymentProof(value: unknown): InvoicePaymentProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = asRecord(value);
  const methodRaw = asString(raw.method).trim();
  const method: InvoicePaymentMethod =
    methodRaw === "wireTransfer" ? "wireTransfer" : "upi";
  const screenshotData = asString(raw.screenshotData).trim();
  const screenshotFileName = asString(raw.screenshotFileName).trim();
  const screenshotMimeType = asString(raw.screenshotMimeType).trim();
  const screenshotFileSizeRaw = Number(raw.screenshotFileSize);
  const uploadedAt = new Date(String(raw.uploadedAt ?? ""));

  if (
    !screenshotData ||
    !screenshotFileName ||
    !screenshotMimeType ||
    Number.isNaN(uploadedAt.getTime())
  ) {
    return null;
  }

  return {
    method,
    screenshotData,
    screenshotFileName,
    screenshotMimeType,
    screenshotFileSize:
      Number.isFinite(screenshotFileSizeRaw) && screenshotFileSizeRaw > 0
        ? Math.trunc(screenshotFileSizeRaw)
        : 0,
    uploadedAt: uploadedAt.toISOString(),
  };
}

function normalizeReceiptDataUrl(dataUrl: string) {
  const trimmedDataUrl = dataUrl.trim();
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(trimmedDataUrl);
  if (!match) {
    return null;
  }

  const mimeType = match[1].trim().toLowerCase();
  const base64Payload = match[2].replace(/\s+/g, "");
  if (!base64Payload) {
    return null;
  }

  try {
    const content = Buffer.from(base64Payload, "base64");
    if (!content.length) {
      return null;
    }

    return {
      mimeType,
      byteLength: content.length,
      normalizedDataUrl: `data:${mimeType};base64,${base64Payload}`,
    };
  } catch {
    return null;
  }
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
    sacCode: normalizeWhitespace(asString(raw.sacCode)),
    ltuCode: normalizeWhitespace(asString(raw.ltuCode)),
    address: normalizeWhitespace(asString(raw.address)),
    invoiceEmail: normalizeWhitespace(asString(raw.invoiceEmail)),
    billingSameAsCompany: Boolean(raw.billingSameAsCompany),
    billingAddress: normalizeWhitespace(asString(raw.billingAddress)),
  };
}

const emptyPaymentDetails: InvoicePaymentDetails = {
  upi: {
    upiId: "",
    qrCodeImageUrl: "",
  },
  wireTransfer: {
    accountHolderName: "",
    accountNumber: "",
    bankName: "",
    ifscCode: "",
    branchName: "",
    swiftCode: "",
    instructions: "",
  },
};

function normalizeInvoicePaymentDetails(value: unknown): InvoicePaymentDetails {
  const raw = asRecord(value);
  const upiRaw = asRecord(raw.upi);
  const wireTransferRaw = asRecord(raw.wireTransfer);

  return {
    upi: {
      upiId: normalizeWhitespace(
        asString(upiRaw.upiId, emptyPaymentDetails.upi.upiId),
      ),
      qrCodeImageUrl: normalizeWhitespace(
        asString(upiRaw.qrCodeImageUrl, emptyPaymentDetails.upi.qrCodeImageUrl),
      ),
    },
    wireTransfer: {
      accountHolderName: normalizeWhitespace(
        asString(
          wireTransferRaw.accountHolderName,
          emptyPaymentDetails.wireTransfer.accountHolderName,
        ),
      ),
      accountNumber: normalizeWhitespace(
        asString(
          wireTransferRaw.accountNumber,
          emptyPaymentDetails.wireTransfer.accountNumber,
        ),
      ),
      bankName: normalizeWhitespace(
        asString(wireTransferRaw.bankName, emptyPaymentDetails.wireTransfer.bankName),
      ),
      ifscCode: normalizeWhitespace(
        asString(wireTransferRaw.ifscCode, emptyPaymentDetails.wireTransfer.ifscCode),
      ).toUpperCase(),
      branchName: normalizeWhitespace(
        asString(
          wireTransferRaw.branchName,
          emptyPaymentDetails.wireTransfer.branchName,
        ),
      ),
      swiftCode: normalizeWhitespace(
        asString(wireTransferRaw.swiftCode, emptyPaymentDetails.wireTransfer.swiftCode),
      ).toUpperCase(),
      instructions: normalizeWhitespace(
        asString(
          wireTransferRaw.instructions,
          emptyPaymentDetails.wireTransfer.instructions,
        ),
      ),
    },
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
    paymentDetails: normalizeInvoicePaymentDetails(doc.paymentDetails),
    paymentStatus: normalizeInvoicePaymentStatus(doc.paymentStatus, "unpaid"),
    paymentProof: normalizeInvoicePaymentProof(doc.paymentProof),
    paidAt: toIsoDate(doc.paidAt),
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

export async function PATCH(req: NextRequest) {
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

  const body = await req.json();
  const parsed = submitPaymentProofSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payment proof payload." }, { status: 400 });
  }

  const normalizedDataUrlPayload = normalizeReceiptDataUrl(parsed.data.screenshotData);
  if (!normalizedDataUrlPayload) {
    return NextResponse.json(
      { error: "Invalid payment receipt format. Upload a valid file screenshot." },
      { status: 400 },
    );
  }

  if (normalizedDataUrlPayload.byteLength > MAX_PAYMENT_PROOF_BYTES) {
    return NextResponse.json(
      { error: "Payment receipt must be 5 MB or smaller." },
      { status: 400 },
    );
  }

  const payloadMimeType = normalizeWhitespace(parsed.data.screenshotMimeType).toLowerCase();
  const normalizedMimeType = normalizedDataUrlPayload.mimeType;
  const effectiveMimeType = payloadMimeType || normalizedMimeType;

  if (!effectiveMimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image screenshots are supported for payment receipts." },
      { status: 400 },
    );
  }

  await connectMongo();

  const invoiceDoc = await Invoice.findOne({
    _id: parsed.data.invoiceId,
    customer: companyId,
  });

  if (!invoiceDoc) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  invoiceDoc.paymentStatus = "submitted";
  invoiceDoc.paidAt = null;
  invoiceDoc.paymentProof = {
    method: parsed.data.method,
    screenshotData: normalizedDataUrlPayload.normalizedDataUrl,
    screenshotFileName: normalizeWhitespace(parsed.data.screenshotFileName).slice(0, 160),
    screenshotMimeType: effectiveMimeType,
    screenshotFileSize: normalizedDataUrlPayload.byteLength,
    uploadedAt: new Date(),
  };

  await invoiceDoc.save();

  return NextResponse.json({
    message: "Payment receipt uploaded successfully. Awaiting admin confirmation.",
    invoice: normalizeInvoiceRecord(
      invoiceDoc.toObject() as unknown as Record<string, unknown>,
    ),
  });
}
