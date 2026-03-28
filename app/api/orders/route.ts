import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
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

function companyIdFromAuth(auth: {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
}) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

async function getCompanyProfile(companyId: string) {
  const company = await User.findById(companyId).lean();
  if (!company || company.role !== "customer") {
    return null;
  }

  return {
    companyName: company.name || "Company",
    services: (company.selectedServices ?? []).map((item) => ({
      serviceId: String(item.serviceId),
      serviceName: item.serviceName,
      price: item.price,
      currency: item.currency,
    })),
  };
}

type VerificationEmailPayload = {
  recipientName: string;
  recipientEmail: string;
  companyName: string;
  portalUrl: string;
  tempPassword?: string | null;
};

type EmailResult = {
  sent: boolean;
  reason?: string;
};

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

  const subject = "Background Verification Request";
  const fromAddress =
    process.env.VERIFICATION_MAIL_FROM?.trim() || `Cluso Infolink Team <${smtpUser}>`;

  const loginHint = payload.tempPassword
    ? `\nYour candidate account was created for this request.\nLogin Email: ${payload.recipientEmail}\nTemporary Password: ${payload.tempPassword}\n`
    : "";

  const text = [
    `Dear ${payload.recipientName},`,
    "",
    "We hope you are doing well.",
    "",
    "We, Cluso Infolink, a background verification firm, have been requested to collect and verify your information to assess the genuineness of your application.",
    "",
    `This verification process has been initiated by "${payload.companyName}" as part of their standard screening procedure.`,
    "",
    "To proceed, we have provided a secure link to our portal where you can submit your information and upload the required documents:",
    "",
    payload.portalUrl,
    loginHint,
    "We kindly request your cooperation in completing this process at the earliest. All information shared will be handled with strict confidentiality and used solely for verification purposes.",
    "",
    "If you have any questions or require clarification, please feel free to reach out to us.",
    "",
    "Thank you for your cooperation.",
    "",
    "Best regards,",
    "Cluso Infolink Team",
    "Clusosupport@gmail.com",
  ]
    .filter(Boolean)
    .join("\n");

  const safeRecipient = payload.recipientName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const safeCompany = payload.companyName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const safePortalUrl = payload.portalUrl
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const credentialsHtml = payload.tempPassword
    ? `<p>Your candidate account was created for this request.<br />Login Email: ${payload.recipientEmail}<br />Temporary Password: ${payload.tempPassword}</p>`
    : "";

  const html = `
    <p>Dear ${safeRecipient},</p>
    <p>We hope you are doing well.</p>
    <p>
      We, Cluso Infolink, a background verification firm, have been requested to collect and verify your
      information to assess the genuineness of your application.
    </p>
    <p>
      This verification process has been initiated by "${safeCompany}" as part of their standard screening
      procedure.
    </p>
    <p>
      To proceed, we have provided a secure link to our portal where you can submit your information and upload
      the required documents:
    </p>
    <p><a href="${safePortalUrl}">${safePortalUrl}</a></p>
    ${credentialsHtml}
    <p>
      We kindly request your cooperation in completing this process at the earliest. All information shared will
      be handled with strict confidentiality and used solely for verification purposes.
    </p>
    <p>
      If you have any questions or require clarification, please feel free to reach out to us.
    </p>
    <p>
      Thank you for your cooperation.
    </p>
    <p>
      Best regards,<br />
      Cluso Infolink Team<br />
      Clusosupport@gmail.com
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
  const requestFilter: { customer: string; createdBy?: string } = { customer: companyId };
  if (auth.role === "delegate_user") {
    requestFilter.createdBy = auth.userId;
  }

  const items = await VerificationRequest.find(requestFilter)
    .sort({ createdAt: -1 })
    .lean();

  const creatorIds = [...new Set(items.map((item) => String(item.createdBy)))];
  const creators =
    creatorIds.length > 0
      ? await User.find({ _id: { $in: creatorIds } })
          .select("name role createdByDelegate")
          .lean()
      : [];
  const creatorMap = new Map(
    creators.map((item) => [String(item._id), { name: item.name, role: item.role }]),
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

  const companyDelegates =
    auth.role === "delegate_user"
      ? await User.find({ parentCustomer: companyId, role: "delegate" }).select("name").lean()
      : [];
  const singleCompanyDelegateName =
    companyDelegates.length === 1 ? companyDelegates[0].name : null;

  function resolveDelegateName(createdById: string) {
    const creator = creators.find((item) => String(item._id) === createdById);
    if (!creator) {
      return "-";
    }

    if (creator.role === "delegate") {
      return creator.name;
    }

    if (creator.role === "delegate_user") {
      if (creator.createdByDelegate) {
        const parentDelegateName = delegateMap.get(String(creator.createdByDelegate));
        if (parentDelegateName) {
          return parentDelegateName;
        }
      }

      return singleCompanyDelegateName ?? "-";
    }

    return "-";
  }

  const enriched = items.map((item) => ({
    ...item,
    createdByName: creatorMap.get(String(item.createdBy))?.name ?? "Unknown",
    createdByRole: creatorMap.get(String(item.createdBy))?.role ?? "unknown",
    delegateName: resolveDelegateName(String(item.createdBy)),
  }));

  return NextResponse.json({ items: enriched });
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

  const selectedServices = companyServices.filter((item) =>
    parsed.data.selectedServiceIds.includes(item.serviceId),
  );

  const candidateAccount = await ensureCandidateUser(
    parsed.data.candidateEmail,
    parsed.data.candidateName,
  );

  await VerificationRequest.create({
    candidateName: parsed.data.candidateName,
    candidateEmail: parsed.data.candidateEmail.toLowerCase(),
    candidatePhone: parsed.data.candidatePhone || "",
    customer: companyId,
    createdBy: auth.userId,
    candidateUser: candidateAccount.candidateUserId,
    status: "pending",
    candidateFormStatus: "pending",
    candidateSubmittedAt: null,
    candidateFormResponses: [],
    selectedServices,
  });

  const portalUrl = process.env.CANDIDATE_PORTAL_URL?.trim() || "http://localhost:3012";
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
    messageParts.push(
      `New candidate account created. Temporary password: ${candidateAccount.tempPassword}`,
    );
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

  const selectedServices = companyServices.filter((item) =>
    parsed.data.selectedServiceIds.includes(item.serviceId),
  );

  const candidateAccount = await ensureCandidateUser(
    parsed.data.candidateEmail,
    parsed.data.candidateName,
  );

  const existingFilter: { _id: string; customer: string; createdBy?: string } = {
    _id: parsed.data.requestId,
    customer: companyId,
  };
  if (auth.role === "delegate_user") {
    existingFilter.createdBy = auth.userId;
  }

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

  await VerificationRequest.findByIdAndUpdate(parsed.data.requestId, {
    candidateName: parsed.data.candidateName,
    candidateEmail: parsed.data.candidateEmail.toLowerCase(),
    candidatePhone: parsed.data.candidatePhone || "",
    candidateUser: candidateAccount.candidateUserId,
    selectedServices,
    status: "pending",
    candidateFormStatus: "pending",
    candidateSubmittedAt: null,
    candidateFormResponses: [],
    rejectionNote: "",
  });

  const portalUrl = process.env.CANDIDATE_PORTAL_URL?.trim() || "http://localhost:3012";
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
    messageParts.push(
      `New candidate account created. Temporary password: ${candidateAccount.tempPassword}`,
    );
  } else if (candidateAccount.blockedByRole) {
    messageParts.push(
      "Candidate login was not enabled because this email is already assigned to another user role.",
    );
  }

  return NextResponse.json({ message: messageParts.join(" ") });
}
