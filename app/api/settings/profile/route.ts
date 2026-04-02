import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCustomerAuthFromCookies, getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";
import type { PartnerProfile, PartnerProfileAddress, PartnerProfileDocument } from "@/lib/types";

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENTS = 5;

type CustomerAuth = {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
};

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Street Address 1 is required.").max(140),
  line2: z.string().trim().max(140).optional().default(""),
  city: z.string().trim().min(1, "City is required.").max(80),
  state: z.string().trim().min(1, "State / Province / Region is required.").max(80),
  postalCode: z.string().trim().min(1, "Postal / ZIP code is required.").max(30),
  country: z.string().trim().min(1, "Country is required.").max(80),
});

const optionalPhoneSchema = z.object({
  countryCode: z.string().trim().max(30).optional().default("India (+91)"),
  number: z.string().trim().max(30).optional().default(""),
});

const requiredPhoneSchema = z.object({
  countryCode: z.string().trim().max(30).optional().default("India (+91)"),
  number: z.string().trim().min(1, "Phone number is required.").max(30),
});

const documentSchema = z.object({
  fileName: z.string().trim().min(1, "Document name is required.").max(180),
  fileSize: z.coerce
    .number()
    .min(1, "Document size is invalid.")
    .max(MAX_DOCUMENT_SIZE_BYTES, "Each document must be 10 MB or less."),
  fileType: z.string().trim().min(1, "Document type is required.").max(120),
});

const profileSchema = z.object({
  companyInformation: z.object({
    companyName: z.string().trim().min(2, "Company name is required.").max(120),
    gstin: z.string().trim().max(20).optional().default(""),
    cinRegistrationNumber: z.string().trim().max(60).optional().default(""),
    address: addressSchema,
    documents: z
      .array(documentSchema)
      .min(1, "Upload at least one company document.")
      .max(MAX_DOCUMENTS, "You can upload up to 5 company documents."),
  }),
  invoicingInformation: z.object({
    billingSameAsCompany: z.boolean(),
    invoiceEmail: z.string().trim().email("Invoice email address is required."),
    address: addressSchema,
  }),
  primaryContactInformation: z.object({
    firstName: z.string().trim().min(1, "First name is required.").max(80),
    lastName: z.string().trim().min(1, "Last name is required.").max(80),
    designation: z.string().trim().min(1, "Designation / Title is required.").max(120),
    email: z.string().trim().email("Primary contact email is required."),
    officePhone: optionalPhoneSchema,
    mobilePhone: requiredPhoneSchema,
    whatsappPhone: optionalPhoneSchema,
  }),
  additionalQuestions: z.object({
    heardAboutUs: z.string().trim().min(1, "Please choose how you heard about us.").max(120),
    referredBy: z.string().trim().max(160).optional().default(""),
    yearlyBackgroundsExpected: z
      .string()
      .trim()
      .min(1, "Please choose approximate backgrounds expected per year.")
      .max(120),
    promoCode: z.string().trim().max(60).optional().default(""),
    primaryIndustry: z.string().trim().min(1, "Primary industry is required.").max(140),
  }),
});

function companyIdFromAuth(auth: CustomerAuth) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

function asString(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value;
}

function normalizeAddress(value: unknown): PartnerProfileAddress {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    line1: asString(raw.line1),
    line2: asString(raw.line2),
    city: asString(raw.city),
    state: asString(raw.state),
    postalCode: asString(raw.postalCode),
    country: asString(raw.country),
  };
}

function normalizeDocuments(value: unknown): PartnerProfileDocument[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      if (!raw) {
        return null;
      }

      const fileName = asString(raw.fileName).trim();
      const fileType = asString(raw.fileType).trim();
      const fileSize =
        typeof raw.fileSize === "number" && Number.isFinite(raw.fileSize)
          ? Math.max(0, Math.trunc(raw.fileSize))
          : 0;

      if (!fileName || !fileType || fileSize <= 0) {
        return null;
      }

      return { fileName, fileType, fileSize };
    })
    .filter((entry): entry is PartnerProfileDocument => Boolean(entry))
    .slice(0, MAX_DOCUMENTS);
}

