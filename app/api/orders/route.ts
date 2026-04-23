import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { Types } from "mongoose";
import { z } from "zod";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currencies";
import { connectMongo } from "@/lib/mongodb";
import Service from "@/lib/models/Service";
import User from "@/lib/models/User";
import VerificationRequest from "@/lib/models/VerificationRequest";

const schema = z.object({
  candidateName: z.string().min(2),
  candidateEmail: z.string().email(),
  candidatePhone: z.string().optional().default(""),
  verificationCountry: z.string().trim().optional().default(""),
  selectedServiceIds: z.array(z.string().min(1)).optional().default([]),
  serviceConfigs: z.record(z.string(), z.string()).optional().default({}),
  allowDuplicateSubmission: z.boolean().optional().default(false),
});

const updateSchema = z.object({
  requestId: z.string().min(1),
  candidateName: z.string().min(2),
  candidateEmail: z.string().email(),
  candidatePhone: z.string().optional().default(""),
  verificationCountry: z.string().trim().optional().default(""),
  selectedServiceIds: z.array(z.string().min(1)).optional().default([]),
});

const rejectCandidateDataSchema = z.object({
  action: z.literal("reject-candidate-data"),
  requestId: z.string().min(1),
  rejectedFields: z.array(
    z.object({
      serviceId: z.string().min(1),
      fieldKey: z.string().trim().optional().default(""),
      question: z.string().trim().min(1),
    }),
  ).min(1),
  rejectionComment: z.string().trim().max(500).optional().default(""),
});

const enterpriseDecisionSchema = z.object({
  action: z.enum(["enterprise-approve", "enterprise-reject"]),
  requestId: z.string().min(1),
  rejectionNote: z.string().trim().max(500).optional().default(""),
});

const appealReverificationSchema = z.object({
  action: z.literal("appeal-reverification"),
  requestId: z.string().min(1),
  serviceIds: z.array(z.string().min(1)).min(1),
  comment: z.string().trim().min(3).max(2000),
  attachmentFileName: z.string().trim().max(180).optional().default(""),
  attachmentMimeType: z.string().trim().max(120).optional().default(""),
  attachmentFileSize: z.number().int().nonnegative().nullable().optional().default(null),
  attachmentData: z.string().trim().max(7_000_000).optional().default(""),
});

const revokeAppealSchema = z.object({
  action: z.literal("revoke-reverification-appeal"),
  requestId: z.string().min(1),
});

const previewCandidateLinkEmailSchema = z.object({
  action: z.literal("preview-candidate-link-email"),
  requestId: z.string().min(1),
});

const resendCandidateLinkSchema = z.object({
  action: z.literal("resend-candidate-link"),
  requestId: z.string().min(1),
});

const extraPaymentApprovalDecisionSchema = z.object({
  action: z.literal("extra-payment-approval-decision"),
  requestId: z.string().min(1),
  serviceId: z.string().min(1),
  serviceEntryIndex: z.number().int().min(1).optional().default(1),
  attemptedAt: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  rejectionNote: z.string().trim().max(500).optional().default(""),
});

const ENTERPRISE_REJECTION_WINDOW_MS = 10 * 60 * 1000;
const MAX_APPEAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const APPEAL_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const DEFAULT_PERSONAL_DETAILS_SERVICE_NAME = "Personal details";
const COMPANY_ACCESS_INACTIVE_ERROR =
  "Your company access is deactivated. Only Settings and Invoices are available.";
const DEFAULT_PERSONAL_DETAILS_FORM_FIELDS = [
  {
    fieldKey: "personal_full_name",
    question: "Full name (as per government ID)",
    iconKey: "pen",
    fieldType: "text",
    required: true,
    repeatable: false,
    minLength: 2,
    maxLength: 120,
    forceUppercase: false,
    allowNotApplicable: false,
    notApplicableText: "",
  },
  {
    fieldKey: "personal_date_of_birth",
    question: "Date of birth",
    iconKey: "calendar",
    fieldType: "date",
    required: true,
    repeatable: false,
    minLength: null,
    maxLength: null,
    forceUppercase: false,
    allowNotApplicable: false,
    notApplicableText: "",
  },
  {
    fieldKey: "personal_mobile_number",
    question: "Mobile number",
    iconKey: "phone",
    fieldType: "text",
    required: true,
    repeatable: false,
    minLength: 7,
    maxLength: 20,
    forceUppercase: false,
    allowNotApplicable: false,
    notApplicableText: "",
  },
  {
    fieldKey: "personal_email_address",
    question: "Email address",
    iconKey: "email",
    fieldType: "email",
    required: true,
    repeatable: false,
    minLength: 5,
    maxLength: 160,
    forceUppercase: false,
    allowNotApplicable: false,
    notApplicableText: "",
  },
  {
    fieldKey: "personal_nationality",
    question: "Nationality",
    iconKey: "global",
    fieldType: "text",
    required: true,
    repeatable: false,
    minLength: 2,
    maxLength: 80,
    forceUppercase: false,
    allowNotApplicable: false,
    notApplicableText: "",
  },
  {
    fieldKey: "personal_residential_address",
    question: "Current residential address",
    iconKey: "house",
    fieldType: "long_text",
    required: true,
    repeatable: false,
    minLength: 10,
    maxLength: 400,
    forceUppercase: false,
    allowNotApplicable: false,
    notApplicableText: "",
  },
  {
    fieldKey: "personal_gender",
    question: "Gender",
    iconKey: "person",
    fieldType: "dropdown",
    required: true,
    repeatable: false,
    minLength: null,
    maxLength: null,
    forceUppercase: false,
    allowNotApplicable: false,
    notApplicableText: "",
    dropdownOptions: ["Male", "Female", "Non-binary", "Prefer not to say"],
  },
  {
    fieldKey: "personal_primary_id_number",
    question: "Primary government ID number",
    iconKey: "id-card",
    fieldType: "text",
    required: true,
    repeatable: false,
    minLength: 4,
    maxLength: 80,
    forceUppercase: true,
    allowNotApplicable: false,
    notApplicableText: "",
  },
];

function mergePersonalDetailsFormFields(existingFormFields: unknown) {
  if (!Array.isArray(existingFormFields) || existingFormFields.length === 0) {
    return DEFAULT_PERSONAL_DETAILS_FORM_FIELDS;
  }

  const existingFieldKeys = new Set(
    existingFormFields
      .filter(
        (field): field is { fieldKey?: unknown } =>
          Boolean(field) && typeof field === "object",
      )
      .map((field) => String(field.fieldKey ?? "").trim())
      .filter(Boolean),
  );

  const missingDefaultFields = DEFAULT_PERSONAL_DETAILS_FORM_FIELDS.filter(
    (field) => !existingFieldKeys.has(field.fieldKey),
  );

  if (missingDefaultFields.length === 0) {
    return existingFormFields;
  }

  return [...existingFormFields, ...missingDefaultFields];
}

function isHiddenService(service: {
  hiddenFromCustomerPortal?: unknown;
  isDefaultPersonalDetails?: unknown;
}) {
  return Boolean(service.hiddenFromCustomerPortal || service.isDefaultPersonalDetails);
}

function normalizeDateValue(value: unknown) {
  if (!value) {
    return null;
  }

  const parsedDate = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function normalizeCountryName(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized.toLowerCase() === "default" ? "" : normalized;
}

function normalizeAttachmentFileName(input: string, fallback: string) {
  const trimmed = input.trim();
  const candidate = trimmed || fallback;
  return (
    candidate
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 180) || fallback
  );
}

