import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import Invoice from "@/lib/models/Invoice";
import Service from "@/lib/models/Service";
import User from "@/lib/models/User";
import VerificationRequest from "@/lib/models/VerificationRequest";
import { sendPaymentReceiptAcknowledgementEmail } from "@/lib/paymentReceiptAcknowledgementMail";
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
const MAX_RELATED_PAYMENT_FILES = 5;
const SERVICE_COUNTRY_FIELD_KEY = "system_service_country";
const LEGACY_SERVICE_COUNTRY_FIELD_QUESTIONS = new Set([
  "country",
  "verification country",
  "service country",
  "select verification country for this service",
]);

const submitPaymentProofSchema = z.object({
  action: z.literal("submit-payment-proof"),
  invoiceId: z.string().min(1),
  method: z.enum(["upi", "wireTransfer"]),
  screenshotData: z.string().min(1),
  screenshotFileName: z.string().min(1),
  screenshotMimeType: z.string().min(1),
  screenshotFileSize: z.number().min(1).max(MAX_PAYMENT_PROOF_BYTES),
});

const removePaymentProofSchema = z.object({
  action: z.literal("remove-payment-proof"),
  invoiceId: z.string().min(1),
});

const addRelatedPaymentFileSchema = z.object({
  action: z.literal("add-related-payment-file"),
  invoiceId: z.string().min(1),
  fileData: z.string().min(1),
  fileName: z.string().min(1),
  fileMimeType: z.string().min(1),
  fileSize: z.number().min(1).max(MAX_PAYMENT_PROOF_BYTES),
});

const paymentProofActionSchema = z.discriminatedUnion("action", [
  submitPaymentProofSchema,
  removePaymentProofSchema,
  addRelatedPaymentFileSchema,
]);

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

function normalizeServiceLabel(value: string) {
  return normalizeWhitespace(value).replace(/\s+x\d+$/i, "");
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

function normalizeInvoicePaymentRelatedFile(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = asRecord(value);
  const fileData = asString(raw.fileData).trim();
  const fileName = asString(raw.fileName).trim();
  const fileMimeType = asString(raw.fileMimeType).trim().toLowerCase();
  const fileSizeRaw = Number(raw.fileSize);
  const uploadedAt = new Date(String(raw.uploadedAt ?? ""));

  if (!fileData || !fileName || !fileMimeType || Number.isNaN(uploadedAt.getTime())) {
    return null;
  }

  return {
    fileData,
    fileName,
    fileMimeType,
    fileSize:
      Number.isFinite(fileSizeRaw) && fileSizeRaw > 0
        ? Math.trunc(fileSizeRaw)
        : 0,
    uploadedAt: uploadedAt.toISOString(),
  };
}

function normalizeInvoicePaymentProof(
  value: unknown,
  options?: { includeFileData?: boolean },
): InvoicePaymentProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const includeFileData = options?.includeFileData ?? true;
  const raw = asRecord(value);
  const methodRaw = asString(raw.method).trim();
  let method: InvoicePaymentMethod = "upi";
  if (methodRaw === "wireTransfer" || methodRaw === "adminUpload") {
    method = methodRaw;
  }
  const screenshotData = asString(raw.screenshotData).trim();
  const screenshotFileName = asString(raw.screenshotFileName).trim();
  const screenshotMimeType = asString(raw.screenshotMimeType).trim();
  const screenshotFileSizeRaw = Number(raw.screenshotFileSize);
  const uploadedAt = new Date(String(raw.uploadedAt ?? ""));
  const relatedFiles = Array.isArray(raw.relatedFiles)
    ? raw.relatedFiles
        .map((entry) => normalizeInvoicePaymentRelatedFile(entry))
        .filter((entry): entry is NonNullable<ReturnType<typeof normalizeInvoicePaymentRelatedFile>> => Boolean(entry))
    : [];

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
    screenshotData: includeFileData ? screenshotData : "",
    screenshotFileName,
    screenshotMimeType,
    screenshotFileSize:
      Number.isFinite(screenshotFileSizeRaw) && screenshotFileSizeRaw > 0
        ? Math.trunc(screenshotFileSizeRaw)
        : 0,
    uploadedAt: uploadedAt.toISOString(),
    relatedFiles: includeFileData
      ? relatedFiles
      : relatedFiles.map((entry) => ({
          ...entry,
          fileData: "",
        })),
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

function isAllowedRelatedFileMimeType(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
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

function normalizeInvoiceRecord(
  doc: Record<string, unknown>,
  options?: { includePaymentProofAssets?: boolean },
): InvoiceRecord {
  const includePaymentProofAssets = options?.includePaymentProofAssets ?? true;
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
    paymentProof: normalizeInvoicePaymentProof(doc.paymentProof, {
      includeFileData: includePaymentProofAssets,
    }),
    paidAt: toIsoDate(doc.paidAt),
    lineItems: normalizeLineItems(doc.lineItems),
    totalsByCurrency: normalizeTotalsByCurrency(doc.totalsByCurrency),
    generatedByName: asString(doc.generatedByName),
    createdAt: toIsoDate(doc.createdAt),
    updatedAt: toIsoDate(doc.updatedAt),
  };
}

type NormalizedServiceSelection = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: InvoiceLineItem["currency"];
  countryRates?: Array<{
    country: string;
    price: number;
    currency: InvoiceLineItem["currency"];
  }>;
};

type MonthlySummaryRow = {
  srNo: number;
  requestedAt: string;
  candidateName: string;
  userName: string;
  verifierName: string;
  requestStatus: string;
  serviceName: string;
  verificationOrigin: string;
  currency: InvoiceLineItem["currency"];
  subtotal: number;
  gstAmount: number;
  total: number;
};

type MonthlySummaryCurrencyTotal = {
  currency: InvoiceLineItem["currency"];
  subtotal: number;
  gstAmount: number;
  total: number;
};

type RequestServiceQuantityMaps = {
  byServiceId: Map<string, number>;
  byServiceName: Map<string, number>;
};

type PackageRateSelection = NormalizedServiceSelection & {
  includedServiceIds: string[];
};

type CollapsedPackageBillingServices = {
  billingServices: NormalizedServiceSelection[];
  selectedPackageServiceIds: Set<string>;
};

type ExtraPaymentApprovalStatus =
  | "not-requested"
  | "pending"
  | "approved"
  | "rejected";