function normalizePartnerProfile(value: unknown): PartnerProfile {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const companyInformation =
    raw.companyInformation && typeof raw.companyInformation === "object"
      ? (raw.companyInformation as Record<string, unknown>)
      : {};
  const invoicingInformation =
    raw.invoicingInformation && typeof raw.invoicingInformation === "object"
      ? (raw.invoicingInformation as Record<string, unknown>)
      : {};
  const primaryContactInformation =
    raw.primaryContactInformation && typeof raw.primaryContactInformation === "object"
      ? (raw.primaryContactInformation as Record<string, unknown>)
      : {};
  const additionalQuestions =
    raw.additionalQuestions && typeof raw.additionalQuestions === "object"
      ? (raw.additionalQuestions as Record<string, unknown>)
      : {};

  const updatedAtRaw = raw.updatedAt;
  const updatedAt =
    updatedAtRaw instanceof Date
      ? updatedAtRaw.toISOString()
      : typeof updatedAtRaw === "string" && updatedAtRaw
        ? updatedAtRaw
        : null;

  return {
    companyInformation: {
      companyName: asString(companyInformation.companyName),
      gstin: asString(companyInformation.gstin),
      cinRegistrationNumber: asString(companyInformation.cinRegistrationNumber),
      address: normalizeAddress(companyInformation.address),
      documents: normalizeDocuments(companyInformation.documents),
    },
    invoicingInformation: {
      billingSameAsCompany: Boolean(invoicingInformation.billingSameAsCompany),
      invoiceEmail: asString(invoicingInformation.invoiceEmail),
      address: normalizeAddress(invoicingInformation.address),
    },
    primaryContactInformation: {
      firstName: asString(primaryContactInformation.firstName),
      lastName: asString(primaryContactInformation.lastName),
      designation: asString(primaryContactInformation.designation),
      email: asString(primaryContactInformation.email),
      officePhone: normalizePhone(primaryContactInformation.officePhone),
      mobilePhone: normalizePhone(primaryContactInformation.mobilePhone),
      whatsappPhone: normalizePhone(primaryContactInformation.whatsappPhone),
    },
    additionalQuestions: {
      heardAboutUs: asString(additionalQuestions.heardAboutUs),
      referredBy: asString(additionalQuestions.referredBy),
      yearlyBackgroundsExpected: asString(additionalQuestions.yearlyBackgroundsExpected),
      promoCode: asString(additionalQuestions.promoCode),
      primaryIndustry: asString(additionalQuestions.primaryIndustry),
    },
    updatedAt,
  };
}

function normalizePhone(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    countryCode: asString(raw.countryCode, "India (+91)"),
    number: asString(raw.number),
  };
}

export async function GET() {
  const auth = await getCustomerAuthFromCookies();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectMongo();

  const companyUser = await User.findById(companyId).select("partnerProfile").lean();
  if (!companyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ profile: normalizePartnerProfile(companyUser.partnerProfile) });
}

export async function PATCH(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = profileSchema.safeParse(body?.profile);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? "Invalid profile data." }, { status: 400 });
  }

  await connectMongo();

  const companyUser = await User.findById(companyId);
  if (!companyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyAddress = parsed.data.companyInformation.address;
  const invoiceAddress = parsed.data.invoicingInformation.billingSameAsCompany
    ? companyAddress
    : parsed.data.invoicingInformation.address;

  const nextProfile = {
    companyInformation: {
      companyName: parsed.data.companyInformation.companyName,
      gstin: parsed.data.companyInformation.gstin.toUpperCase(),
      cinRegistrationNumber: parsed.data.companyInformation.cinRegistrationNumber,
      address: companyAddress,
      documents: parsed.data.companyInformation.documents,
    },
    invoicingInformation: {
      billingSameAsCompany: parsed.data.invoicingInformation.billingSameAsCompany,
      invoiceEmail: parsed.data.invoicingInformation.invoiceEmail,
      address: invoiceAddress,
    },
    primaryContactInformation: parsed.data.primaryContactInformation,
    additionalQuestions: parsed.data.additionalQuestions,
    updatedAt: new Date(),
  };

  companyUser.set("partnerProfile", nextProfile);

  await companyUser.save();

  return NextResponse.json({
    message: "Profile updated successfully.",
    profile: normalizePartnerProfile(companyUser.get("partnerProfile")),
  });
}
