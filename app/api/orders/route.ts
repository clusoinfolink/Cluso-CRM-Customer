import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";
import VerificationRequest from "@/lib/models/VerificationRequest";

const schema = z.object({
  candidateName: z.string().min(2),
  candidateEmail: z.string().email(),
  candidatePhone: z.string().optional().default(""),
  selectedServiceIds: z.array(z.string().min(1)).optional().default([]),
});

const updateSchema = z.object({
  requestId: z.string().min(1),
  candidateName: z.string().min(2),
  candidateEmail: z.string().email(),
  candidatePhone: z.string().optional().default(""),
  selectedServiceIds: z.array(z.string().min(1)).optional().default([]),
});

function companyIdFromAuth(auth: { userId: string; role: "customer" | "delegate"; parentCustomerId: string | null }) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

async function getCompanyServices(companyId: string) {
  const company = await User.findById(companyId).lean();
  if (!company || company.role !== "customer") {
    return null;
  }

  return (company.selectedServices ?? []).map((item) => ({
    serviceId: String(item.serviceId),
    serviceName: item.serviceName,
    price: item.price,
    currency: item.currency,
  }));
}

export async function GET(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
  }

  await connectMongo();
  const items = await VerificationRequest.find({ customer: companyId })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const companyServices = await getCompanyServices(companyId);
  if (!companyServices) {
    return NextResponse.json({ error: "Company account not found." }, { status: 404 });
  }

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

  const selectedServices = companyServices.filter((item) =>
    parsed.data.selectedServiceIds.includes(item.serviceId),
  );

  await VerificationRequest.create({
    candidateName: parsed.data.candidateName,
    candidateEmail: parsed.data.candidateEmail,
    candidatePhone: parsed.data.candidatePhone || "",
    customer: companyId,
    createdBy: auth.userId,
    status: "pending",
    selectedServices,
  });

  return NextResponse.json(
    { message: "Request sent to admin for approval." },
    { status: 201 },
  );
}

export async function PATCH(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidate details." }, { status: 400 });
  }

  await connectMongo();

  const companyServices = await getCompanyServices(companyId);
  if (!companyServices) {
    return NextResponse.json({ error: "Company account not found." }, { status: 404 });
  }

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

  const selectedServices = companyServices.filter((item) =>
    parsed.data.selectedServiceIds.includes(item.serviceId),
  );

  const existing = await VerificationRequest.findOne({
    _id: parsed.data.requestId,
    customer: companyId,
  }).lean();

  if (!existing) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (existing.status !== "rejected") {
    return NextResponse.json(
      { error: "Only rejected requests can be edited and resubmitted." },
      { status: 400 },
    );
  }

  await VerificationRequest.findByIdAndUpdate(parsed.data.requestId, {
    candidateName: parsed.data.candidateName,
    candidateEmail: parsed.data.candidateEmail,
    candidatePhone: parsed.data.candidatePhone || "",
    selectedServices,
    status: "pending",
    rejectionNote: "",
  });

  return NextResponse.json({ message: "Request updated and resubmitted for approval." });
}