function getAttachmentExtensionFromMimeType(mimeType: string) {
  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function parseAppealAttachmentDataUrl(dataUrl: string) {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1].trim().toLowerCase();
  if (!APPEAL_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const base64Payload = match[2].replace(/\s+/g, "");
  if (!base64Payload) {
    return null;
  }

  try {
    const content = Buffer.from(base64Payload, "base64");
    if (content.byteLength === 0) {
      return null;
    }

    return {
      mimeType,
      content,
      normalizedDataUrl: `data:${mimeType};base64,${base64Payload}`,
    };
  } catch {
    return null;
  }
}

function normalizeAppealAttachment(payload: {
  attachmentData?: string;
  attachmentFileName?: string;
  attachmentMimeType?: string;
  attachmentFileSize?: number | null;
}) {
  const rawData = payload.attachmentData?.trim() ?? "";
  const hasMetadata =
    Boolean(payload.attachmentFileName?.trim()) ||
    Boolean(payload.attachmentMimeType?.trim()) ||
    Boolean(payload.attachmentFileSize);

  if (!rawData) {
    if (hasMetadata) {
      return {
        ok: false as const,
        error: "Attachment metadata was provided without file data.",
      };
    }

    return {
      ok: true as const,
      value: {
        attachmentFileName: "",
        attachmentMimeType: "",
        attachmentFileSize: null,
        attachmentData: "",
      },
    };
  }

  const parsed = parseAppealAttachmentDataUrl(rawData);
  if (!parsed) {
    return {
      ok: false as const,
      error: "Attachment must be a valid PDF, PNG, JPG, or WEBP file.",
    };
  }

  if (parsed.content.byteLength > MAX_APPEAL_ATTACHMENT_BYTES) {
    return {
      ok: false as const,
      error: "Attachment must be 5MB or smaller.",
    };
  }

  if (
    typeof payload.attachmentFileSize === "number" &&
    payload.attachmentFileSize > MAX_APPEAL_ATTACHMENT_BYTES
  ) {
    return {
      ok: false as const,
      error: "Attachment must be 5MB or smaller.",
    };
  }

  const extension = getAttachmentExtensionFromMimeType(parsed.mimeType);
  const fallbackName = `appeal-attachment.${extension}`;
  const normalizedFileName = normalizeAttachmentFileName(
    payload.attachmentFileName ?? "",
    fallbackName,
  );

  return {
    ok: true as const,
    value: {
      attachmentFileName: normalizedFileName,
      attachmentMimeType: parsed.mimeType,
      attachmentFileSize: parsed.content.byteLength,
      attachmentData: parsed.normalizedDataUrl,
    },
  };
}

function getEnterpriseDecisionWindowState(requestDoc: {
  status?: unknown;
  enterpriseApprovedAt?: unknown;
  enterpriseDecisionLockedAt?: unknown;
  updatedAt?: unknown;
}) {
  const status = String(requestDoc.status ?? "");
  if (status !== "approved") {
    return {
      approvedAt: null,
      lockedAt: null,
      remainingMs: 0,
      isLocked: false,
      shouldLockNow: false,
    };
  }

  const approvedAt =
    normalizeDateValue(requestDoc.enterpriseApprovedAt) ??
    normalizeDateValue(requestDoc.updatedAt);
  const lockedAt = normalizeDateValue(requestDoc.enterpriseDecisionLockedAt);

  if (lockedAt) {
    return {
      approvedAt,
      lockedAt,
      remainingMs: 0,
      isLocked: true,
      shouldLockNow: false,
    };
  }

  if (!approvedAt) {
    return {
      approvedAt: null,
      lockedAt: null,
      remainingMs: 0,
      isLocked: true,
      shouldLockNow: true,
    };
  }

  const elapsedMs = Date.now() - approvedAt.getTime();
  if (elapsedMs >= ENTERPRISE_REJECTION_WINDOW_MS) {
    return {
      approvedAt,
      lockedAt: null,
      remainingMs: 0,
      isLocked: true,
      shouldLockNow: true,
    };
  }

  return {
    approvedAt,
    lockedAt: null,
    remainingMs: Math.max(0, ENTERPRISE_REJECTION_WINDOW_MS - elapsedMs),
    isLocked: false,
    shouldLockNow: false,
  };
}

function companyIdFromAuth(auth: {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
}) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

async function buildScopedRequestFilter(auth: {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
}, companyId: string) {
  if (auth.role === "customer") {
    return {
      ok: true as const,
      filter: { customer: companyId } as Record<string, unknown>,
    };
  }

  if (auth.role === "delegate_user") {
    const delegateUser = await User.findById(auth.userId)
      .select("_id parentCustomer createdByDelegate")
      .lean();

    if (!delegateUser || !delegateUser.createdByDelegate) {
      return {
        ok: false as const,
        error:
          "Your user account is not assigned to a delegate. Please contact enterprise admin.",
      };
    }

    if (String(delegateUser.parentCustomer || "") !== companyId) {
      return {
        ok: false as const,
        error: "Invalid account mapping.",
      };
    }

    return {
      ok: true as const,
      filter: {
        customer: companyId,
        createdBy: auth.userId,
      } as Record<string, unknown>,
    };
  }

  const managedUsers = await User.find({
    parentCustomer: companyId,
    createdByDelegate: auth.userId,
  })
    .select("_id")
    .lean();

  const creatorIds = [
    auth.userId,
    ...managedUsers.map((member) => String(member._id)),
  ];

  return {
    ok: true as const,
    filter: {
      customer: companyId,
      createdBy: { $in: creatorIds },
    } as Record<string, unknown>,
  };
}

type CompanyServiceSelection = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: SupportedCurrency;
  countryRates: Array<{
    country: string;
    price: number;
    currency: SupportedCurrency;
  }>;
  isPackage: boolean;
  includedServiceIds: string[];
  hiddenFromCustomerPortal: boolean;
};

type ExpandedSelectedService = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: SupportedCurrency;
};

type DuplicateServiceMatch = {
  requestId: string;
  serviceId: string;
  serviceName: string;
  requestedByName: string;
  requestedAt: string;
  requestStatus: string;
};

type DuplicateRequestCandidate = {
  _id: unknown;
  selectedServices?: Array<{
    serviceId?: unknown;
    serviceName?: unknown;
  }>;
  createdBy?: unknown;
  createdAt?: unknown;
  status?: unknown;
};

type PersonalDetailsService = {
  serviceId: string;
  serviceName: string;
  currency: SupportedCurrency;
};

function normalizeCountryRates(
  value: unknown,
  fallbackCurrency: SupportedCurrency,
): CompanyServiceSelection["countryRates"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Map<string, CompanyServiceSelection["countryRates"][number]>();

  for (const entry of value) {
    const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!raw) {
      continue;
    }

    const country = normalizeCountryName(raw.country);
    const price = Number(raw.price);
    const currencyCandidate = String(raw.currency ?? "") as SupportedCurrency;
    const currency =
      currencyCandidate &&
      SUPPORTED_CURRENCIES.includes(currencyCandidate)
        ? currencyCandidate
        : fallbackCurrency;

    if (!country || !Number.isFinite(price) || price < 0) {
      continue;
    }

    deduped.set(country.toLowerCase(), {
      country,
      price,
      currency,
    });
  }

  return [...deduped.values()];
}

function resolveCountryRateForService(
  service: Pick<CompanyServiceSelection, "price" | "currency" | "countryRates">,
  verificationCountry: string,
  companyCountry: string,
) {
  const normalizedVerificationCountry = normalizeCountryName(verificationCountry).toLowerCase();
  const normalizedCompanyCountry = normalizeCountryName(companyCountry).toLowerCase();

  if (normalizedVerificationCountry) {
    const requestedRate = service.countryRates.find(
      (rate) => normalizeCountryName(rate.country).toLowerCase() === normalizedVerificationCountry,
    );
    if (requestedRate) {
      return {
        price: requestedRate.price,
        currency: requestedRate.currency,
      };
    }
  }

  if (normalizedCompanyCountry) {
    const fallbackRate = service.countryRates.find(
      (rate) => normalizeCountryName(rate.country).toLowerCase() === normalizedCompanyCountry,
    );
    if (fallbackRate) {
      return {
        price: fallbackRate.price,
        currency: fallbackRate.currency,
      };
    }
  }

  return {
    price: service.price,
    currency: service.currency,
  };
}

function toPersonalDetailsService(service: {
  _id: unknown;
  name?: string;
  defaultCurrency?: unknown;
}): PersonalDetailsService {
  return {
    serviceId: String(service._id),
    serviceName: service.name?.trim() || DEFAULT_PERSONAL_DETAILS_SERVICE_NAME,
    currency: (service.defaultCurrency ?? "INR") as SupportedCurrency,
  };
}

async function ensureDefaultPersonalDetailsService(): Promise<PersonalDetailsService> {
  const existingDefault = await Service.findOne({ isDefaultPersonalDetails: true })
    .select(
      "_id name defaultCurrency hiddenFromCustomerPortal isPackage defaultPrice includedServiceIds formFields",
    )
    .lean();

  if (existingDefault) {
    const mergedFormFields = mergePersonalDetailsFormFields(existingDefault.formFields);
    const shouldSeedDefaultFields =
      !Array.isArray(existingDefault.formFields) || existingDefault.formFields.length === 0;
    const shouldBackfillDefaultFields =
      Array.isArray(existingDefault.formFields) &&
      mergedFormFields.length !== existingDefault.formFields.length;

    if (
      !isHiddenService(existingDefault) ||
      Boolean(existingDefault.isPackage) ||
      Number(existingDefault.defaultPrice ?? 0) !== 0 ||
      (existingDefault.includedServiceIds ?? []).length > 0 ||
      shouldSeedDefaultFields ||
      shouldBackfillDefaultFields
    ) {
      await Service.findByIdAndUpdate(existingDefault._id, {
        hiddenFromCustomerPortal: true,
        isDefaultPersonalDetails: true,
        isPackage: false,
        includedServiceIds: [],
        defaultPrice: 0,
        ...(shouldSeedDefaultFields || shouldBackfillDefaultFields
          ? {
              formFields: mergedFormFields,
            }
          : {}),
      });
    }

    return toPersonalDetailsService(existingDefault);
  }

  const existingByName = await Service.findOne({
    name: { $regex: /^personal\s+details$/i },
  })
    .select("_id name defaultCurrency formFields")
    .lean();

  if (existingByName) {
    const mergedFormFields = mergePersonalDetailsFormFields(existingByName.formFields);
    const shouldSeedDefaultFields =
      !Array.isArray(existingByName.formFields) || existingByName.formFields.length === 0;
    const shouldBackfillDefaultFields =
      Array.isArray(existingByName.formFields) &&
      mergedFormFields.length !== existingByName.formFields.length;

    await Service.findByIdAndUpdate(existingByName._id, {
      hiddenFromCustomerPortal: true,
      isDefaultPersonalDetails: true,
      isPackage: false,
      includedServiceIds: [],
      defaultPrice: 0,
      ...(shouldSeedDefaultFields || shouldBackfillDefaultFields
        ? {
            formFields: mergedFormFields,
          }
        : {}),
    });

    return toPersonalDetailsService(existingByName);
  }

  const createdService = await Service.create({
    name: DEFAULT_PERSONAL_DETAILS_SERVICE_NAME,
    description: "System service that captures candidate personal details.",
    defaultPrice: 0,
    defaultCurrency: "INR",
    isPackage: false,
    includedServiceIds: [],
    hiddenFromCustomerPortal: true,
    isDefaultPersonalDetails: true,
    formFields: DEFAULT_PERSONAL_DETAILS_FORM_FIELDS,
  });

  return toPersonalDetailsService(createdService);
}