function parseDateValue(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function resolveVerificationOrigin(value: unknown) {
  const normalized = normalizeWhitespace(asString(value));
  return normalized || "-";
}

function parseRepeatableValues(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item ?? ""));
    }
  } catch {
    // Keep backward compatibility for old non-JSON values.
  }

  return [rawValue];
}

function extractCountrySelectionsFromAnswers(answers: unknown) {
  if (!Array.isArray(answers)) {
    return [] as string[];
  }

  const countryAnswer = answers
    .map((entry) => asRecord(entry))
    .find((answer) => {
      const normalizedFieldKey = normalizeWhitespace(asString(answer.fieldKey)).toLowerCase();
      if (normalizedFieldKey === SERVICE_COUNTRY_FIELD_KEY) {
        return true;
      }

      const normalizedQuestion = normalizeWhitespace(asString(answer.question)).toLowerCase();
      return LEGACY_SERVICE_COUNTRY_FIELD_QUESTIONS.has(normalizedQuestion);
    });

  if (!countryAnswer || asBoolean(countryAnswer.notApplicable, false)) {
    return [] as string[];
  }

  const rawValue = asString(countryAnswer.value);
  const rawSelections = asBoolean(countryAnswer.repeatable, false)
    ? parseRepeatableValues(rawValue)
    : [rawValue];

  return rawSelections
    .map((entry) => normalizeWhitespace(String(entry ?? "")))
    .filter(Boolean);
}

function normalizeServiceEntryCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(parsed));
}

function buildServiceCountrySelectionMaps(
  candidateFormResponses: unknown,
  fallbackCountry: string,
) {
  const byServiceId = new Map<string, string[]>();
  const byServiceName = new Map<string, string[]>();

  if (!Array.isArray(candidateFormResponses)) {
    return { byServiceId, byServiceName };
  }

  for (const responseEntry of candidateFormResponses) {
    const response = asRecord(responseEntry);
    const serviceId = normalizeWhitespace(toIdString(response.serviceId));
    const serviceNameKey = normalizeWhitespace(asString(response.serviceName)).toLowerCase();
    const entryCount = normalizeServiceEntryCount(response.serviceEntryCount);

    const selectedCountries = extractCountrySelectionsFromAnswers(response.answers);
    const fallbackSelections = fallbackCountry && fallbackCountry !== "-" ? [fallbackCountry] : [];
    const countries = selectedCountries.length > 0 ? selectedCountries : fallbackSelections;

    const normalizedCountries =
      countries.length > 0
        ? Array.from(
            { length: entryCount },
            (_unused, index) => countries[index] || countries[0],
          ).filter(Boolean)
        : [];

    if (serviceId && !byServiceId.has(serviceId)) {
      byServiceId.set(serviceId, normalizedCountries);
    }

    if (serviceNameKey && !byServiceName.has(serviceNameKey)) {
      byServiceName.set(serviceNameKey, normalizedCountries);
    }
  }

  return { byServiceId, byServiceName };
}

function resolveServiceVerificationOrigin(
  serviceId: string,
  serviceNameKey: string,
  serviceEntryIndex: number,
  countrySelections: {
    byServiceId: Map<string, string[]>;
    byServiceName: Map<string, string[]>;
  },
  fallbackCountry: string,
) {
  const selections =
    (serviceId ? countrySelections.byServiceId.get(serviceId) : undefined) ??
    countrySelections.byServiceName.get(serviceNameKey) ??
    [];

  const resolved = selections[serviceEntryIndex] || selections[0] || fallbackCountry;
  return resolved || "-";
}

function getBillingMonthRange(billingMonth: string) {
  const [yearText, monthText] = billingMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  return { monthStart, monthEnd };
}

function buildBillableRequestFilter(
  companyId: string,
  monthStart: Date,
  monthEnd: Date,
) {
  return {
    customer: companyId,
    $or: [
      { "reportMetadata.customerSharedAt": { $gte: monthStart, $lt: monthEnd } },
      { "reportMetadata.generatedAt": { $gte: monthStart, $lt: monthEnd } },
    ],
  };
}

function formatBillingMonthLabel(billingMonth: string) {
  const [yearText, monthText] = billingMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  const parsed = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(parsed.getTime())) {
    return billingMonth;
  }

  return parsed.toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatBillingPeriod(billingMonth: string) {
  const parsedStart = new Date(`${billingMonth}-01T00:00:00.000Z`);
  if (Number.isNaN(parsedStart.getTime())) {
    return billingMonth || "-";
  }

  const year = parsedStart.getUTCFullYear();
  const monthIndex = parsedStart.getUTCMonth();
  const parsedEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0, 0));

  const formatOptions: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  };

  return `${parsedStart.toLocaleDateString("en-IN", formatOptions)} to ${parsedEnd.toLocaleDateString("en-IN", formatOptions)}`;
}

function normalizePartyDetailsWithFallback(
  value: unknown,
  fallback: InvoicePartyDetails,
): InvoicePartyDetails {
  const raw = asRecord(value);

  const billingSameAsCompany =
    typeof raw.billingSameAsCompany === "boolean"
      ? raw.billingSameAsCompany
      : fallback.billingSameAsCompany;

  const address = normalizeWhitespace(asString(raw.address, fallback.address));
  const billingAddress = normalizeWhitespace(
    asString(raw.billingAddress, fallback.billingAddress),
  );

  return {
    companyName: normalizeWhitespace(asString(raw.companyName, fallback.companyName)),
    loginEmail: normalizeWhitespace(asString(raw.loginEmail, fallback.loginEmail)),
    gstin: normalizeWhitespace(asString(raw.gstin, fallback.gstin)).toUpperCase(),
    cinRegistrationNumber: normalizeWhitespace(
      asString(raw.cinRegistrationNumber, fallback.cinRegistrationNumber),
    ),
    sacCode: normalizeWhitespace(asString(raw.sacCode, fallback.sacCode)),
    ltuCode: normalizeWhitespace(asString(raw.ltuCode, fallback.ltuCode)),
    address,
    invoiceEmail: normalizeWhitespace(asString(raw.invoiceEmail, fallback.invoiceEmail)),
    billingSameAsCompany,
    billingAddress: billingSameAsCompany ? address : billingAddress,
  };
}

function formatAddress(value: unknown) {
  const raw = asRecord(value);
  const parts = [
    asString(raw.line1),
    asString(raw.line2),
    asString(raw.city),
    asString(raw.state),
    asString(raw.postalCode),
    asString(raw.country),
  ]
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);

  return parts.join(", ");
}

