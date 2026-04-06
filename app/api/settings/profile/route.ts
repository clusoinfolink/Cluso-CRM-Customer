import { NextRequest, NextResponse } from "next/server";
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

      if (!fileName || !fileType || fileSize <= 0 || fileSize > MAX_DOCUMENT_SIZE_BYTES) {
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
  const normalizedProfile = normalizePartnerProfile(body?.profile);

  await connectMongo();

  const companyUser = await User.findById(companyId);
  if (!companyUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyAddress = normalizedProfile.companyInformation.address;
  const invoiceAddress = normalizedProfile.invoicingInformation.billingSameAsCompany
    ? companyAddress
    : normalizedProfile.invoicingInformation.address;

  const nextProfile = {
    companyInformation: {
      companyName: normalizedProfile.companyInformation.companyName,
      gstin: normalizedProfile.companyInformation.gstin.toUpperCase(),
      cinRegistrationNumber: normalizedProfile.companyInformation.cinRegistrationNumber,
      address: companyAddress,
      documents: normalizedProfile.companyInformation.documents,
    },
    invoicingInformation: {
      billingSameAsCompany: normalizedProfile.invoicingInformation.billingSameAsCompany,
      invoiceEmail: normalizedProfile.invoicingInformation.invoiceEmail,
      address: invoiceAddress,
    },
    primaryContactInformation: normalizedProfile.primaryContactInformation,
    additionalQuestions: normalizedProfile.additionalQuestions,
    updatedAt: new Date(),
  };

  companyUser.set("partnerProfile", nextProfile);

  await companyUser.save();

  return NextResponse.json({
    message: "Profile updated successfully.",
    profile: normalizePartnerProfile(companyUser.get("partnerProfile")),
  });
}
