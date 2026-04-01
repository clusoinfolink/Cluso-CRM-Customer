import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { type SupportedCurrency } from "@/lib/currencies";
import { connectMongo } from "@/lib/mongodb";
import Service from "@/lib/models/Service";
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

const rejectCandidateDataSchema = z.object({
  action: z.literal("reject-candidate-data"),
  requestId: z.string().min(1),
  rejectedFields: z.array(
    z.object({
      serviceId: z.string().min(1),
      question: z.string().trim().min(1),
    }),
  ).min(1),
  rejectionComment: z.string().trim().max(500).optional().default(""),
});

function companyIdFromAuth(auth: {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
}) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

type CompanyServiceSelection = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: SupportedCurrency;
  isPackage: boolean;
  includedServiceIds: string[];
};

type ExpandedSelectedService = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: SupportedCurrency;
};

async function getCompanyProfile(companyId: string) {
  const company = await User.findById(companyId).lean();
  if (!company || company.role !== "customer") {
    return null;
  }

  const selectedServices = (company.selectedServices ?? []).map((item) => ({
    serviceId: String(item.serviceId),
    serviceName: item.serviceName,
    price: typeof item.price === "number" ? item.price : 0,
    currency: item.currency as SupportedCurrency,
  }));

  const selectedServiceIds = [...new Set(selectedServices.map((item) => item.serviceId))];
  const serviceDocs =
    selectedServiceIds.length > 0
      ? await Service.find({ _id: { $in: selectedServiceIds } })
          .select("name defaultPrice defaultCurrency isPackage includedServiceIds")
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
      },
    ]),
  );

  return {
    companyName: company.name || "Company",
    services: selectedServices.map((item) => {
      const serviceMeta = serviceMap.get(item.serviceId);

      return {
        serviceId: item.serviceId,
        serviceName: item.serviceName || serviceMeta?.name || "Service",
        price: item.price,
        currency: item.currency,
        isPackage: Boolean(serviceMeta?.isPackage),
        includedServiceIds: serviceMeta?.includedServiceIds ?? [],
      } satisfies CompanyServiceSelection;
    }),
  };
}

async function expandSelectedServices(
  selectedServiceIds: string[],
  companyServices: CompanyServiceSelection[],
) {
  const assignmentMap = new Map(companyServices.map((service) => [service.serviceId, service]));
  const selectedAssignments = selectedServiceIds
    .map((serviceId) => assignmentMap.get(serviceId))
    .filter((service): service is CompanyServiceSelection => Boolean(service));

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
          .select("name defaultPrice defaultCurrency isPackage")
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
      pushService({
        serviceId: selectedService.serviceId,
        serviceName: selectedService.serviceName,
        price: selectedService.price,
        currency: selectedService.currency,
      });
      continue;
    }

    for (const includedServiceId of selectedService.includedServiceIds) {
      const assignedService = assignmentMap.get(includedServiceId);
      if (assignedService && !assignedService.isPackage) {
        pushService({
          serviceId: assignedService.serviceId,
          serviceName: assignedService.serviceName,
          price: assignedService.price,
          currency: assignedService.currency,
        });
        continue;
      }

      const includedService = includedServiceMap.get(includedServiceId);
      if (!includedService || includedService.isPackage) {
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

type VerificationEmailPayload = {
  recipientName: string;
  recipientEmail: string;
  companyName: string;
  portalUrl: string;
  tempPassword?: string | null;
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
    return configuredUrl;
  }

  return process.env.NODE_ENV === "production"
    ? "https://cluso-candidates.vercel.app"
    : "http://localhost:3012";
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

  const safeRecipient = escapeHtml(payload.recipientName);
  const safeCompany = escapeHtml(payload.companyName);
  const safePortalUrl = escapeHtml(payload.portalUrl);

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
    `Some submitted details for your verification request from \"${payload.companyName}\" need correction.`,
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

  const selectedServices = await expandSelectedServices(
    parsed.data.selectedServiceIds,
    companyServices,
  );

  if (parsed.data.selectedServiceIds.length > 0 && selectedServices.length === 0) {
    return NextResponse.json(
      { error: "Selected package deal is misconfigured. Please contact admin." },
      { status: 400 },
    );
  }

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

  const rejectParsed = rejectCandidateDataSchema.safeParse(body);
  if (rejectParsed.success) {
    await connectMongo();

    const requestFilter: { _id: string; customer: string; createdBy?: string } = {
      _id: rejectParsed.data.requestId,
      customer: companyId,
    };

    if (auth.role === "delegate_user") {
      requestFilter.createdBy = auth.userId;
    }

    const requestDoc = await VerificationRequest.findOne(requestFilter).lean();

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

    if (requestDoc.status === "approved") {
      return NextResponse.json(
        { error: "Approved requests cannot be rejected from customer portal." },
        { status: 400 },
      );
    }

    const availableFieldMap = new Map<
      string,
      {
        serviceId: string;
        serviceName: string;
        question: string;
        fieldType: "text" | "long_text" | "number" | "file";
      }
    >();

    for (const serviceResponse of requestDoc.candidateFormResponses ?? []) {
      const serviceId = String(serviceResponse.serviceId);
      const serviceName = serviceResponse.serviceName;
      for (const answer of serviceResponse.answers ?? []) {
        const question = answer.question.trim();
        const fieldKey = `${serviceId}::${question}`;
        availableFieldMap.set(fieldKey, {
          serviceId,
          serviceName,
          question,
          fieldType: answer.fieldType,
        });
      }
    }

    const rejectedFieldMap = new Map<
      string,
      {
        serviceId: string;
        serviceName: string;
        question: string;
        fieldType: "text" | "long_text" | "number" | "file";
      }
    >();

    for (const selectedField of rejectParsed.data.rejectedFields) {
      const normalizedQuestion = selectedField.question.trim();
      const selectedKey = `${selectedField.serviceId}::${normalizedQuestion}`;
      const matchedField = availableFieldMap.get(selectedKey);
      if (!matchedField) {
        return NextResponse.json(
          { error: "One or more selected fields are invalid for this request." },
          { status: 400 },
        );
      }

      rejectedFieldMap.set(selectedKey, matchedField);
    }

    const rejectedFields = [...rejectedFieldMap.values()];
    if (rejectedFields.length === 0) {
      return NextResponse.json(
        { error: "Please select at least one field to reject." },
        { status: 400 },
      );
    }

    const rejectedQuestions = rejectedFields.map((field) => field.question);
    const baseRejectionNote = `Customer requested correction for: ${rejectedQuestions.join(", ")}.`;
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

  const selectedServices = await expandSelectedServices(
    parsed.data.selectedServiceIds,
    companyServices,
  );

  if (parsed.data.selectedServiceIds.length > 0 && selectedServices.length === 0) {
    return NextResponse.json(
      { error: "Selected package deal is misconfigured. Please contact admin." },
      { status: 400 },
    );
  }

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
    customerRejectedFields: [],
    rejectionNote: "",
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