function buildEnterpriseDefaults(customer: Record<string, unknown>): InvoicePartyDetails {
  const partnerProfile = asRecord(customer.partnerProfile);
  const companyInformation = asRecord(partnerProfile.companyInformation);
  const invoicingInformation = asRecord(partnerProfile.invoicingInformation);

  const companyAddress = formatAddress(companyInformation.address);
  const billingSameAsCompany =
    typeof invoicingInformation.billingSameAsCompany === "boolean"
      ? invoicingInformation.billingSameAsCompany
      : true;
  const explicitBillingAddress = formatAddress(invoicingInformation.address);

  return {
    companyName:
      normalizeWhitespace(asString(companyInformation.companyName)) ||
      normalizeWhitespace(asString(customer.name)),
    loginEmail: normalizeWhitespace(asString(customer.email)),
    gstin: normalizeWhitespace(asString(companyInformation.gstin)).toUpperCase(),
    cinRegistrationNumber: normalizeWhitespace(
      asString(companyInformation.cinRegistrationNumber),
    ),
    sacCode: "",
    ltuCode: "",
    address: companyAddress,
    invoiceEmail:
      normalizeWhitespace(asString(invoicingInformation.invoiceEmail)) ||
      normalizeWhitespace(asString(customer.email)),
    billingSameAsCompany,
    billingAddress: billingSameAsCompany ? companyAddress : explicitBillingAddress,
  };
}

function buildEnterpriseGstDefaults(customer: Record<string, unknown>) {
  const partnerProfile = asRecord(customer.partnerProfile);
  const invoicingInformation = asRecord(partnerProfile.invoicingInformation);

  return {
    gstEnabled: asBoolean(invoicingInformation.gstEnabled, false),
    gstRate: normalizeGstRate(invoicingInformation.gstRate, 18),
  };
}

function normalizeServiceSelections(value: unknown): NormalizedServiceSelection[] {
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
      const priceRaw = Number(raw.price);
      const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
      const countryRates = normalizeCountryPricingRates(raw.countryRates);

      if (!serviceId || !serviceName) {
        return null;
      }

      return {
        serviceId,
        serviceName,
        price,
        currency,
        countryRates,
      } as NormalizedServiceSelection;
    })
    .filter((entry): entry is NormalizedServiceSelection => Boolean(entry));
}

async function resolvePackageRateSelections(
  customerServiceSelections: unknown,
): Promise<PackageRateSelection[]> {
  const normalizedSelections = normalizeServiceSelections(customerServiceSelections);
  if (normalizedSelections.length === 0) {
    return [];
  }

  const selectionById = new Map<string, NormalizedServiceSelection>();
  for (const selection of normalizedSelections) {
    const serviceId = normalizeWhitespace(selection.serviceId);
    if (serviceId && !selectionById.has(serviceId)) {
      selectionById.set(serviceId, selection);
    }
  }

  if (selectionById.size === 0) {
    return [];
  }

  const serviceDocs = await Service.find({ _id: { $in: [...selectionById.keys()] } })
    .select("_id isPackage includedServiceIds")
    .lean();

  const packageRates: PackageRateSelection[] = [];

  for (const doc of serviceDocs) {
    const serviceRecord = asRecord(doc);
    if (!asBoolean(serviceRecord.isPackage, false)) {
      continue;
    }

    const serviceId = toIdString(serviceRecord._id);
    if (!serviceId) {
      continue;
    }

    const selectedRate = selectionById.get(serviceId);
    if (!selectedRate) {
      continue;
    }

    const includedServiceIds = Array.isArray(serviceRecord.includedServiceIds)
      ? [
          ...new Set(
            serviceRecord.includedServiceIds
              .map((id) => toIdString(id))
              .filter((id) => id.length > 0),
          ),
        ]
      : [];

    if (includedServiceIds.length === 0) {
      continue;
    }

    packageRates.push({
      serviceId: selectedRate.serviceId,
      serviceName: selectedRate.serviceName,
      price: selectedRate.price,
      currency: selectedRate.currency,
      includedServiceIds,
    });
  }

  return packageRates.sort((first, second) => {
    const includedSizeDiff =
      second.includedServiceIds.length - first.includedServiceIds.length;
    if (includedSizeDiff !== 0) {
      return includedSizeDiff;
    }

    return first.serviceName.localeCompare(second.serviceName);
  });
}

function collapsePackageBillingServices(
  selectedServices: NormalizedServiceSelection[],
  packageRates: PackageRateSelection[],
): CollapsedPackageBillingServices {
  if (selectedServices.length === 0 || packageRates.length === 0) {
    return {
      billingServices: selectedServices,
      selectedPackageServiceIds: new Set<string>(),
    };
  }

  const selectedServiceIds = new Set(
    selectedServices
      .map((service) => normalizeWhitespace(service.serviceId))
      .filter((serviceId) => serviceId.length > 0),
  );
  const selectedPackageServiceIds = new Set<string>();
  const coveredServiceIds = new Set<string>();
  const selectedPackageRateById = new Map<string, PackageRateSelection>();

  for (const packageRate of packageRates) {
    const packageServiceId = normalizeWhitespace(packageRate.serviceId);
    if (!packageServiceId || selectedPackageServiceIds.has(packageServiceId)) {
      continue;
    }

    const includedServiceIds = [
      ...new Set(
        packageRate.includedServiceIds
          .map((serviceId) => normalizeWhitespace(serviceId))
          .filter((serviceId) => serviceId.length > 0),
      ),
    ];
    if (includedServiceIds.length === 0) {
      continue;
    }

    const hasAllIncludedServices = includedServiceIds.every((serviceId) =>
      selectedServiceIds.has(serviceId),
    );
    if (!hasAllIncludedServices) {
      continue;
    }

    const overlapsCoveredServices = includedServiceIds.some((serviceId) =>
      coveredServiceIds.has(serviceId),
    );
    if (overlapsCoveredServices) {
      continue;
    }

    selectedPackageServiceIds.add(packageServiceId);
    selectedPackageRateById.set(packageServiceId, packageRate);
    for (const serviceId of includedServiceIds) {
      coveredServiceIds.add(serviceId);
    }
  }

  if (selectedPackageServiceIds.size === 0) {
    return {
      billingServices: selectedServices,
      selectedPackageServiceIds,
    };
  }

  const billingServices = selectedServices.filter((service) => {
    const serviceId = normalizeWhitespace(service.serviceId);
    if (!serviceId) {
      return true;
    }

    if (selectedPackageServiceIds.has(serviceId)) {
      return true;
    }

    return !coveredServiceIds.has(serviceId);
  });

  for (const packageServiceId of selectedPackageServiceIds) {
    const selectedPackageRate = selectedPackageRateById.get(packageServiceId);
    if (!selectedPackageRate) {
      continue;
    }

    const alreadyPresent = billingServices.some(
      (service) => normalizeWhitespace(service.serviceId) === packageServiceId,
    );
    if (alreadyPresent) {
      continue;
    }

    billingServices.push({
      serviceId: selectedPackageRate.serviceId,
      serviceName: selectedPackageRate.serviceName,
      price: selectedPackageRate.price,
      currency: selectedPackageRate.currency,
    });
  }

  return {
    billingServices,
    selectedPackageServiceIds,
  };
}

