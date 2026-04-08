import nodemailer from "nodemailer";

type TeamCredentialMailPayload = {
  recipientName: string;
  recipientEmail: string;
  temporaryPassword: string;
  roleLabel: "Delegate" | "User";
  companyName: string;
};

export type TeamCredentialMailResult = {
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

function resolveCustomerPortalUrl() {
  const configuredUrl = process.env.CUSTOMER_PORTAL_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  return process.env.NODE_ENV === "production"
    ? "https://cluso-customer.vercel.app"
    : "http://localhost:3011";
}

export async function sendTeamCredentialEmail(
  payload: TeamCredentialMailPayload,
): Promise<TeamCredentialMailResult> {
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

  const portalUrl = resolveCustomerPortalUrl();
  const safeName = escapeHtml(payload.recipientName);
  const safeCompany = escapeHtml(payload.companyName);
  const safeRoleLabel = escapeHtml(payload.roleLabel);
  const safePortalUrl = escapeHtml(portalUrl);
  const safeRecipientEmail = escapeHtml(payload.recipientEmail);
  const safePassword = escapeHtml(payload.temporaryPassword);

  const fromAddress =
    process.env.TEAM_LOGIN_MAIL_FROM?.trim() ||
    process.env.VERIFICATION_MAIL_FROM?.trim() ||
    `Cluso Infolink Team <${smtpUser}>`;

  const subject = `Your Cluso ${payload.roleLabel} Account Credentials`;

  const text = [
    `Dear ${payload.recipientName},`,
    "",
    `Your ${payload.roleLabel.toLowerCase()} account has been created for ${payload.companyName}.`,
    "",
    "You can access your account using the credentials below:",
    `Portal URL: ${portalUrl}`,
    `Login Email: ${payload.recipientEmail}`,
    `Temporary Password: ${payload.temporaryPassword}`,
    "",
    "For security reasons, please sign in and change your password immediately.",
    "",
    "If you did not expect this account, please contact your administrator.",
    "",
    "Best regards,",
    "Cluso Infolink Team",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5;">
      <p>Dear ${safeName},</p>
      <p>
        Your <strong>${safeRoleLabel}</strong> account has been created for
        <strong>${safeCompany}</strong>.
      </p>
      <p>You can access your account using the credentials below:</p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 560px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 160px; color: #334155;">Portal URL</td>
          <td style="padding: 12px 14px;"><a href="${safePortalUrl}" style="color: #2563eb;">${safePortalUrl}</a></td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 160px; color: #334155; border-top: 1px solid #e2e8f0;">Login Email</td>
          <td style="padding: 12px 14px; border-top: 1px solid #e2e8f0;">${safeRecipientEmail}</td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; font-weight: 700; width: 160px; color: #334155; border-top: 1px solid #e2e8f0;">Temporary Password</td>
          <td style="padding: 12px 14px; border-top: 1px solid #e2e8f0;"><code style="font-family: Consolas, Menlo, monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${safePassword}</code></td>
        </tr>
      </table>
      <p style="margin-top: 14px;">
        For security reasons, please sign in and change your password immediately.
      </p>
      <p>
        If you did not expect this account, please contact your administrator.
      </p>
      <p>
        Best regards,<br />
        Cluso Infolink Team
      </p>
    </div>
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
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "Unknown email error",
    };
  }
}