async function getCompanyProfile(companyId: string) {
  const company = await User.findById(companyId).lean();
  if (!company || company.role !== "customer") {
    return null;
  }

  const companyCountry = normalizeCountryName(
    company.partnerProfile?.companyInformation?.address?.country ||
      company.partnerProfile?.invoicingInformation?.address?.country ||
      "",
  );

  const selectedServices = (company.selectedServices ?? []).map((item) => ({
    serviceId: String(item.serviceId),
    serviceName: item.serviceName,
    price: typeof item.price === "number" ? item.price : 0,
    currency: item.currency as SupportedCurrency,
    countryRates: normalizeCountryRates(item.countryRates, item.currency as SupportedCurrency),
  }));

  const selectedServiceIds = [...new Set(selectedServices.map((item) => item.serviceId))];
  const serviceDocs =
    selectedServiceIds.length > 0
      ? await Service.find({ _id: { $in: selectedServiceIds } })
          .select(
            "name defaultPrice defaultCurrency isPackage includedServiceIds hiddenFromCustomerPortal isDefaultPersonalDetails",
          )
          .lean()
      : [];

  const serviceMap = new Map(
    serviceDocs.map((service) => [
      String(service._id),
      {
        name: service.name,
        defaultPrice: typeof service.defaultPrice === "number" ? service.defaultPrice : 0,
        defaultCurrency: (service.defaultCurrency ?? "INR") as SupportedCurrency,
        isPackage: Boolean(service.isPackage),
        includedServiceIds: (service.includedServiceIds ?? []).map((id) => String(id)),
        hiddenFromCustomerPortal: isHiddenService(service),
      },
    ]),
  );

  const resolvedServices = selectedServices
    .map((item) => {
      const serviceMeta = serviceMap.get(item.serviceId);

      return {
        serviceId: item.serviceId,
        serviceName: item.serviceName || serviceMeta?.name || "Service",
        price: item.price,
        currency: item.currency,
        countryRates: item.countryRates,
        isPackage: Boolean(serviceMeta?.isPackage),
        includedServiceIds: serviceMeta?.includedServiceIds ?? [],
        hiddenFromCustomerPortal: Boolean(serviceMeta?.hiddenFromCustomerPortal),
      } satisfies CompanyServiceSelection;
    })
    .filter((item) => !item.hiddenFromCustomerPortal);

  return {
    companyName: company.name || "Company",
    companyCountry,
    services: resolvedServices,
  };
}

async function expandSelectedServices(
  selectedServiceIds: string[],
  companyServices: CompanyServiceSelection[],
  verificationCountry: string,
  companyCountry: string,
) {
  const assignmentMap = new Map(companyServices.map((service) => [service.serviceId, service]));
  const selectedAssignments = selectedServiceIds
    .map((serviceId) => assignmentMap.get(serviceId))
    .filter(
      (service): service is CompanyServiceSelection =>
        Boolean(service && !service.hiddenFromCustomerPortal),
    );

  const includedServiceIds = [
    ...new Set(
      selectedAssignments.flatMap((service) =>
        service.isPackage ? service.includedServiceIds : [],
      ),
    ),
  ];

  const includedServiceDocs =
    includedServiceIds.length > 0
      ? await Service.find({ _id: { $in: includedServiceIds } })
          .select(
            "name defaultPrice defaultCurrency isPackage hiddenFromCustomerPortal isDefaultPersonalDetails",
          )
          .lean()
      : [];

  const includedServiceMap = new Map(
    includedServiceDocs.map((service) => [
      String(service._id),
      {
        name: service.name,
        defaultPrice: typeof service.defaultPrice === "number" ? service.defaultPrice : 0,
        defaultCurrency: (service.defaultCurrency ?? "INR") as SupportedCurrency,
        isPackage: Boolean(service.isPackage),
        hiddenFromCustomerPortal: isHiddenService(service),
      },
    ]),
  );

  const expanded: ExpandedSelectedService[] = [];
  const seen = new Set<string>();

  function pushService(service: ExpandedSelectedService) {
    if (seen.has(service.serviceId)) {
      return;
    }

    seen.add(service.serviceId);
    expanded.push(service);
  }

  for (const selectedService of selectedAssignments) {
    if (!selectedService.isPackage || selectedService.includedServiceIds.length === 0) {
      const resolvedRate = resolveCountryRateForService(
        selectedService,
        verificationCountry,
        companyCountry,
      );

      pushService({
        serviceId: selectedService.serviceId,
        serviceName: selectedService.serviceName,
        price: resolvedRate.price,
        currency: resolvedRate.currency,
      });
      continue;
    }

    for (const includedServiceId of selectedService.includedServiceIds) {
      const assignedService = assignmentMap.get(includedServiceId);
      if (assignedService && !assignedService.isPackage && !assignedService.hiddenFromCustomerPortal) {
        const resolvedRate = resolveCountryRateForService(
          assignedService,
          verificationCountry,
          companyCountry,
        );

        pushService({
          serviceId: assignedService.serviceId,
          serviceName: assignedService.serviceName,
          price: resolvedRate.price,
          currency: resolvedRate.currency,
        });
        continue;
      }

      const includedService = includedServiceMap.get(includedServiceId);
      if (!includedService || includedService.isPackage || includedService.hiddenFromCustomerPortal) {
        continue;
      }

      pushService({
        serviceId: includedServiceId,
        serviceName: includedService.name,
        price: includedService.defaultPrice,
        currency: includedService.defaultCurrency,
      });
    }
  }

  return expanded;
}

async function findDuplicateServiceMatches(params: {
  companyId: string;
  candidateEmail: string;
  selectedServices: ExpandedSelectedService[];
}) {
  const normalizedCandidateEmail = params.candidateEmail.toLowerCase();
  const selectedServiceNameById = new Map(
    params.selectedServices.map((service) => [service.serviceId, service.serviceName]),
  );
  const selectedServiceIds = [...selectedServiceNameById.keys()];

  if (selectedServiceIds.length === 0) {
    return [] as DuplicateServiceMatch[];
  }

  const existingRequests = (await VerificationRequest.find({
    customer: params.companyId,
    candidateEmail: normalizedCandidateEmail,
    "selectedServices.serviceId": { $in: selectedServiceIds },
  })
    .select("_id selectedServices createdBy createdAt status")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()) as DuplicateRequestCandidate[];

  if (existingRequests.length === 0) {
    return [] as DuplicateServiceMatch[];
  }

  const creatorIds = [
    ...new Set(
      existingRequests.map((item) => String(item.createdBy ?? "")).filter(Boolean),
    ),
  ];

  const creators =
    creatorIds.length > 0
      ? await User.find({ _id: { $in: creatorIds } }).select("name").lean()
      : [];
  const creatorNameById = new Map(
    creators.map((creator) => [String(creator._id), creator.name || "Unknown user"]),
  );

  const duplicateMatches: DuplicateServiceMatch[] = [];

  for (const existingRequest of existingRequests) {
    const requestId = String(existingRequest._id);
    const requestedByName =
      creatorNameById.get(String(existingRequest.createdBy ?? "")) || "Unknown user";
    const requestedAtDate = normalizeDateValue(existingRequest.createdAt);
    const requestedAt = requestedAtDate ? requestedAtDate.toISOString() : "";
    const requestStatus = String(existingRequest.status ?? "pending") || "pending";
    const seenServiceIdsForRequest = new Set<string>();

    for (const selectedService of existingRequest.selectedServices ?? []) {
      const selectedServiceId = String(selectedService.serviceId ?? "");
      if (!selectedServiceId || !selectedServiceNameById.has(selectedServiceId)) {
        continue;
      }

      if (seenServiceIdsForRequest.has(selectedServiceId)) {
        continue;
      }

      seenServiceIdsForRequest.add(selectedServiceId);

      duplicateMatches.push({
        requestId,
        serviceId: selectedServiceId,
        serviceName:
          String(selectedService.serviceName ?? "").trim() ||
          selectedServiceNameById.get(selectedServiceId) ||
          "Service",
        requestedByName,
        requestedAt,
        requestStatus,
      });
    }
  }

  return duplicateMatches;
}

type VerificationEmailPayload = {
  recipientName: string;
  recipientEmail: string;
  companyName: string;
  portalUrl: string;
  tempPassword?: string | null;
  userId?: string | null;
};

type VerificationEmailContent = {
  subject: string;
  text: string;
  html: string;
};

type CandidateCorrectionEmailPayload = {
  recipientName: string;
  recipientEmail: string;
  companyName: string;
  portalUrl: string;
  rejectedFields: Array<{
    serviceName: string;
    question: string;
  }>;
  rejectionComment?: string;
};