function normalizeServiceUsageCount(value: unknown) {
  const usageCount = Number(value);
  if (!Number.isFinite(usageCount) || usageCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(usageCount));
}

function buildRequestServiceQuantityMaps(
  request: Record<string, unknown>,
): RequestServiceQuantityMaps {
  const byServiceId = new Map<string, number>();
  const byServiceName = new Map<string, number>();
  const candidateFormResponses = Array.isArray(request.candidateFormResponses)
    ? request.candidateFormResponses
    : [];

  for (const response of candidateFormResponses) {
    const rawResponse = asRecord(response);
    const serviceId = toIdString(rawResponse.serviceId);
    const serviceNameKey = normalizeWhitespace(asString(rawResponse.serviceName)).toLowerCase();
    const usageCount = normalizeServiceUsageCount(rawResponse.serviceEntryCount);

    if (serviceId) {
      const existing = byServiceId.get(serviceId) ?? 0;
      byServiceId.set(serviceId, Math.max(existing, usageCount));
    }

    if (serviceNameKey) {
      const existing = byServiceName.get(serviceNameKey) ?? 0;
      byServiceName.set(serviceNameKey, Math.max(existing, usageCount));
    }
  }

  return { byServiceId, byServiceName };
}

function resolveServiceUsageCount(
  service: NormalizedServiceSelection,
  quantities: RequestServiceQuantityMaps,
) {
  const serviceId = normalizeWhitespace(service.serviceId);
  const serviceNameKey = normalizeWhitespace(service.serviceName).toLowerCase();
  const usageCount =
    (serviceId ? quantities.byServiceId.get(serviceId) : undefined) ??
    quantities.byServiceName.get(serviceNameKey) ??
    1;

  return normalizeServiceUsageCount(usageCount);
}

function normalizeExtraPaymentApprovalStatus(
  value: unknown,
): ExtraPaymentApprovalStatus {
  const normalized = normalizeWhitespace(asString(value)).toLowerCase();
  if (
    normalized === "not-requested" ||
    normalized === "pending" ||
    normalized === "approved" ||
    normalized === "rejected"
  ) {
    return normalized;
  }

  return "not-requested";
}

function resolveBillableExtraPaymentAmount(attemptRecord: Record<string, unknown>) {
  const amountRaw = Number(attemptRecord.extraPaymentAmount);
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return 0;
  }

  const roundedAmount = roundMoney(amountRaw);
  const approvalRequested = asBoolean(
    attemptRecord.extraPaymentApprovalRequested,
    false,
  );

  if (approvalRequested) {
    const approvalStatus = normalizeExtraPaymentApprovalStatus(
      attemptRecord.extraPaymentApprovalStatus,
    );
    return approvalStatus === "approved" ? roundedAmount : 0;
  }

  return asBoolean(attemptRecord.extraPaymentDone, false) ? roundedAmount : 0;
}

function normalizeCountryPricingRates(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      country: string;
      price: number;
      currency: InvoiceLineItem["currency"];
    }>;
  }

  const deduped = new Map<
    string,
    { country: string; price: number; currency: InvoiceLineItem["currency"] }
  >();

  for (const entry of value) {
    const raw = asRecord(entry);
    const country = normalizeWhitespace(asString(raw.country));
    const price = Number(raw.price);
    const currencyRaw = normalizeWhitespace(asString(raw.currency, "INR")).toUpperCase();
    const currency = SUPPORTED_CURRENCY_SET.has(currencyRaw)
      ? (currencyRaw as InvoiceLineItem["currency"])
      : "INR";

    if (!country || !Number.isFinite(price) || price < 0) {
      continue;
    }

    deduped.set(country.toLowerCase(), {
      country,
      price: roundMoney(price),
      currency,
    });
  }

  return [...deduped.values()];
}

function resolveCountryRateForOrigin(
  service: NormalizedServiceSelection | undefined,
  verificationOrigin: string,
) {
  if (!service || !service.countryRates || service.countryRates.length === 0) {
    return undefined;
  }

  const normalizedOrigin = normalizeWhitespace(verificationOrigin).toLowerCase();
  if (!normalizedOrigin || normalizedOrigin === "-") {
    return undefined;
  }

  return service.countryRates.find(
    (rate) => normalizeWhitespace(rate.country).toLowerCase() === normalizedOrigin,
  );
}

function buildServiceSelectionLookups(serviceSelections: unknown) {
  const byServiceId = new Map<string, NormalizedServiceSelection>();
  const byServiceName = new Map<string, NormalizedServiceSelection>();
  const normalizedSelections = normalizeServiceSelections(serviceSelections);

  for (const selection of normalizedSelections) {
    const serviceId = normalizeWhitespace(selection.serviceId);
    const serviceNameKey = normalizeWhitespace(selection.serviceName).toLowerCase();

    if (serviceId && !byServiceId.has(serviceId)) {
      byServiceId.set(serviceId, selection);
    }

    if (serviceNameKey && !byServiceName.has(serviceNameKey)) {
      byServiceName.set(serviceNameKey, selection);
    }
  }

  return { byServiceId, byServiceName };
}

function getRequestBillingServiceSelections(request: Record<string, unknown>) {
  const snapshot = asRecord(request.invoiceSnapshot);
  const snapshotServices = normalizeServiceSelections(snapshot.items);

  if (snapshotServices.length > 0) {
    return {
      selectedServices: snapshotServices,
      usesInvoiceSnapshot: true,
    };
  }

  return {
    selectedServices: normalizeServiceSelections(request.selectedServices),
    usesInvoiceSnapshot: false,
  };
}

