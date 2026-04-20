import nodemailer from "nodemailer";
import type { InvoicePaymentMethod } from "@/lib/types";

const SMTP_CONNECTION_TIMEOUT_MS = 5000;
const SMTP_GREETING_TIMEOUT_MS = 5000;
const SMTP_SOCKET_TIMEOUT_MS = 7000;
const EMAIL_SEND_TIMEOUT_MS = 7000;

type PaymentReceiptAcknowledgementMailPayload = {
  recipientName: string;
  recipientEmail: string;
  invoiceNumber: string;
  billingMonth: string;
  paymentMethod: InvoicePaymentMethod;
};

export type PaymentReceiptAcknowledgementMailResult = {
  sent: boolean;
  reason?: string;
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveCustomerPortalUrl() {
  const configuredUrl = process.env.CUSTOMER_PORTAL_URL?.trim();
  if (configuredUrl) {
    if (/vercel\.(app|com)/i.test(configuredUrl)) {
      return "https://enterprise.secure.cluso.in/";
    }

    return configuredUrl;
  }

  return "https://enterprise.secure.cluso.in/";
}

function formatPaymentMethodLabel(method: InvoicePaymentMethod) {
  if (method === "wireTransfer") {
    return "Wire Transfer";
  }

  if (method === "adminUpload") {
    return "Admin Upload";
  }

  return "UPI";
}

export async function sendPaymentReceiptAcknowledgementEmail(
  payload: PaymentReceiptAcknowledgementMailPayload,
): Promise<PaymentReceiptAcknowledgementMailResult> {
  const recipientEmail = payload.recipientEmail.trim();
  if (!recipientEmail) {
    return {
      sent: false,
      reason: "Customer email is not configured for acknowledgement.",
    };
  }

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
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const portalUrl = resolveCustomerPortalUrl();
  const invoiceNumber = payload.invoiceNumber.trim() || "-";
  const billingMonth = payload.billingMonth.trim() || "-";
  const paymentMethod = formatPaymentMethodLabel(payload.paymentMethod);

  const safeRecipientName = escapeHtml(payload.recipientName || "Customer");
  const safeInvoiceNumber = escapeHtml(invoiceNumber);
  const safeBillingMonth = escapeHtml(billingMonth);
  const safePaymentMethod = escapeHtml(paymentMethod);
  const safePortalUrl = escapeHtml(portalUrl);

  const fromAddress =
    process.env.CUSTOMER_REPORT_MAIL_FROM?.trim() ||
    process.env.VERIFICATION_MAIL_FROM?.trim() ||
    `Cluso Infolink Team <${smtpUser}>`;

  const subject = `Payment received for invoice ${invoiceNumber}`;

  const text = [
    `Dear ${payload.recipientName || "Customer"},`,
    "",
    "Thank you for your payment receipt submission.",
    "",
    `Invoice Number: ${invoiceNumber}`,
    `Billing Month: ${billingMonth}`,
    `Payment Method: ${paymentMethod}`,
    "Payment Status: Under Process",
    "",
    "Our team has received your screenshot and will review your payment shortly.",
    "You can track invoice updates in your customer portal:",
    portalUrl,
    "",
    "Regards,",
    "Cluso Infolink Team",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5;">
      <p>Dear ${safeRecipientName},</p>
      <p>
        Thank you for your payment receipt submission. We have received your screenshot and your
        payment is now <strong>Under Process</strong>.
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 560px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 180px; color: #334155;">Invoice Number</td>
          <td style="padding: 12px 14px;">${safeInvoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 180px; color: #334155; border-top: 1px solid #e2e8f0;">Billing Month</td>
          <td style="padding: 12px 14px; border-top: 1px solid #e2e8f0;">${safeBillingMonth}</td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 180px; color: #334155; border-top: 1px solid #e2e8f0;">Payment Method</td>
          <td style="padding: 12px 14px; border-top: 1px solid #e2e8f0;">${safePaymentMethod}</td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 180px; color: #334155; border-top: 1px solid #e2e8f0;">Payment Status</td>
          <td style="padding: 12px 14px; border-top: 1px solid #e2e8f0;">Under Process</td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 180px; color: #334155; border-top: 1px solid #e2e8f0;">Customer Portal</td>
          <td style="padding: 12px 14px; border-top: 1px solid #e2e8f0;"><a href="${safePortalUrl}" style="color: #2563eb;">${safePortalUrl}</a></td>
        </tr>
      </table>
      <p style="margin-top: 14px;">
        Our team will review the payment and update the invoice status shortly.
      </p>
      <p>
        Regards,<br />
        Cluso Infolink Team
      </p>
    </div>
  `;

  try {
    await withTimeout(
      transporter.sendMail({
        from: fromAddress,
        to: recipientEmail,
        subject,
        text,
        html,
      }),
      EMAIL_SEND_TIMEOUT_MS,
      "Email delivery timed out.",
    );

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "Unknown email error",
    };
  }
}