type EmailResult = {
  sent: boolean;
  reason?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveCandidatePortalUrl() {
  const configuredUrl = process.env.CANDIDATE_PORTAL_URL?.trim();
  if (configuredUrl) {
    if (/vercel\.(app|com)/i.test(configuredUrl)) {
      return "https://candidate.secure.cluso.in";
    }

    return configuredUrl;
  }

  return "https://candidate.secure.cluso.in";
}

function buildVerificationRequestEmailContent(
  payload: VerificationEmailPayload,
): VerificationEmailContent {
  const subject = "Background Verification Request";
  const safeRecipient = escapeHtml(payload.recipientName);
  const safeCompany = escapeHtml(payload.companyName);
  const safePortalUrl = escapeHtml(payload.portalUrl);
  const safeRecipientEmail = escapeHtml(payload.recipientEmail);
  const resolvedUserId = (payload.userId?.trim() || payload.recipientEmail).trim();
  const safeUserId = escapeHtml(resolvedUserId);
  const hasTemporaryPassword = Boolean(payload.tempPassword?.trim());
  const resolvedTempPassword = hasTemporaryPassword
    ? escapeHtml(payload.tempPassword!.trim())
    : "Password visable to candidate";

  const text = [
    `Dear ${payload.recipientName},`,
    "",
    "We hope you are doing well.",
    "",
    "We, Cluso Infolink, a background verification firm, have been requested to collect and verify your information to assess the genuineness of your application.",
    "",
    `This verification process has been initiated by \"${payload.companyName}\" as part of their standard screening procedure.`,
    "",
    "To proceed, we have provided a secure link to our portal where you can submit your information and upload the required documents:",
    "",
    payload.portalUrl,
    "",
    "Login Credentials:",
    `User ID: ${resolvedUserId}`,
      `Temporary Password: ${payload.tempPassword?.trim() || "Password visable to candidate"}`,
    "",
    "We kindly request your cooperation in completing this process at the earliest. All information shared will be handled with strict confidentiality and used solely for verification purposes.",
    "",
    "If you have any questions or require clarification, please feel free to reach out to us.",
    "",
    "Important: For security reasons, please change your password after signing in.",
    "",
    "Thank you for your cooperation.",
    "",
    "Best regards,",
    "Cluso Infolink Team",
    "indiaops@cluso.in",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F8FAFC;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:#1E293B;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="max-width:680px;width:100%;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="background:#0F172A;color:#FFFFFF;padding:16px 20px;">
                <div style="font-size:18px;font-weight:700;">Cluso Infolink Verification Portal</div>
                <div style="font-size:12px;opacity:0.9;margin-top:4px;">Candidate Verification Access Details</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px;">
                <p style="margin:0 0 14px;">Dear ${safeRecipient},</p>
                <p style="margin:0 0 14px;line-height:1.6;">
                  We hope you are doing well. Cluso Infolink has been requested to verify your information as part of the background screening process initiated by
                  <strong>${safeCompany}</strong>.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #E2E8F0;border-radius:8px;border-collapse:separate;overflow:hidden;margin:10px 0 14px;">
                  <tr>
                    <td colspan="2" style="background:#EFF6FF;color:#1E3A8A;font-weight:700;padding:10px 12px;font-size:14px;">Login Details</td>
                  </tr>
                  <tr>
                    <td style="width:170px;padding:10px 12px;background:#F8FAFC;font-weight:700;border-top:1px solid #E2E8F0;">Portal URL</td>
                    <td style="padding:10px 12px;border-top:1px solid #E2E8F0;"><a href="${safePortalUrl}" style="color:#2563EB;text-decoration:none;">${safePortalUrl}</a></td>
                  </tr>
                  <tr>
                    <td style="width:170px;padding:10px 12px;background:#F8FAFC;font-weight:700;border-top:1px solid #E2E8F0;">User ID</td>
                    <td style="padding:10px 12px;border-top:1px solid #E2E8F0;">${safeUserId}</td>
                  </tr>
                  <tr>
                    <td style="width:170px;padding:10px 12px;background:#F8FAFC;font-weight:700;border-top:1px solid #E2E8F0;">Temporary Password</td>
                    <td style="padding:10px 12px;border-top:1px solid #E2E8F0;">
                      ${hasTemporaryPassword
                        ? `<code style="font-family:Consolas,Menlo,monospace;background:#E2E8F0;border-radius:4px;padding:2px 6px;">${resolvedTempPassword}</code>`
                        : resolvedTempPassword}
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 14px;">
                  <tr>
                    <td style="font-size:14px;line-height:1.6;">
                      <strong>Next steps:</strong>
                      <ol style="margin:8px 0 0 18px;padding:0;">
                        <li>Sign in using the credentials above.</li>
                        <li>Complete the form and upload required documents.</li>
                        <li>Change your password immediately after login.</li>
                      </ol>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 12px;line-height:1.6;">
                  All information shared will be treated as confidential and used only for verification purposes.
                </p>
                <p style="margin:0 0 14px;line-height:1.6;">
                  If you have any questions, please contact us at <a href="mailto:indiaops@cluso.in" style="color:#2563EB;text-decoration:none;">indiaops@cluso.in</a>.
                </p>
                <p style="margin:0;line-height:1.6;">
                  Best regards,<br />
                  <strong>Cluso Infolink Team</strong><br />
                  <span style="color:#475569;">indiaops@cluso.in</span>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return { subject, text, html };
}

async function sendVerificationRequestEmail(payload: VerificationEmailPayload): Promise<EmailResult> {
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = Number(process.env.SMTP_PORT ?? "587");
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpSecure = process.env.SMTP_SECURE === "true" || smtpPort === 465;

  if (!smtpHost || !smtpUser || !smtpPass || Number.isNaN(smtpPort)) {
    return {
      sent: false,
      reason: "SMTP credentials are not configured.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const content = buildVerificationRequestEmailContent(payload);
  const fromAddress =
    process.env.VERIFICATION_MAIL_FROM?.trim() || `Cluso Infolink Team <${smtpUser}>`;

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: payload.recipientEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown email error";
    return { sent: false, reason };
  }
}

async function sendCandidateCorrectionEmail(
  payload: CandidateCorrectionEmailPayload,
): Promise<EmailResult> {
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = Number(process.env.SMTP_PORT ?? "587");
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpSecure = process.env.SMTP_SECURE === "true" || smtpPort === 465;

  if (!smtpHost || !smtpUser || !smtpPass || Number.isNaN(smtpPort)) {
    return {
      sent: false,
      reason: "SMTP credentials are not configured.",
    };
  }

  if (!payload.recipientEmail.trim()) {
    return {
      sent: false,
      reason: "Candidate email is missing.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const fromAddress =
    process.env.VERIFICATION_MAIL_FROM?.trim() || `Cluso Infolink Team <${smtpUser}>`;
  const subject = "Action Required: Please update your verification details";

  const rejectedFieldLines = payload.rejectedFields.map(
    (field, index) => `${index + 1}. ${field.serviceName}: ${field.question}`,
  );

  const trimmedComment = payload.rejectionComment?.trim() ?? "";

  const text = [
    `Dear ${payload.recipientName},`,
    "",
    `Some submitted details for your verification request from "${payload.companyName}" need correction.`,
    "",
    "Please login to the candidate portal and edit the highlighted fields, then resubmit:",
    payload.portalUrl,
    "",
    "Fields marked for correction:",
    ...rejectedFieldLines,
    trimmedComment ? "" : null,
    trimmedComment ? `Additional note: ${trimmedComment}` : null,
    "",
    "After you resubmit, the request will move back to admin review.",
    "",
    "Best regards,",
    "Cluso Infolink Team",
  ]
    .filter(Boolean)
    .join("\n");

  const safeRecipient = escapeHtml(payload.recipientName);
  const safeCompany = escapeHtml(payload.companyName);
  const safePortalUrl = escapeHtml(payload.portalUrl);
  const noteHtml = trimmedComment
    ? `<p><strong>Additional note:</strong> ${escapeHtml(trimmedComment)}</p>`
    : "";
  const fieldsHtml = payload.rejectedFields
    .map(
      (field) =>
        `<li><strong>${escapeHtml(field.serviceName)}</strong>: ${escapeHtml(field.question)}</li>`,
    )
    .join("");

  const html = `
    <p>Dear ${safeRecipient},</p>
    <p>
      Some submitted details for your verification request from "${safeCompany}" need correction.
    </p>
    <p>
      Please login to the candidate portal and edit the highlighted fields, then resubmit.
    </p>
    <p><a href="${safePortalUrl}">${safePortalUrl}</a></p>
    <p><strong>Fields marked for correction:</strong></p>
    <ol>${fieldsHtml}</ol>
    ${noteHtml}
    <p>After you resubmit, the request will move back to admin review.</p>
    <p>
      Best regards,<br />
      Cluso Infolink Team
    </p>
  `;

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: payload.recipientEmail,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown email error";
    return { sent: false, reason };
  }
}

async function ensureCandidateUser(candidateEmail: string, candidateName: string) {
  const normalizedEmail = candidateEmail.toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail }).select("_id role").lean();

  if (existing) {
    return {
      candidateUserId: existing.role === "candidate" ? String(existing._id) : null,
      created: false,
      tempPassword: null as string | null,
      blockedByRole: existing.role !== "candidate",
    };
  }

  const tempPassword = `Cluso${crypto.randomBytes(4).toString("hex")}`;
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const createdUser = await User.create({
    name: candidateName,
    email: normalizedEmail,
    passwordHash,
    role: "candidate",
  });

  return {
    candidateUserId: String(createdUser._id),
    created: true,
    tempPassword,
    blockedByRole: false,
  };
}

async function regenerateCandidateTemporaryPassword(candidateUserId: string) {
  const tempPassword = `Cluso${crypto.randomBytes(4).toString("hex")}`;
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await User.findOneAndUpdate(
    { _id: candidateUserId, role: "candidate" },
    { passwordHash },
  );

  return tempPassword;
}

export async function GET(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.companyAccessStatus === "inactive") {
    return NextResponse.json({ error: COMPANY_ACCESS_INACTIVE_ERROR }, { status: 403 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
  }

  await connectMongo();

  const scopedFilter = await buildScopedRequestFilter(auth, companyId);
  if (!scopedFilter.ok) {
    return NextResponse.json({ error: scopedFilter.error }, { status: 403 });
  }

  const lockCutoff = new Date(Date.now() - ENTERPRISE_REJECTION_WINDOW_MS);
  await VerificationRequest.updateMany(
    {
      ...scopedFilter.filter,
      status: "approved",
      enterpriseDecisionLockedAt: null,
      $or: [
        {
          enterpriseApprovedAt: {
            $type: "date",
            $lte: lockCutoff,
          },
        },
        {
          enterpriseApprovedAt: null,
          updatedAt: {
            $lte: lockCutoff,
          },
        },
      ],
    },
    {
      $set: { enterpriseDecisionLockedAt: new Date() },
    },
  );

  const items = await VerificationRequest.find(scopedFilter.filter)
    .sort({ createdAt: -1 })
    .lean();

  const personalDetailsService = await ensureDefaultPersonalDetailsService();
  const alwaysVisibleResponseServiceIds = new Set([
    personalDetailsService.serviceId,
  ]);

  const selectedServiceIds = [
    ...new Set(
      items.flatMap((item) =>
        (item.selectedServices ?? []).map((service) => String(service.serviceId)),
      ),
    ),
  ];

  const hiddenServiceIds =
    selectedServiceIds.length > 0
      ? new Set(
          (
            await Service.find({ _id: { $in: selectedServiceIds } })
              .select("hiddenFromCustomerPortal isDefaultPersonalDetails")
              .lean()
          )
            .filter((service) => isHiddenService(service))
            .map((service) => String(service._id)),
        )
      : new Set<string>();

  const creatorIds = [...new Set(items.map((item) => String(item.createdBy)))];
  const creators =
    creatorIds.length > 0
      ? await User.find({ _id: { $in: creatorIds } })
          .select("name role createdByDelegate")
          .lean()
      : [];
  const creatorMap = new Map(
    creators.map((item) => [
      String(item._id),
      {
        name: item.name,
        role: item.role,
        createdByDelegate: item.createdByDelegate ? String(item.createdByDelegate) : null,
      },
    ]),
  );

  const delegateIds = [
    ...new Set(
      creators
        .map((item) =>
          item.role === "delegate_user" && item.createdByDelegate
            ? String(item.createdByDelegate)
            : "",
        )
        .filter(Boolean),
    ),
  ];

  const delegates =
    delegateIds.length > 0
      ? await User.find({ _id: { $in: delegateIds } }).select("name").lean()
      : [];
  const delegateMap = new Map(delegates.map((item) => [String(item._id), item.name]));

  function resolveDelegateName(item: { createdBy: unknown; createdByDelegate?: unknown }) {
    const creator = creatorMap.get(String(item.createdBy));
    if (!creator) {
      return "-";
    }

    if (creator.role === "delegate") {
      return creator.name;
    }

    if (creator.role === "delegate_user") {
      const requestDelegateId = item.createdByDelegate
        ? String(item.createdByDelegate)
        : null;
      const parentDelegateId = requestDelegateId || creator.createdByDelegate;

      if (parentDelegateId) {
        const parentDelegateName = delegateMap.get(parentDelegateId);
        if (parentDelegateName) {
          return parentDelegateName;
        }
      }

      return "-";
    }

    return "-";
  }

  const enriched = items.map((item) => {
    const decisionState = getEnterpriseDecisionWindowState(item);
    const visibleSelectedServices = (item.selectedServices ?? []).filter(
      (service) => !hiddenServiceIds.has(String(service.serviceId)),
    );
    const visibleServiceIds = new Set(
      visibleSelectedServices.map((service) => String(service.serviceId)),
    );

    const visibleServiceVerifications = (item.serviceVerifications ?? []).filter((verification) =>
      visibleServiceIds.has(String(verification.serviceId)),
    );

    const visibleCandidateFormResponses = (item.candidateFormResponses ?? [])
      .filter((serviceResponse) => {
        const serviceId = String(serviceResponse.serviceId);
        return (
          visibleServiceIds.has(serviceId) ||
          alwaysVisibleResponseServiceIds.has(serviceId)
        );
      })
      .map((serviceResponse) => {
        const serviceEntryCountRaw = Number(serviceResponse.serviceEntryCount);
        const serviceEntryCount =
          Number.isFinite(serviceEntryCountRaw) && serviceEntryCountRaw > 0
            ? Math.floor(serviceEntryCountRaw)
            : 1;

        return {
          serviceId: String(serviceResponse.serviceId),
          serviceName: serviceResponse.serviceName,
          serviceEntryCount,
          answers: (serviceResponse.answers ?? []).map((answer) => ({
            fieldKey: answer.fieldKey ?? "",
            question: answer.question,
            fieldType: answer.fieldType,
            required: Boolean(answer.required),
            repeatable: Boolean(answer.repeatable),
            notApplicable: Boolean(answer.notApplicable),
            notApplicableText: answer.notApplicableText ?? "",
            value: answer.value,
            fileName: answer.fileName ?? "",
            fileMimeType: answer.fileMimeType ?? "",
            fileSize: answer.fileSize ?? null,
            fileData: answer.fileData ?? "",
            entryFiles: Array.isArray(answer.entryFiles)
              ? answer.entryFiles
                  .map((entryFile) => ({
                    entryIndex:
                      typeof entryFile.entryIndex === "number" &&
                      Number.isFinite(entryFile.entryIndex) &&
                      entryFile.entryIndex > 0
                        ? Math.floor(entryFile.entryIndex)
                        : 1,
                    fileName: entryFile.fileName ?? "",
                    fileMimeType: entryFile.fileMimeType ?? "",
                    fileSize: entryFile.fileSize ?? null,
                    fileData: entryFile.fileData ?? "",
                  }))
                  .filter((entryFile) => Boolean(entryFile.fileData))
                  .sort((first, second) => first.entryIndex - second.entryIndex)
              : [],
          })),
        };
      });

    const visibleCustomerRejectedFields = (item.customerRejectedFields ?? []).filter((field) =>
      visibleServiceIds.has(String(field.serviceId)),
    );

    const visibleInvoiceSnapshot = item.invoiceSnapshot
      ? {
          ...item.invoiceSnapshot,
          items: (item.invoiceSnapshot.items ?? []).filter(
            (invoiceItem: { serviceId: unknown }) =>
              visibleServiceIds.has(String(invoiceItem.serviceId)),
          ),
        }
      : item.invoiceSnapshot ?? null;

    const isReportSharedWithCustomer =
      Boolean(item.reportData) &&
      Boolean(item.reportMetadata && item.reportMetadata.customerSharedAt);

    return {
      ...item,
      selectedServices: visibleSelectedServices,
      serviceVerifications: visibleServiceVerifications,
      candidateFormResponses: visibleCandidateFormResponses,
      customerRejectedFields: visibleCustomerRejectedFields,
      reportMetadata: isReportSharedWithCustomer ? item.reportMetadata ?? null : null,
      reportData: isReportSharedWithCustomer ? item.reportData ?? null : null,
      reverificationAppeal: item.reverificationAppeal ?? null,
      invoiceSnapshot: visibleInvoiceSnapshot,
      createdByName: creatorMap.get(String(item.createdBy))?.name ?? "Unknown",
      createdByRole: creatorMap.get(String(item.createdBy))?.role ?? "unknown",
      delegateName: resolveDelegateName(item),
      enterpriseApprovedAt: decisionState.approvedAt ?? item.enterpriseApprovedAt ?? null,
      enterpriseDecisionLockedAt:
        decisionState.lockedAt ?? item.enterpriseDecisionLockedAt ?? null,
      enterpriseDecisionLocked: decisionState.isLocked,
      enterpriseDecisionRemainingMs: decisionState.remainingMs,
    };
  });

  return NextResponse.json({ items: enriched });
}

export async function POST(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.companyAccessStatus === "inactive") {
    return NextResponse.json({ error: COMPANY_ACCESS_INACTIVE_ERROR }, { status: 403 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidate details." }, { status: 400 });
  }

  await connectMongo();

  let createdByDelegateId: string | null = null;

  if (auth.role === "delegate") {
    createdByDelegateId = auth.userId;
  }

  if (auth.role === "delegate_user") {
    const delegateUser = await User.findById(auth.userId)
      .select("_id parentCustomer createdByDelegate")
      .lean();

    if (!delegateUser || !delegateUser.createdByDelegate) {
      return NextResponse.json(
        { error: "Your user account is not assigned to a delegate." },
        { status: 403 },
      );
    }

    if (String(delegateUser.parentCustomer || "") !== companyId) {
      return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
    }

    createdByDelegateId = String(delegateUser.createdByDelegate);
  }

  const companyProfile = await getCompanyProfile(companyId);
  if (!companyProfile) {
    return NextResponse.json({ error: "Company account not found." }, { status: 404 });
  }

  const companyServices = companyProfile.services;

  if (companyServices.length > 0 && parsed.data.selectedServiceIds.length === 0) {
    return NextResponse.json(
      { error: "Please select at least one service." },
      { status: 400 },
    );
  }

  const allowedServiceIds = new Set(companyServices.map((item) => item.serviceId));
  const invalidService = parsed.data.selectedServiceIds.find((id) => !allowedServiceIds.has(id));
  if (invalidService) {
    return NextResponse.json(
      { error: "Selected service is not allowed for this company." },
      { status: 400 },
    );
  }

  const resolvedVerificationCountry = normalizeCountryName(
    parsed.data.verificationCountry || companyProfile.companyCountry || "",
  );

  const selectedCompanyServices = await expandSelectedServices(
    parsed.data.selectedServiceIds,
    companyServices,
    resolvedVerificationCountry,
    companyProfile.companyCountry,
  );

  if (parsed.data.selectedServiceIds.length > 0 && selectedCompanyServices.length === 0) {
    return NextResponse.json(
      { error: "Selected package deal is misconfigured. Please contact admin." },
      { status: 400 },
    );
  }

  if (!parsed.data.allowDuplicateSubmission) {
    const duplicateMatches = await findDuplicateServiceMatches({
      companyId,
      candidateEmail: parsed.data.candidateEmail,
      selectedServices: selectedCompanyServices,
    });

    if (duplicateMatches.length > 0) {
      return NextResponse.json(
        {
          error:
            "Potential duplicate request detected for this candidate email and selected services.",
          duplicateCheck: {
            candidateEmail: parsed.data.candidateEmail.toLowerCase(),
            matches: duplicateMatches,
          },
        },
        { status: 409 },
      );
    }
  }

  const candidateAccount = await ensureCandidateUser(
    parsed.data.candidateEmail,
    parsed.data.candidateName,
  );

  await VerificationRequest.create({
    candidateName: parsed.data.candidateName,
    candidateEmail: parsed.data.candidateEmail.toLowerCase(),
    candidatePhone: parsed.data.candidatePhone || "",
    verificationCountry: resolvedVerificationCountry,
    customer: companyId,
    createdBy: auth.userId,
    createdByDelegate: createdByDelegateId,
    candidateUser: candidateAccount.candidateUserId,
    status: "pending",
    candidateFormStatus: "pending",
    candidateSubmittedAt: null,
    candidateFormResponses: [],
    selectedServices: selectedCompanyServices.map((item) => ({
      ...item,
      yearsOfChecking: parsed.data.serviceConfigs[item.serviceId] || "default",
    })),
  });

  const portalUrl = resolveCandidatePortalUrl();
  const emailResult = await sendVerificationRequestEmail({
    recipientName: parsed.data.candidateName,
    recipientEmail: parsed.data.candidateEmail.toLowerCase(),
    companyName: companyProfile.companyName,
    portalUrl,
    tempPassword: candidateAccount.created ? candidateAccount.tempPassword : null,
  });

  const messageParts = [
    "Order created. Candidate will appear in admin queue after form submission.",
  ];

  if (emailResult.sent) {
    messageParts.push("Candidate email sent successfully.");
  } else {
    messageParts.push(
      `Order saved, but candidate email was not sent (${emailResult.reason || "email delivery failed"}).`,
    );
  }

  if (candidateAccount.created && candidateAccount.tempPassword) {
    messageParts.push("New candidate account created.");
  } else if (candidateAccount.blockedByRole) {
    messageParts.push(
      "An account with this email already exists with a non-candidate role, so candidate login is not enabled for this email.",
    );
  }

  return NextResponse.json(
    { message: messageParts.join(" ") },
    { status: 201 },
  );
}

export async function PATCH(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.companyAccessStatus === "inactive") {
    return NextResponse.json({ error: COMPANY_ACCESS_INACTIVE_ERROR }, { status: 403 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
  }

  const body = await req.json();

  await connectMongo();

  const scopedFilter = await buildScopedRequestFilter(auth, companyId);
  if (!scopedFilter.ok) {
    return NextResponse.json({ error: scopedFilter.error }, { status: 403 });
  }

  const previewCandidateEmailParsed = previewCandidateLinkEmailSchema.safeParse(body);
  if (previewCandidateEmailParsed.success) {
    const requestFilter: Record<string, unknown> = {
      ...scopedFilter.filter,
      _id: previewCandidateEmailParsed.data.requestId,
    };

    const requestDoc = await VerificationRequest.findOne(requestFilter)
      .select("candidateName candidateEmail candidateUser")
      .lean();

    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const candidateEmail = String(requestDoc.candidateEmail ?? "").trim().toLowerCase();
    if (!candidateEmail) {
      return NextResponse.json({ error: "Candidate email is missing for this request." }, { status: 400 });
    }

    const companyProfile = await getCompanyProfile(companyId);
    if (!companyProfile) {
      return NextResponse.json({ error: "Company account not found." }, { status: 404 });
    }

    const candidateAccount = await ensureCandidateUser(
      candidateEmail,
      String(requestDoc.candidateName ?? "Candidate").trim() || "Candidate",
    );

    if (candidateAccount.blockedByRole) {
      return NextResponse.json(
        {
          error:
            "Candidate login cannot be enabled because this email is already assigned to another user role.",
        },
        { status: 400 },
      );
    }

    const normalizedRequestCandidateUser = String(requestDoc.candidateUser ?? "").trim();
    if (
      candidateAccount.candidateUserId &&
      normalizedRequestCandidateUser !== candidateAccount.candidateUserId
    ) {
      await VerificationRequest.findByIdAndUpdate(previewCandidateEmailParsed.data.requestId, {
        candidateUser: candidateAccount.candidateUserId,
      });
    }

    const recentlyCreated = Boolean(
      candidateAccount.candidateUserId &&
        requestDoc.createdAt &&
        Date.now() - new Date(requestDoc.createdAt).getTime() < 10 * 60 * 1000,
    );
    const isNewUser = candidateAccount.created || recentlyCreated;

    const tempPassword = isNewUser
      ? await regenerateCandidateTemporaryPassword(candidateAccount.candidateUserId!)
      : null;

    const portalUrl = resolveCandidatePortalUrl();
    const emailContent = buildVerificationRequestEmailContent({
      recipientName: String(requestDoc.candidateName ?? "Candidate").trim() || "Candidate",
      recipientEmail: candidateEmail,
      companyName: companyProfile.companyName,
      portalUrl,
      tempPassword,
      userId: candidateEmail,
    });

    return NextResponse.json({
      message: "Candidate email preview generated.",
      recipientEmail: candidateEmail,
      userId: candidateEmail,
      temporaryPassword: tempPassword,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
      portalUrl,
    });
  }

  const resendCandidateLinkParsed = resendCandidateLinkSchema.safeParse(body);
  if (resendCandidateLinkParsed.success) {
    const requestFilter: Record<string, unknown> = {
      ...scopedFilter.filter,
      _id: resendCandidateLinkParsed.data.requestId,
    };

    const requestDoc = await VerificationRequest.findOne(requestFilter)
      .select("candidateName candidateEmail candidateUser candidateFormStatus status")
      .lean();

    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    if (requestDoc.status === "verified") {
      return NextResponse.json(
        { error: "Verified requests do not require candidate form link resend." },
        { status: 400 },
      );
    }

    if (requestDoc.candidateFormStatus === "submitted") {
      return NextResponse.json(
        { error: "Candidate already submitted the form for this request." },
        { status: 400 },
      );
    }

    const candidateEmail = String(requestDoc.candidateEmail ?? "").trim().toLowerCase();
    if (!candidateEmail) {
      return NextResponse.json({ error: "Candidate email is missing for this request." }, { status: 400 });
    }

    const companyProfile = await getCompanyProfile(companyId);
    if (!companyProfile) {
      return NextResponse.json({ error: "Company account not found." }, { status: 404 });
    }

    const candidateAccount = await ensureCandidateUser(
      candidateEmail,
      String(requestDoc.candidateName ?? "Candidate").trim() || "Candidate",
    );

    if (candidateAccount.blockedByRole) {
      return NextResponse.json(
        {
          error:
            "Candidate login cannot be enabled because this email is already assigned to another user role.",
        },
        { status: 400 },
      );
    }

    const normalizedRequestCandidateUser = String(requestDoc.candidateUser ?? "").trim();
    if (
      candidateAccount.candidateUserId &&
      normalizedRequestCandidateUser !== candidateAccount.candidateUserId
    ) {
      await VerificationRequest.findByIdAndUpdate(resendCandidateLinkParsed.data.requestId, {
        candidateUser: candidateAccount.candidateUserId,
      });
    }

    const recentlyCreated = Boolean(
      candidateAccount.candidateUserId &&
        requestDoc.createdAt &&
        Date.now() - new Date(requestDoc.createdAt).getTime() < 10 * 60 * 1000,
    );
    const isNewUser = candidateAccount.created || recentlyCreated;

    const tempPassword = isNewUser
      ? await regenerateCandidateTemporaryPassword(candidateAccount.candidateUserId!)
      : null;

    const portalUrl = resolveCandidatePortalUrl();
    const emailPayload: VerificationEmailPayload = {
      recipientName: String(requestDoc.candidateName ?? "Candidate").trim() || "Candidate",
      recipientEmail: candidateEmail,
      companyName: companyProfile.companyName,
      portalUrl,
      tempPassword,
      userId: candidateEmail,
    };

    const emailContent = buildVerificationRequestEmailContent(emailPayload);
    const emailResult = await sendVerificationRequestEmail(emailPayload);

    if (!emailResult.sent) {
      return NextResponse.json(
        {
          error: `Could not resend candidate email (${emailResult.reason || "email delivery failed"}).`,
          recipientEmail: candidateEmail,
          userId: candidateEmail,
          temporaryPassword: tempPassword,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
          portalUrl,
        },
        { status: 502 },
      );
    }

    const messageParts = ["Candidate form link resent successfully."];
    if (candidateAccount.created) {
      messageParts.push("New candidate account created.");
    }

    return NextResponse.json({
      message: messageParts.join(" "),
      recipientEmail: candidateEmail,
      userId: candidateEmail,
      temporaryPassword: tempPassword,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
      portalUrl,
    });
  }

  const extraPaymentApprovalDecisionParsed =
    extraPaymentApprovalDecisionSchema.safeParse(body);
  if (extraPaymentApprovalDecisionParsed.success) {
    const payload = extraPaymentApprovalDecisionParsed.data;
    const requestFilter: Record<string, unknown> = {
      ...scopedFilter.filter,
      _id: payload.requestId,
    };

    const requestDoc = await VerificationRequest.findOne(requestFilter).select(
      "serviceVerifications",
    );

    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const requestedAttemptedAt = new Date(payload.attemptedAt);
    if (Number.isNaN(requestedAttemptedAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid attempt identifier for extra payment approval." },
        { status: 400 },
      );
    }

    const targetServiceEntryIndex =
      typeof payload.serviceEntryIndex === "number" &&
      Number.isFinite(payload.serviceEntryIndex) &&
      payload.serviceEntryIndex > 0
        ? Math.floor(payload.serviceEntryIndex)
        : 1;

    const targetService = (requestDoc.serviceVerifications ?? []).find((service) => {
      const serviceId = String(service.serviceId ?? "").trim();
      const serviceEntryIndex =
        typeof service.serviceEntryIndex === "number" &&
        Number.isFinite(service.serviceEntryIndex) &&
        service.serviceEntryIndex > 0
          ? Math.floor(service.serviceEntryIndex)
          : 1;

      return serviceId === payload.serviceId && serviceEntryIndex === targetServiceEntryIndex;
    });

    if (!targetService) {
      return NextResponse.json(
        { error: "Selected service does not belong to this request." },
        { status: 404 },
      );
    }

    const matchingAttempt = (targetService.attempts ?? []).find((attempt) => {
      if (!attempt.attemptedAt) {
        return false;
      }

      const attemptedAt = new Date(attempt.attemptedAt);
      if (Number.isNaN(attemptedAt.getTime())) {
        return false;
      }

      return attemptedAt.getTime() === requestedAttemptedAt.getTime();
    });

    if (!matchingAttempt || !matchingAttempt.extraPaymentApprovalRequested) {
      return NextResponse.json(
        { error: "Extra payment approval request was not found for this attempt." },
        { status: 404 },
      );
    }

    const currentApprovalStatus = String(
      matchingAttempt.extraPaymentApprovalStatus ?? "",
    )
      .trim()
      .toLowerCase();

    if (currentApprovalStatus !== "pending") {
      return NextResponse.json(
        { error: "This extra payment request has already been decided." },
        { status: 400 },
      );
    }

    const now = new Date();
    const trimmedRejectionNote = payload.rejectionNote.trim();
    matchingAttempt.extraPaymentApprovalStatus =
      payload.decision === "approve" ? "approved" : "rejected";
    matchingAttempt.extraPaymentApprovalRespondedAt = now;
    matchingAttempt.extraPaymentApprovalRespondedBy = Types.ObjectId.isValid(auth.userId)
      ? new Types.ObjectId(auth.userId)
      : null;
    matchingAttempt.extraPaymentApprovalRejectionNote =
      payload.decision === "reject"
        ? trimmedRejectionNote || "Rejected by customer."
        : "";

    requestDoc.markModified("serviceVerifications");
    await requestDoc.save();

    return NextResponse.json({
      message:
        payload.decision === "approve"
          ? "Extra payment request approved. Verification team has been notified."
          : "Extra payment request rejected. Verification team has been notified.",
    });
  }

  const appealParsed = appealReverificationSchema.safeParse(body);
  if (appealParsed.success) {
    const requestFilter: Record<string, unknown> = {
      ...scopedFilter.filter,
      _id: appealParsed.data.requestId,
    };

    const requestDoc = await VerificationRequest.findOne(requestFilter)
      .select("status reportMetadata selectedServices serviceVerifications reverificationAppeal")
      .lean();

    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    if (requestDoc.status !== "verified") {
      return NextResponse.json(
        { error: "Appeal is not allowed once validation is completed." },
        { status: 400 },
      );
    }

    if (!requestDoc.reportMetadata?.customerSharedAt) {
      return NextResponse.json(
        { error: "Report must be shared to customer before creating an appeal." },
        { status: 400 },
      );
    }

    const existingAppealStatus =
      (requestDoc.reverificationAppeal as { status?: string } | null)?.status ?? "";
    if (existingAppealStatus === "open") {
      return NextResponse.json(
        { error: "An appeal is already pending for this request." },
        { status: 400 },
      );
    }

    const uniqueServiceIds = [...new Set(appealParsed.data.serviceIds.map((id) => id.trim()))].filter(
      Boolean,
    );
    if (uniqueServiceIds.length === 0) {
      return NextResponse.json(
        { error: "Please select at least one service to appeal." },
        { status: 400 },
      );
    }

    const serviceMap = new Map<string, { serviceId: string; serviceName: string }>();
    for (const service of requestDoc.serviceVerifications ?? []) {
      const serviceId = String(service.serviceId);
      if (!serviceMap.has(serviceId)) {
        serviceMap.set(serviceId, {
          serviceId,
          serviceName: service.serviceName || "Service",
        });
      }
    }

    for (const service of requestDoc.selectedServices ?? []) {
      const serviceId = String(service.serviceId);
      if (!serviceMap.has(serviceId)) {
        serviceMap.set(serviceId, {
          serviceId,
          serviceName: service.serviceName || "Service",
        });
      }
    }

    const selectedAppealServices = uniqueServiceIds
      .map((serviceId) => serviceMap.get(serviceId))
      .filter(
        (
          service,
        ): service is {
          serviceId: string;
          serviceName: string;
        } => Boolean(service),
      );

    if (selectedAppealServices.length !== uniqueServiceIds.length) {
      return NextResponse.json(
        { error: "One or more selected services are not part of this request." },
        { status: 400 },
      );
    }

    const primaryAppealService = selectedAppealServices[0];

    const normalizedAttachment = normalizeAppealAttachment(appealParsed.data);
    if (!normalizedAttachment.ok) {
      return NextResponse.json({ error: normalizedAttachment.error }, { status: 400 });
    }

    const actor = await User.findById(auth.userId).select("name").lean();
    await VerificationRequest.findByIdAndUpdate(appealParsed.data.requestId, {
      reverificationAppeal: {
        status: "open",
        submittedAt: new Date(),
        submittedBy: auth.userId,
        submittedByName: actor?.name ?? "",
        services: selectedAppealServices,
        serviceId: primaryAppealService.serviceId,
        serviceName: primaryAppealService.serviceName,
        comment: appealParsed.data.comment.trim(),
        attachmentFileName: normalizedAttachment.value.attachmentFileName,
        attachmentMimeType: normalizedAttachment.value.attachmentMimeType,
        attachmentFileSize: normalizedAttachment.value.attachmentFileSize,
        attachmentData: normalizedAttachment.value.attachmentData,
        resolvedAt: null,
        resolvedBy: null,
        resolvedByName: "",
      },
    });

    return NextResponse.json({
      message:
        "Appeal submitted. Admin can now review your comments and attachment for reverification.",
    });
  }

  const revokeAppealParsed = revokeAppealSchema.safeParse(body);
  if (revokeAppealParsed.success) {
    const requestFilter: Record<string, unknown> = {
      ...scopedFilter.filter,
      _id: revokeAppealParsed.data.requestId,
    };

    const requestDoc = await VerificationRequest.findOne(requestFilter)
      .select("reverificationAppeal")
      .lean();

    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const existingAppealStatus =
      (requestDoc.reverificationAppeal as { status?: string } | null)?.status ?? "";
    if (existingAppealStatus !== "open") {
      return NextResponse.json(
        { error: "No pending appeal found for this request." },
        { status: 400 },
      );
    }

    await VerificationRequest.findByIdAndUpdate(revokeAppealParsed.data.requestId, {
      "reverificationAppeal.status": "resolved",
      "reverificationAppeal.resolvedAt": new Date(),
      "reverificationAppeal.resolvedBy": auth.userId,
      "reverificationAppeal.resolvedByName": "Customer",
    });

    return NextResponse.json({
      message: "Pending appeal revoked successfully.",
    });
  }

  const enterpriseDecisionParsed = enterpriseDecisionSchema.safeParse(body);
  if (enterpriseDecisionParsed.success) {
    const requestFilter: Record<string, unknown> = {
      ...scopedFilter.filter,
      _id: enterpriseDecisionParsed.data.requestId,
    };

    const requestDoc = await VerificationRequest.findOne(requestFilter)
      .select(
        "candidateFormStatus status enterpriseApprovedAt enterpriseDecisionLockedAt updatedAt",
      )
      .lean();

    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    if (requestDoc.candidateFormStatus !== "submitted") {
      return NextResponse.json(
        { error: "Candidate has not submitted form data yet." },
        { status: 400 },
      );
    }

    if (requestDoc.status === "verified") {
      return NextResponse.json(
        { error: "Verified requests cannot be changed from enterprise portal." },
        { status: 400 },
      );
    }

    const decisionWindow = getEnterpriseDecisionWindowState(requestDoc);
    if (
      enterpriseDecisionParsed.data.action === "enterprise-reject" &&
      decisionWindow.isLocked
    ) {
      return NextResponse.json(
        {
          error:
            "This request is locked. Enterprise rejection is only allowed within 10 minutes of approval.",
        },
        { status: 400 },
      );
    }

    if (
      enterpriseDecisionParsed.data.action === "enterprise-approve" &&
      requestDoc.status === "approved"
    ) {
      return NextResponse.json(
        { error: "This request is already approved by enterprise." },
        { status: 400 },
      );
    }

    if (enterpriseDecisionParsed.data.action === "enterprise-approve") {
      await VerificationRequest.findByIdAndUpdate(enterpriseDecisionParsed.data.requestId, {
        status: "approved",
        candidateFormStatus: "submitted",
        rejectionNote: "",
        customerRejectedFields: [],
        enterpriseApprovedAt: new Date(),
        enterpriseDecisionLockedAt: null,
      });

      return NextResponse.json({ message: "Request approved by enterprise." });
    }

    const trimmedRejectionNote = enterpriseDecisionParsed.data.rejectionNote.trim();

    await VerificationRequest.findByIdAndUpdate(enterpriseDecisionParsed.data.requestId, {
      status: "rejected",
      candidateFormStatus: "submitted",
      rejectionNote: trimmedRejectionNote || "Rejected by enterprise.",
      customerRejectedFields: [],
      enterpriseApprovedAt: null,
      enterpriseDecisionLockedAt: null,
    });

    return NextResponse.json({ message: "Request rejected by enterprise." });
  }

  const rejectParsed = rejectCandidateDataSchema.safeParse(body);
  if (rejectParsed.success) {
    const requestFilter: Record<string, unknown> = {
      ...scopedFilter.filter,
      _id: rejectParsed.data.requestId,
    };

    const requestDoc = await VerificationRequest.findOne(requestFilter)
      .select(
        "candidateName candidateEmail candidateFormStatus status candidateFormResponses enterpriseApprovedAt enterpriseDecisionLockedAt updatedAt",
      )
      .lean();

    if (!requestDoc) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    if (requestDoc.candidateFormStatus !== "submitted") {
      return NextResponse.json(
        { error: "Candidate has not submitted form data yet." },
        { status: 400 },
      );
    }

    if (!requestDoc.candidateFormResponses || requestDoc.candidateFormResponses.length === 0) {
      return NextResponse.json(
        { error: "No candidate form data found for this request." },
        { status: 400 },
      );
    }

    if (requestDoc.status === "verified") {
      return NextResponse.json(
        { error: "Verified requests cannot be rejected from enterprise portal." },
        { status: 400 },
      );
    }

    const decisionWindow = getEnterpriseDecisionWindowState(requestDoc);
    if (requestDoc.status === "approved" && decisionWindow.isLocked) {
      return NextResponse.json(
        {
          error:
            "This request is locked. Candidate data rejection is only allowed within 10 minutes of approval.",
        },
        { status: 400 },
      );
    }

    const availableFieldMap = new Map<
      string,
      {
        serviceId: string;
        serviceName: string;
        fieldKey: string;
        question: string;
        fieldType:
          | "text"
          | "long_text"
          | "number"
          | "file"
          | "date"
          | "dropdown"
          | "email"
          | "mobile"
          | "composite";
      }
    >();

    for (const serviceResponse of requestDoc.candidateFormResponses ?? []) {
      const serviceId = String(serviceResponse.serviceId);
      const serviceName = serviceResponse.serviceName;
      for (const answer of serviceResponse.answers ?? []) {
        const normalizedFieldKey = String(answer.fieldKey ?? "").trim();
        const question = answer.question.trim();
        const fieldInfo = {
          serviceId,
          serviceName,
          fieldKey: normalizedFieldKey,
          question,
          fieldType: answer.fieldType,
        };

        if (question) {
          availableFieldMap.set(`${serviceId}::question::${question}`, fieldInfo);
        }

        if (normalizedFieldKey) {
          availableFieldMap.set(`${serviceId}::field::${normalizedFieldKey}`, fieldInfo);
        }
      }
    }

    const rejectedFieldMap = new Map<
      string,
      {
        serviceId: string;
        serviceName: string;
        fieldKey: string;
        question: string;
        fieldType:
          | "text"
          | "long_text"
          | "number"
          | "file"
          | "date"
          | "dropdown"
          | "email"
          | "mobile"
          | "composite";
      }
    >();

    for (const selectedField of rejectParsed.data.rejectedFields) {
      const normalizedFieldKey = selectedField.fieldKey.trim();
      const normalizedQuestion = selectedField.question.trim();
      const selectedByFieldKey = normalizedFieldKey
        ? availableFieldMap.get(`${selectedField.serviceId}::field::${normalizedFieldKey}`)
        : undefined;
      const selectedByQuestion = availableFieldMap.get(
        `${selectedField.serviceId}::question::${normalizedQuestion}`,
      );
      const matchedField = selectedByFieldKey ?? selectedByQuestion;
      if (!matchedField) {
        return NextResponse.json(
          { error: "One or more selected fields are invalid for this request." },
          { status: 400 },
        );
      }

      const dedupeKey = matchedField.fieldKey
        ? `${matchedField.serviceId}::field::${matchedField.fieldKey}`
        : `${matchedField.serviceId}::question::${matchedField.question}`;

      rejectedFieldMap.set(dedupeKey, matchedField);
    }

    const rejectedFields = [...rejectedFieldMap.values()];
    if (rejectedFields.length === 0) {
      return NextResponse.json(
        { error: "Please select at least one field to reject." },
        { status: 400 },
      );
    }

    const rejectedQuestions = rejectedFields.map((field) => field.question);
    const baseRejectionNote = `Enterprise requested correction for: ${rejectedQuestions.join(", ")}.`;
    const trimmedComment = rejectParsed.data.rejectionComment.trim();
    const rejectionNote = trimmedComment
      ? `${baseRejectionNote} Note: ${trimmedComment}`
      : baseRejectionNote;

    await VerificationRequest.findByIdAndUpdate(rejectParsed.data.requestId, {
      status: "rejected",
      candidateFormStatus: "pending",
      candidateSubmittedAt: null,
      rejectionNote,
      customerRejectedFields: rejectedFields,
      enterpriseApprovedAt: null,
      enterpriseDecisionLockedAt: null,
    });

    const companyProfile = await getCompanyProfile(companyId);
    const correctionEmail = await sendCandidateCorrectionEmail({
      recipientName: requestDoc.candidateName,
      recipientEmail: requestDoc.candidateEmail.toLowerCase(),
      companyName: companyProfile?.companyName ?? "your employer",
      portalUrl: resolveCandidatePortalUrl(),
      rejectedFields: rejectedFields.map((field) => ({
        serviceName: field.serviceName,
        question: field.question,
      })),
      rejectionComment: trimmedComment,
    });

    const messageParts = [
      "Candidate data rejected. Selected fields were marked for correction and candidate can resubmit.",
    ];
    if (correctionEmail.sent) {
      messageParts.push("Candidate correction email sent successfully.");
    } else {
      messageParts.push(
        `Candidate data was rejected, but correction email was not sent (${correctionEmail.reason || "email delivery failed"}).`,
      );
    }

    return NextResponse.json({
      message: messageParts.join(" "),
    });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidate details." }, { status: 400 });
  }

  const companyProfile = await getCompanyProfile(companyId);
  if (!companyProfile) {
    return NextResponse.json({ error: "Company account not found." }, { status: 404 });
  }

  const companyServices = companyProfile.services;

  if (companyServices.length > 0 && parsed.data.selectedServiceIds.length === 0) {
    return NextResponse.json(
      { error: "Please select at least one service." },
      { status: 400 },
    );
  }

  const allowedServiceIds = new Set(companyServices.map((item) => item.serviceId));
  const invalidService = parsed.data.selectedServiceIds.find((id) => !allowedServiceIds.has(id));
  if (invalidService) {
    return NextResponse.json(
      { error: "Selected service is not allowed for this company." },
      { status: 400 },
    );
  }

  const existingFilter: Record<string, unknown> = {
    ...scopedFilter.filter,
    _id: parsed.data.requestId,
  };

  const existing = await VerificationRequest.findOne(existingFilter).lean();

  if (!existing) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (existing.status !== "rejected") {
    return NextResponse.json(
      { error: "Only rejected requests can be edited and resubmitted." },
      { status: 400 },
    );
  }

  const resolvedVerificationCountry = normalizeCountryName(
    parsed.data.verificationCountry ||
      (typeof existing.verificationCountry === "string" ? existing.verificationCountry : "") ||
      companyProfile.companyCountry ||
      "",
  );

  const selectedCompanyServices = await expandSelectedServices(
    parsed.data.selectedServiceIds,
    companyServices,
    resolvedVerificationCountry,
    companyProfile.companyCountry,
  );

  if (parsed.data.selectedServiceIds.length > 0 && selectedCompanyServices.length === 0) {
    return NextResponse.json(
      { error: "Selected package deal is misconfigured. Please contact admin." },
      { status: 400 },
    );
  }

  const candidateAccount = await ensureCandidateUser(
    parsed.data.candidateEmail,
    parsed.data.candidateName,
  );

  await VerificationRequest.findByIdAndUpdate(parsed.data.requestId, {
    candidateName: parsed.data.candidateName,
    candidateEmail: parsed.data.candidateEmail.toLowerCase(),
    candidatePhone: parsed.data.candidatePhone || "",
    verificationCountry: resolvedVerificationCountry,
    candidateUser: candidateAccount.candidateUserId,
    selectedServices: selectedCompanyServices,
    status: "pending",
    candidateFormStatus: "pending",
    candidateSubmittedAt: null,
    candidateFormResponses: [],
    customerRejectedFields: [],
    rejectionNote: "",
    enterpriseApprovedAt: null,
    enterpriseDecisionLockedAt: null,
    reverificationAppeal: null,
  });

  const portalUrl = resolveCandidatePortalUrl();
  const emailResult = await sendVerificationRequestEmail({
    recipientName: parsed.data.candidateName,
    recipientEmail: parsed.data.candidateEmail.toLowerCase(),
    companyName: companyProfile.companyName,
    portalUrl,
    tempPassword: candidateAccount.created ? candidateAccount.tempPassword : null,
  });

  const messageParts = ["Request updated. Candidate must refill the form before admin review."];
  if (emailResult.sent) {
    messageParts.push("Candidate email sent successfully.");
  } else {
    messageParts.push(
      `Request updated, but candidate email was not sent (${emailResult.reason || "email delivery failed"}).`,
    );
  }
  if (candidateAccount.created && candidateAccount.tempPassword) {
    messageParts.push("New candidate account created.");
  } else if (candidateAccount.blockedByRole) {
    messageParts.push(
      "Candidate login was not enabled because this email is already assigned to another user role.",
    );
  }

  return NextResponse.json({ message: messageParts.join(" ") });
}