function buildMonthlySummaryRows(
  requests: Array<Record<string, unknown>>,
  gstEnabled: boolean,
  gstRate: number,
  invoiceLineItems: InvoiceLineItem[] = [],
  packageRates: PackageRateSelection[] = [],
  companyServiceSelections: unknown = [],
  companyAdminName = "",
) {
  const rows: MonthlySummaryRow[] = [];
  const totals = new Map<string, { subtotal: number; gstAmount: number; total: number }>();
  const normalizedRate = normalizeGstRate(gstRate, 18);

  const invoiceRatesByServiceId = new Map<string, InvoiceLineItem>();
  const invoiceRatesByServiceName = new Map<string, InvoiceLineItem>();
  const companyServiceLookups = buildServiceSelectionLookups(
    companyServiceSelections,
  );

  invoiceLineItems.forEach((lineItem) => {
    const serviceId = normalizeWhitespace(lineItem.serviceId);
    const serviceNameKey = normalizeWhitespace(lineItem.serviceName).toLowerCase();

    if (serviceId) {
      invoiceRatesByServiceId.set(serviceId, lineItem);
    }

    if (serviceNameKey && !invoiceRatesByServiceName.has(serviceNameKey)) {
      invoiceRatesByServiceName.set(serviceNameKey, lineItem);
    }
  });

  let srNo = 1;
  for (const request of requests) {
    const currentSrNo = srNo;
    const requestRecord = asRecord(request);
    const reportMetadata = asRecord(requestRecord.reportMetadata);
    const candidateName = normalizeWhitespace(asString(requestRecord.candidateName)) || `Candidate ${srNo}`;
    const createdByRecord = asRecord(requestRecord.createdBy);
    const createdByDelegateRecord = asRecord(requestRecord.createdByDelegate);
    const createdByName = normalizeWhitespace(asString(createdByRecord.name));
    const delegateName = normalizeWhitespace(asString(createdByDelegateRecord.name));
    const userName = createdByName || delegateName || companyAdminName || "-";
    const serviceVerifications = Array.isArray(requestRecord.serviceVerifications)
      ? requestRecord.serviceVerifications
      : [];
    let verifierName = "";
    let latestAttemptedAt = -1;

    for (const verification of serviceVerifications) {
      const verificationRecord = asRecord(verification);
      const attempts = Array.isArray(verificationRecord.attempts)
        ? verificationRecord.attempts
        : [];

      for (const attempt of attempts) {
        const attemptRecord = asRecord(attempt);
        const resolvedVerifierName =
          normalizeWhitespace(asString(attemptRecord.verifierName)) ||
          normalizeWhitespace(asString(attemptRecord.managerName));
        if (!resolvedVerifierName) {
          continue;
        }

        const attemptedAt = parseDateValue(attemptRecord.attemptedAt);
        const attemptedAtMs = attemptedAt ? attemptedAt.getTime() : -1;

        if (attemptedAtMs >= latestAttemptedAt) {
          latestAttemptedAt = attemptedAtMs;
          verifierName = resolvedVerifierName;
        }
      }
    }

    const requestStatus = normalizeWhitespace(asString(requestRecord.status)) || "pending";
    const requestCountryFallback = resolveVerificationOrigin(
      requestRecord.verificationCountry,
    );
    const serviceCountrySelections = buildServiceCountrySelectionMaps(
      requestRecord.candidateFormResponses,
      requestCountryFallback,
    );
    const { selectedServices: rawSelectedServices, usesInvoiceSnapshot } =
      getRequestBillingServiceSelections(requestRecord);
    const collapsedBillingServices = usesInvoiceSnapshot
      ? {
          billingServices: rawSelectedServices,
          selectedPackageServiceIds: new Set<string>(),
        }
      : collapsePackageBillingServices(rawSelectedServices, packageRates);
    const selectedServices = collapsedBillingServices.billingServices;
    const selectedPackageServiceIds = collapsedBillingServices.selectedPackageServiceIds;
    const serviceQuantities = buildRequestServiceQuantityMaps(requestRecord);
    const requestedDate =
      parseDateValue(requestRecord.createdAt) ??
      parseDateValue(reportMetadata.customerSharedAt) ??
      parseDateValue(reportMetadata.generatedAt);
    const requestedAt = requestedDate ? requestedDate.toISOString() : "";

    if (!requestedAt) {
      console.warn("[invoices][month-summary] Missing requested date for billable request", {
        requestId: toIdString(requestRecord._id),
        candidateName,
        billingCreatedAt: requestRecord.createdAt ?? null,
        customerSharedAt: reportMetadata.customerSharedAt ?? null,
        generatedAt: reportMetadata.generatedAt ?? null,
      });
    }

    const normalizedServices =
      selectedServices.length > 0
        ? selectedServices
        : [{ serviceId: "", serviceName: "Service Not Available", price: 0, currency: "INR" as InvoiceLineItem["currency"] }];

    const selectedServiceReference =
      rawSelectedServices.length > 0 ? rawSelectedServices : normalizedServices;
    const selectedServicesById = new Map<string, NormalizedServiceSelection>();
    const selectedServicesByName = new Map<string, NormalizedServiceSelection>();
    for (const selectedService of selectedServiceReference) {
      const normalizedServiceId = normalizeWhitespace(selectedService.serviceId);
      const normalizedServiceNameKey = normalizeWhitespace(selectedService.serviceName).toLowerCase();

      if (normalizedServiceId && !selectedServicesById.has(normalizedServiceId)) {
        selectedServicesById.set(normalizedServiceId, selectedService);
      }

      if (normalizedServiceNameKey && !selectedServicesByName.has(normalizedServiceNameKey)) {
        selectedServicesByName.set(normalizedServiceNameKey, selectedService);
      }
    }

    const requestServicesByCurrency = new Map<
      string,
      Map<string, { serviceName: string; verificationOrigin: string; subtotal: number }>
    >();

    for (const service of normalizedServices) {
      const serviceId = normalizeWhitespace(service.serviceId);
      const serviceNameKey = normalizeWhitespace(service.serviceName).toLowerCase();
      const matchedInvoiceRate =
        (serviceId ? invoiceRatesByServiceId.get(serviceId) : undefined) ??
        invoiceRatesByServiceName.get(serviceNameKey);
      const companyAssignedService =
        (serviceId ? companyServiceLookups.byServiceId.get(serviceId) : undefined) ??
        companyServiceLookups.byServiceName.get(serviceNameKey);
      const resolvedService = companyAssignedService ?? service;
      const usageCount =
        serviceId && selectedPackageServiceIds.has(serviceId)
          ? 1
          : resolveServiceUsageCount(service, serviceQuantities);
      const resolvedServiceName =
        normalizeServiceLabel(
          matchedInvoiceRate?.serviceName ?? resolvedService.serviceName ?? "Service Not Available",
        );

      for (let entryIndex = 0; entryIndex < usageCount; entryIndex += 1) {
        const verificationOrigin = resolveServiceVerificationOrigin(
          serviceId,
          serviceNameKey,
          entryIndex,
          serviceCountrySelections,
          requestCountryFallback,
        );
        const countryRate = resolveCountryRateForOrigin(
          resolvedService,
          verificationOrigin,
        );
        const currencyRaw = normalizeWhitespace(
          countryRate?.currency ??
            matchedInvoiceRate?.currency ??
            resolvedService.currency,
        ).toUpperCase();
        const currency = SUPPORTED_CURRENCY_SET.has(currencyRaw) ? currencyRaw : "INR";
        const unitPrice = roundMoney(
          countryRate?.price ?? matchedInvoiceRate?.price ?? resolvedService.price,
        );

        let currencyServices = requestServicesByCurrency.get(currency);
        if (!currencyServices) {
          currencyServices = new Map();
          requestServicesByCurrency.set(currency, currencyServices);
        }

        const serviceKey = `${serviceId || serviceNameKey || resolvedServiceName.toLowerCase()}::entry-${entryIndex + 1}::${verificationOrigin.toLowerCase()}`;
        const existingService = currencyServices.get(serviceKey);
        if (existingService) {
          existingService.subtotal = roundMoney(existingService.subtotal + unitPrice);
        } else {
          currencyServices.set(serviceKey, {
            serviceName: resolvedServiceName,
            verificationOrigin,
            subtotal: unitPrice,
          });
        }
      }
    }

    const verificationEntries = Array.isArray(requestRecord.serviceVerifications)
      ? requestRecord.serviceVerifications
      : [];

    for (const verificationEntry of verificationEntries) {
      const verificationRecord = asRecord(verificationEntry);
      const verificationServiceId = normalizeWhitespace(
        toIdString(verificationRecord.serviceId),
      );
      const verificationServiceName = normalizeWhitespace(asString(verificationRecord.serviceName));
      const verificationServiceNameKey = verificationServiceName.toLowerCase();
      const verificationServiceEntryIndex = Math.max(
        1,
        Math.floor(Number(verificationRecord.serviceEntryIndex) || 1),
      );
      const attempts = Array.isArray(verificationRecord.attempts)
        ? verificationRecord.attempts
        : [];

      let extraChargesSubtotal = 0;
      for (const attemptEntry of attempts) {
        const attemptRecord = asRecord(attemptEntry);
        const billableExtraAmount = resolveBillableExtraPaymentAmount(attemptRecord);
        if (billableExtraAmount <= 0) {
          continue;
        }

        extraChargesSubtotal = roundMoney(extraChargesSubtotal + billableExtraAmount);
      }

      if (extraChargesSubtotal <= 0) {
        continue;
      }

      const selectedService =
        (verificationServiceId ? selectedServicesById.get(verificationServiceId) : undefined) ??
        selectedServicesByName.get(verificationServiceNameKey);
      const companyAssignedService =
        (verificationServiceId
          ? companyServiceLookups.byServiceId.get(verificationServiceId)
          : undefined) ??
        companyServiceLookups.byServiceName.get(verificationServiceNameKey);
      const resolvedService = selectedService ?? companyAssignedService;
      const matchedInvoiceRate =
        (verificationServiceId ? invoiceRatesByServiceId.get(verificationServiceId) : undefined) ??
        invoiceRatesByServiceName.get(verificationServiceNameKey);

      const verificationOrigin = resolveServiceVerificationOrigin(
        verificationServiceId,
        verificationServiceNameKey,
        verificationServiceEntryIndex - 1,
        serviceCountrySelections,
        requestCountryFallback,
      );
      const countryRate = resolveCountryRateForOrigin(
        resolvedService,
        verificationOrigin,
      );

      const resolvedBaseServiceName =
        normalizeServiceLabel(
          matchedInvoiceRate?.serviceName ??
            resolvedService?.serviceName ??
            verificationServiceName,
        ) || "Service Not Available";
      const currencyRaw = normalizeWhitespace(
        (countryRate?.currency ??
          matchedInvoiceRate?.currency ??
          resolvedService?.currency ??
          "INR") as string,
      ).toUpperCase();
      const currency = SUPPORTED_CURRENCY_SET.has(currencyRaw) ? currencyRaw : "INR";

      let currencyServices = requestServicesByCurrency.get(currency);
      if (!currencyServices) {
        currencyServices = new Map();
        requestServicesByCurrency.set(currency, currencyServices);
      }

      const extraServiceKey = `${verificationServiceId || verificationServiceNameKey || resolvedBaseServiceName.toLowerCase()}::extra::entry-${verificationServiceEntryIndex}::${verificationOrigin.toLowerCase()}`;
      const existingExtraService = currencyServices.get(extraServiceKey);
      if (existingExtraService) {
        existingExtraService.subtotal = roundMoney(
          existingExtraService.subtotal + extraChargesSubtotal,
        );
      } else {
        currencyServices.set(extraServiceKey, {
          serviceName: `${resolvedBaseServiceName} (Extra Charges)`,
          verificationOrigin,
          subtotal: extraChargesSubtotal,
        });
      }
    }

    const sortedCurrencyEntries = [...requestServicesByCurrency.entries()].sort(
      ([firstCurrency], [secondCurrency]) => firstCurrency.localeCompare(secondCurrency),
    );

    for (const [currency, serviceEntries] of sortedCurrencyEntries) {
      const services = [...serviceEntries.values()].sort((first, second) =>
        first.serviceName.localeCompare(second.serviceName),
      );

      for (const serviceEntry of services) {
        const serviceName = serviceEntry.serviceName;
        const subtotal = roundMoney(serviceEntry.subtotal);
        const gstAmount = gstEnabled
          ? roundMoney((subtotal * normalizedRate) / 100)
          : 0;
        const total = roundMoney(subtotal + gstAmount);

        rows.push({
          srNo: currentSrNo,
          requestedAt,
          candidateName,
          userName,
          verifierName: verifierName || "-",
          requestStatus,
          serviceName,
          verificationOrigin: serviceEntry.verificationOrigin,
          currency: currency as InvoiceLineItem["currency"],
          subtotal,
          gstAmount,
          total,
        });

        const existing = totals.get(currency) ?? { subtotal: 0, gstAmount: 0, total: 0 };
        existing.subtotal = roundMoney(existing.subtotal + subtotal);
        existing.gstAmount = roundMoney(existing.gstAmount + gstAmount);
        existing.total = roundMoney(existing.total + total);
        totals.set(currency, existing);
      }
    }

    if (sortedCurrencyEntries.length === 0) {
      rows.push({
        srNo: currentSrNo,
        requestedAt,
        candidateName,
        userName,
        verifierName: verifierName || "-",
        requestStatus,
        serviceName: "Service Not Available",
        verificationOrigin: requestCountryFallback,
        currency: "INR",
        subtotal: 0,
        gstAmount: 0,
        total: 0,
      });

      const existing = totals.get("INR") ?? { subtotal: 0, gstAmount: 0, total: 0 };
      totals.set("INR", existing);
    }

    srNo += 1;
  }

  const totalsByCurrency = [...totals.entries()]
    .map(
      ([currency, value]) =>
        ({
          currency: currency as InvoiceLineItem["currency"],
          subtotal: value.subtotal,
          gstAmount: value.gstAmount,
          total: value.total,
        }) as MonthlySummaryCurrencyTotal,
    )
    .sort((first, second) => first.currency.localeCompare(second.currency));

  return { rows, totalsByCurrency };
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

  const action = req.nextUrl.searchParams.get("action")?.trim() ?? "";
  const includePaymentAssets =
    req.nextUrl.searchParams.get("includePaymentAssets")?.trim().toLowerCase() ===
      "true" ||
    req.nextUrl.searchParams.get("includePaymentAssets")?.trim() === "1";

  const invoiceId = req.nextUrl.searchParams.get("invoiceId")?.trim() ?? "";

  if (invoiceId) {
    const invoiceDoc = await Invoice.findOne({
      _id: invoiceId,
      customer: companyId,
    }).lean();

    if (!invoiceDoc) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    return NextResponse.json({
      invoice: normalizeInvoiceRecord(
        invoiceDoc as unknown as Record<string, unknown>,
        { includePaymentProofAssets: includePaymentAssets },
      ),
    });
  }

  if (action === "month-summary") {
    const billingMonth =
      normalizeBillingMonth(req.nextUrl.searchParams.get("billingMonth")) ||
      getCurrentBillingMonth();
    const { monthStart, monthEnd } = getBillingMonthRange(billingMonth);

    const [customer, monthInvoice] = await Promise.all([
      User.findOne({ _id: companyId, role: "customer" })
        .select("name email partnerProfile selectedServices")
        .lean(),
      Invoice.findOne({ customer: companyId, billingMonth })
        .sort({ createdAt: -1 })
        .select("enterpriseDetails clusoDetails gstEnabled gstRate lineItems")
        .lean(),
    ]);

    if (!customer) {
      return NextResponse.json({ error: "Company not found." }, { status: 404 });
    }

    if (!monthInvoice) {
      return NextResponse.json({ summary: null });
    }

    const customerRecord = customer as unknown as Record<string, unknown>;
    const monthInvoiceRecord = monthInvoice as unknown as Record<string, unknown>;

    const [packageRates, requests] = await Promise.all([
      resolvePackageRateSelections(customerRecord.selectedServices ?? []),
      VerificationRequest.find(
        buildBillableRequestFilter(companyId, monthStart, monthEnd),
      )
        .sort({ createdAt: 1 })
        .select(
          "candidateName status verificationCountry createdBy createdByDelegate selectedServices invoiceSnapshot serviceVerifications.serviceId serviceVerifications.serviceName serviceVerifications.serviceEntryIndex serviceVerifications.attempts.verifierName serviceVerifications.attempts.managerName serviceVerifications.attempts.attemptedAt serviceVerifications.attempts.extraPaymentDone serviceVerifications.attempts.extraPaymentAmount serviceVerifications.attempts.extraPaymentApprovalRequested serviceVerifications.attempts.extraPaymentApprovalStatus candidateFormResponses.serviceId candidateFormResponses.serviceName candidateFormResponses.serviceEntryCount candidateFormResponses.answers.fieldKey candidateFormResponses.answers.question candidateFormResponses.answers.value candidateFormResponses.answers.repeatable candidateFormResponses.answers.notApplicable createdAt reportMetadata.customerSharedAt reportMetadata.generatedAt",
        )
        .populate({ path: "createdBy", select: "name" })
        .populate({ path: "createdByDelegate", select: "name" })
        .lean(),
    ]);

    const enterpriseDefaults = buildEnterpriseDefaults(customerRecord);
    const enterpriseGstDefaults = buildEnterpriseGstDefaults(customerRecord);

    const enterpriseDetails = normalizePartyDetailsWithFallback(
      monthInvoiceRecord.enterpriseDetails,
      enterpriseDefaults,
    );
    const clusoDetails = normalizePartyDetails(monthInvoiceRecord.clusoDetails);
    const gstEnabled = asBoolean(
      monthInvoiceRecord.gstEnabled,
      enterpriseGstDefaults.gstEnabled,
    );
    const gstRate = normalizeGstRate(
      monthInvoiceRecord.gstRate,
      enterpriseGstDefaults.gstRate,
    );
    const invoiceLineItems = normalizeLineItems(monthInvoiceRecord.lineItems);

    const { rows, totalsByCurrency } = buildMonthlySummaryRows(
      requests as unknown as Array<Record<string, unknown>>,
      gstEnabled,
      gstRate,
      invoiceLineItems,
      packageRates,
      customerRecord.selectedServices ?? [],
      normalizeWhitespace(asString(customerRecord.name)),
    );

    return NextResponse.json({
      summary: {
        billingMonth,
        billingMonthLabel: formatBillingMonthLabel(billingMonth),
        billingPeriod: formatBillingPeriod(billingMonth),
        totalRequests: requests.length,
        gstEnabled,
        gstRate,
        enterpriseDetails,
        clusoDetails,
        rows,
        totalsByCurrency,
      },
    });
  }

  const invoiceDocs = await Invoice.find({ customer: companyId })
    .sort({ billingMonth: -1, createdAt: -1 })
    .lean();

  return NextResponse.json({
    invoices: invoiceDocs.map((doc) =>
      normalizeInvoiceRecord(doc as unknown as Record<string, unknown>, {
        includePaymentProofAssets: includePaymentAssets,
      }),
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
  const parsed = paymentProofActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payment proof payload." }, { status: 400 });
  }

  await connectMongo();

  if (parsed.data.action === "remove-payment-proof") {
    const invoiceDoc = await Invoice.findOne({
      _id: parsed.data.invoiceId,
      customer: companyId,
    });

    if (!invoiceDoc) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    invoiceDoc.paymentProof = null;
    invoiceDoc.paymentStatus = "unpaid";
    invoiceDoc.paidAt = null;

    await invoiceDoc.save();

    return NextResponse.json({
      message: "Previously uploaded payment receipt deleted.",
      invoice: normalizeInvoiceRecord(
        invoiceDoc.toObject() as unknown as Record<string, unknown>,
      ),
    });
  }

  if (parsed.data.action === "add-related-payment-file") {
    const relatedPayload = parsed.data;
    const normalizedDataUrlPayload = normalizeReceiptDataUrl(relatedPayload.fileData);
    if (!normalizedDataUrlPayload) {
      return NextResponse.json(
        { error: "Invalid related file format. Upload a valid file." },
        { status: 400 },
      );
    }

    if (normalizedDataUrlPayload.byteLength > MAX_PAYMENT_PROOF_BYTES) {
      return NextResponse.json(
        { error: "Related file must be 5 MB or smaller." },
        { status: 400 },
      );
    }

    const payloadMimeType = normalizeWhitespace(relatedPayload.fileMimeType).toLowerCase();
    const normalizedMimeType = normalizedDataUrlPayload.mimeType;
    const effectiveMimeType = payloadMimeType || normalizedMimeType;

    if (!isAllowedRelatedFileMimeType(effectiveMimeType)) {
      return NextResponse.json(
        { error: "Only image or PDF files are supported for related information." },
        { status: 400 },
      );
    }

    const invoiceDoc = await Invoice.findOne({
      _id: relatedPayload.invoiceId,
      customer: companyId,
    });

    if (!invoiceDoc) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const existingProof = normalizeInvoicePaymentProof(invoiceDoc.paymentProof);
    if (!existingProof || invoiceDoc.paymentStatus !== "submitted") {
      return NextResponse.json(
        { error: "Related files can only be uploaded while payment is under process." },
        { status: 400 },
      );
    }

    const nextRelatedFiles = [
      ...existingProof.relatedFiles,
      {
        fileData: normalizedDataUrlPayload.normalizedDataUrl,
        fileName: normalizeWhitespace(relatedPayload.fileName).slice(0, 160),
        fileMimeType: effectiveMimeType,
        fileSize: normalizedDataUrlPayload.byteLength,
        uploadedAt: new Date().toISOString(),
      },
    ].slice(-MAX_RELATED_PAYMENT_FILES);

    invoiceDoc.set("paymentProof", {
      method: existingProof.method,
      screenshotData: existingProof.screenshotData,
      screenshotFileName: existingProof.screenshotFileName,
      screenshotMimeType: existingProof.screenshotMimeType,
      screenshotFileSize: existingProof.screenshotFileSize,
      uploadedAt: new Date(existingProof.uploadedAt),
      relatedFiles: nextRelatedFiles.map((entry) => ({
        fileData: entry.fileData,
        fileName: entry.fileName,
        fileMimeType: entry.fileMimeType,
        fileSize: entry.fileSize,
        uploadedAt: new Date(entry.uploadedAt),
      })),
    });

    await invoiceDoc.save();

    return NextResponse.json({
      message: "Related information file uploaded successfully.",
      invoice: normalizeInvoiceRecord(
        invoiceDoc.toObject() as unknown as Record<string, unknown>,
      ),
    });
  }

  const submitPayload = parsed.data;

  const normalizedDataUrlPayload = normalizeReceiptDataUrl(submitPayload.screenshotData);
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

  const payloadMimeType = normalizeWhitespace(submitPayload.screenshotMimeType).toLowerCase();
  const normalizedMimeType = normalizedDataUrlPayload.mimeType;
  const effectiveMimeType = payloadMimeType || normalizedMimeType;

  if (!effectiveMimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image screenshots are supported for payment receipts." },
      { status: 400 },
    );
  }

  const invoiceDoc = await Invoice.findOne({
    _id: submitPayload.invoiceId,
    customer: companyId,
  });

  if (!invoiceDoc) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  invoiceDoc.paymentStatus = "submitted";
  invoiceDoc.paidAt = null;
  invoiceDoc.set("paymentProof", {
    method: submitPayload.method,
    screenshotData: normalizedDataUrlPayload.normalizedDataUrl,
    screenshotFileName: normalizeWhitespace(submitPayload.screenshotFileName).slice(0, 160),
    screenshotMimeType: effectiveMimeType,
    screenshotFileSize: normalizedDataUrlPayload.byteLength,
    uploadedAt: new Date(),
    relatedFiles: [],
  });

  await invoiceDoc.save();

  const normalizedInvoice = normalizeInvoiceRecord(
    invoiceDoc.toObject() as unknown as Record<string, unknown>,
  );
  const emailResult = await sendPaymentReceiptAcknowledgementEmail({
    recipientName: normalizedInvoice.customerName || "Customer",
    recipientEmail: normalizedInvoice.customerEmail,
    invoiceNumber: normalizedInvoice.invoiceNumber,
    billingMonth: normalizedInvoice.billingMonth,
    paymentMethod: submitPayload.method,
  });
  const responseMessage = emailResult.sent
    ? "Payment receipt uploaded successfully. Awaiting admin confirmation. A thank-you email has been sent to your registered email."
    : "Payment receipt uploaded successfully. Awaiting admin confirmation.";

  return NextResponse.json({
    message: responseMessage,
    emailWarning: emailResult.sent
      ? null
      : emailResult.reason ?? "Customer acknowledgement email could not be sent.",
    invoice: normalizedInvoice,
  });
}
