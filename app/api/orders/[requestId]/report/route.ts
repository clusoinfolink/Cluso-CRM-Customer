import { NextRequest, NextResponse } from "next/server";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import VerificationRequest from "@/lib/models/VerificationRequest";
import User from "@/lib/models/User";

type CustomerAuth = {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
};

type ReportPayload = {
  reportNumber: string;
  generatedAt: string;
  generatedByName: string;
  candidate: {
    name: string;
    email: string;
    phone: string;
  };
  company: {
    name: string;
    email: string;
  };
  status: string;
  createdAt: string;
  services: Array<{
    serviceId: string;
    serviceEntryIndex: number;
    serviceEntryCount: number;
    serviceInstanceKey: string;
    serviceName: string;
    status: string;
    verificationMode: string;
    comment: string;
    candidateAnswers: Array<{
      question: string;
      value: string;
      fieldType: string;
      fileName: string;
      fileData: string;
    }>;
    attempts: Array<{
      attemptedAt: string;
      status: string;
      verificationMode: string;
      comment: string;
      verifierName: string;
      managerName: string;
    }>;
  }>;
};

const COMPANY_ACCESS_INACTIVE_ERROR =
  "Your company access is deactivated. Only Settings and Invoices are available.";

function asDate(value: unknown) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value: string | Date) {
  const parsed = asDate(value);
  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleString("en-IN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatDateOnly(value: string | Date) {
  const parsed = asDate(value);
  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function toDisplayStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "-";
  }

  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function toDisplayAttemptStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "verified") {
    return "Verified";
  }

  return "In Progress";
}

function toDisplayMode(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "Manual";
  }

  if (normalized === normalized.toLowerCase()) {
    return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
  }

  return normalized;
}

function sanitizePdfText(value: string) {
  return value
    .replace(/₹/g, "INR ")
    .replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, "");
}

function companyIdFromAuth(auth: CustomerAuth) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

async function buildScopedRequestFilter(auth: CustomerAuth, companyId: string) {
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

async function getScopedRequest(auth: CustomerAuth, requestId: string) {
  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return {
      error: "Invalid account mapping.",
      status: 400,
      item: null,
    };
  }

  const scopedFilter = await buildScopedRequestFilter(auth, companyId);
  if (!scopedFilter.ok) {
    return {
      error: scopedFilter.error,
      status: 403,
      item: null,
    };
  }

  const item = await VerificationRequest.findOne({
    _id: requestId,
    ...scopedFilter.filter,
  }).lean();

  return {
    error: "",
    status: 200,
    item,
  };
}

async function buildPdfBuffer(report: ReportPayload) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const { readFile } = await import("fs/promises");
  const path = await import("path");

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const contentLeft = 70;
  const contentRight = pageWidth - 70;
  const contentWidth = contentRight - contentLeft;
  const topStartY = pageHeight - 58;
  const bottomLimitY = 118;

  const palette = {
    titleBlue: rgb(0.14, 0.28, 0.6),
    headingBlue: rgb(0.12, 0.26, 0.55),
    success: rgb(0.08, 0.52, 0.18),
    danger: rgb(0.78, 0.13, 0.1),
    ink: rgb(0.08, 0.08, 0.08),
    muted: rgb(0.42, 0.42, 0.42),
    borderStrong: rgb(0.56, 0.08, 0.15),
    borderSoft: rgb(0.76, 0.72, 0.44),
    lineStrong: rgb(0.1, 0.1, 0.1),
    lineSoft: rgb(0.46, 0.46, 0.46),
  };

  let logoImage: import("pdf-lib").PDFImage | null = null;
  try {
    const logoPath = path.join(process.cwd(), "public", "images", "cluso-infolink-logo.png");
    const logoBytes = await readFile(logoPath);
    logoImage = await pdfDoc.embedPng(logoBytes);
  } catch {
    logoImage = null;
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = topStartY;

  function drawPageFrame(targetPage: typeof page) {
    targetPage.drawRectangle({
      x: 14,
      y: 14,
      width: pageWidth - 28,
      height: pageHeight - 28,
      borderColor: palette.borderStrong,
      borderWidth: 2,
    });

    targetPage.drawRectangle({
      x: 18,
      y: 18,
      width: pageWidth - 36,
      height: pageHeight - 36,
      borderColor: palette.borderSoft,
      borderWidth: 1,
    });

    const footerText = "Generated Report By ClusoInfolink";
    const footerSize = 11;
    const footerWidth = regularFont.widthOfTextAtSize(footerText, footerSize);

    targetPage.drawText(footerText, {
      x: (pageWidth - footerWidth) / 2,
      y: 38,
      size: footerSize,
      font: regularFont,
      color: palette.muted,
    });
  }

  function addPage() {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    drawPageFrame(page);
    y = topStartY;
  }

  drawPageFrame(page);

  function ensureSpace(requiredHeight: number) {
    if (y - requiredHeight >= bottomLimitY) {
      return false;
    }

    addPage();
    return true;
  }

  function wrapText(
    text: string,
    size: number,
    maxWidth: number,
    isBold = false,
    fallback = "",
  ) {
    const font = isBold ? boldFont : regularFont;
    const normalizedText = sanitizePdfText(text).replace(/\s+/g, " ").trim();

    if (!normalizedText) {
      return fallback ? [fallback] : [];
    }

    const words = normalizedText.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        currentLine = word;
        continue;
      }

      let segment = "";
      for (const char of word) {
        const nextSegment = `${segment}${char}`;
        if (font.widthOfTextAtSize(nextSegment, size) <= maxWidth) {
          segment = nextSegment;
          continue;
        }

        if (segment) {
          lines.push(segment);
        }
        segment = char;
      }
      currentLine = segment;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : fallback ? [fallback] : [];
  }

  function drawHorizontalLine(
    lineY: number,
    x = contentLeft,
    width = contentWidth,
    color = palette.lineSoft,
    thickness = 0.8,
  ) {
    page.drawLine({
      start: { x, y: lineY },
      end: { x: x + width, y: lineY },
      thickness,
      color,
    });
  }

  function drawCenteredText(
    text: string,
    lineY: number,
    size: number,
    isBold = false,
    color = palette.ink,
  ) {
    const safeText = sanitizePdfText(text);
    const font = isBold ? boldFont : regularFont;
    const textWidth = font.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, {
      x: (pageWidth - textWidth) / 2,
      y: lineY,
      size,
      font,
      color,
    });
  }

  function drawWrappedLines(
    lines: string[],
    x: number,
    startY: number,
    size: number,
    color = palette.ink,
    isBold = false,
    lineHeight = size + 2,
  ) {
    const font = isBold ? boldFont : regularFont;
    for (let index = 0; index < lines.length; index += 1) {
      const safeLine = sanitizePdfText(lines[index]);
      page.drawText(safeLine, {
        x,
        y: startY - index * lineHeight,
        size,
        font,
        color,
      });
    }
  }

  function drawLabelValue(
    x: number,
    lineY: number,
    label: string,
    value: string,
    valueColor = palette.ink,
    size = 11,
  ) {
    const safeLabel = sanitizePdfText(label);
    const safeValue = sanitizePdfText(value || "-");

    page.drawText(safeLabel, {
      x,
      y: lineY,
      size,
      font: boldFont,
      color: palette.ink,
    });

    const labelWidth = boldFont.widthOfTextAtSize(safeLabel, size);
    page.drawText(safeValue, {
      x: x + labelWidth + 4,
      y: lineY,
      size,
      font: regularFont,
      color: valueColor,
    });
  }

  function colorForStatus(status: string) {
    const normalized = status.trim().toLowerCase();
    if (normalized === "verified") {
      return palette.success;
    }

    if (normalized === "unverified" || normalized === "rejected") {
      return palette.danger;
    }

    return palette.ink;
  }

  function colorForAttemptStatus(status: string) {
    const normalized = status.trim().toLowerCase();
    if (normalized === "verified") {
      return palette.success;
    }

    return rgb(0.63, 0.38, 0.03);
  }

  const logoBoxX = contentLeft;
  const logoBoxWidth = 200;
  const logoBoxHeight = 170;
  const logoBoxY = pageHeight - 245;

  page.drawRectangle({
    x: logoBoxX,
    y: logoBoxY,
    width: logoBoxWidth,
    height: logoBoxHeight,
    borderColor: palette.lineSoft,
    borderWidth: 0.8,
  });

  if (logoImage) {
    const logoFit = logoImage.scaleToFit(logoBoxWidth - 20, logoBoxHeight - 20);
    page.drawImage(logoImage, {
      x: logoBoxX + (logoBoxWidth - logoFit.width) / 2,
      y: logoBoxY + (logoBoxHeight - logoFit.height) / 2,
      width: logoFit.width,
      height: logoFit.height,
    });
  } else {
    const fallbackText = "Cluso-Infolink";
    const fallbackSize = 12;
    const fallbackWidth = regularFont.widthOfTextAtSize(fallbackText, fallbackSize);
    page.drawText(fallbackText, {
      x: logoBoxX + (logoBoxWidth - fallbackWidth) / 2,
      y: logoBoxY + logoBoxHeight / 2 - 6,
      size: fallbackSize,
      font: regularFont,
      color: palette.muted,
    });
  }

  const reportMetaX = contentRight - 170;
  const reportMetaY = pageHeight - 120;
  drawLabelValue(reportMetaX, reportMetaY, "Report #: ", report.reportNumber, palette.muted, 12);
  drawLabelValue(reportMetaX + 47, reportMetaY - 20, "Date: ", formatDateOnly(report.generatedAt), palette.muted, 12);

  drawCenteredText("Verification Report", logoBoxY - 60, 48, true, palette.titleBlue);

  const summaryTopY = logoBoxY - 78;
  const summaryHeight = 74;
  const summaryY = summaryTopY - summaryHeight;

  page.drawRectangle({
    x: contentLeft,
    y: summaryY,
    width: contentWidth,
    height: summaryHeight,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 0.8,
    color: rgb(0.98, 0.98, 0.98),
    opacity: 1,
  });

  const summaryLeftX = contentLeft + 10;
  const summaryRightX = contentLeft + contentWidth / 2 + 8;
  let summaryTextY = summaryTopY - 20;

  drawLabelValue(summaryLeftX, summaryTextY, "Report Number:", report.reportNumber, palette.ink, 10.8);
  drawLabelValue(summaryRightX, summaryTextY, "Generated At:", formatDateTime(report.generatedAt), palette.ink, 10.8);

  summaryTextY -= 17;
  drawLabelValue(summaryLeftX, summaryTextY, "Request Created:", formatDateTime(report.createdAt), palette.ink, 10.8);
  drawLabelValue(summaryRightX, summaryTextY, "Generated By:", report.generatedByName || "-", palette.ink, 10.8);

  summaryTextY -= 17;
  drawLabelValue(
    summaryLeftX,
    summaryTextY,
    "Overall Status:",
    toDisplayStatus(report.status),
    colorForStatus(report.status),
    10.8,
  );

  y = summaryY - 28;

  const columnGap = 20;
  const detailsColumnWidth = (contentWidth - columnGap) / 2;
  const leftColumnX = contentLeft;
  const rightColumnX = contentLeft + detailsColumnWidth + columnGap;
  const detailsHeadingY = y;

  page.drawText("Candidate Details", {
    x: leftColumnX,
    y: detailsHeadingY,
    size: 12,
    font: boldFont,
    color: palette.headingBlue,
  });
  page.drawText("Company Details", {
    x: rightColumnX,
    y: detailsHeadingY,
    size: 12,
    font: boldFont,
    color: palette.headingBlue,
  });

  const detailsLineHeight = 16;
  const leftDetails = [
    { label: "Name:", value: report.candidate.name || "-" },
    { label: "Email:", value: report.candidate.email || "-" },
    { label: "Phone:", value: report.candidate.phone || "-" },
  ];
  const rightDetails = [
    { label: "Company:", value: report.company.name || "-" },
    { label: "Email:", value: report.company.email || "-" },
  ];

  let leftDetailY = detailsHeadingY - 22;
  for (const entry of leftDetails) {
    drawLabelValue(leftColumnX, leftDetailY, entry.label, entry.value, palette.ink, 11);
    leftDetailY -= detailsLineHeight;
  }

  let rightDetailY = detailsHeadingY - 22;
  for (const entry of rightDetails) {
    drawLabelValue(rightColumnX, rightDetailY, entry.label, entry.value, palette.ink, 11);
    rightDetailY -= detailsLineHeight;
  }

  const detailsBottomY = Math.min(leftDetailY, rightDetailY) - 10;
  drawHorizontalLine(detailsBottomY, contentLeft + 16, contentWidth - 16, palette.lineSoft, 0.9);
  y = detailsBottomY - 22;

  page.drawText("Service Verification Summary", {
    x: contentLeft,
    y,
    size: 15,
    font: boldFont,
    color: palette.headingBlue,
  });
  y -= 28;

  const tableColumns = {
    dateTime: { x: contentLeft, width: 130 },
    status: { x: contentLeft + 140, width: 66 },
    mode: { x: contentLeft + 214, width: 62 },
    details: { x: contentLeft + 286, width: contentRight - (contentLeft + 286) },
  };

  type AttemptRowLayout = {
    attempt: ReportPayload["services"][number]["attempts"][number];
    dateLines: string[];
    statusLines: string[];
    modeLines: string[];
    detailsLines: string[];
    rowLineHeight: number;
    rowHeight: number;
  };

  const maxServiceBlockHeight = topStartY - bottomLimitY;

  function dedupeAttempts(attempts: ReportPayload["services"][number]["attempts"]) {
    const seen = new Set<string>();

    return attempts.filter((attempt) => {
      const dedupeKey = [
        attempt.attemptedAt,
        attempt.status,
        attempt.verificationMode,
        attempt.comment,
        attempt.verifierName,
        attempt.managerName,
      ]
        .map((value) => sanitizePdfText(String(value ?? "")).trim())
        .join("|");

      if (seen.has(dedupeKey)) {
        return false;
      }

      seen.add(dedupeKey);
      return true;
    });
  }

  function estimateServiceIntroHeight(service: ReportPayload["services"][number]) {
    const candidateAnswers = Array.isArray(service.candidateAnswers)
      ? service.candidateAnswers
      : [];
    const modeLines = wrapText(
      `Mode: ${toDisplayMode(service.verificationMode)}`,
      11.5,
      contentRight - (contentLeft + 170),
      true,
      "-",
    );

    const modeHeight = Math.max(14, modeLines.length * 14);
    const commentHeight = service.comment?.trim()
      ? wrapText(`Comment: ${service.comment.trim()}`, 11, contentWidth, false, "-").length * 13
      : 0;
    const candidateAnswersHeight =
      candidateAnswers.length > 0
        ?
            14 +
            candidateAnswers.reduce((sum, answer) => {
              const answerText = `${answer.question || "Field"}: ${answer.value || "-"}`;
              return sum + wrapText(answerText, 10.5, contentWidth, false, "-").length * 12.2 + 3;
            }, 0)
        : 0;

    // 22 (heading) + modeHeight + commentHeight + 5 (spacing) + 36 (table header block)
    return 63 + modeHeight + commentHeight + candidateAnswersHeight;
  }

  function buildAttemptRowLayout(
    service: ReportPayload["services"][number],
    attempt: ReportPayload["services"][number]["attempts"][number],
  ): AttemptRowLayout {
    const dateLines = wrapText(
      formatDateTime(attempt.attemptedAt),
      10.8,
      tableColumns.dateTime.width,
      false,
      "-",
    );
    const statusLines = wrapText(
      toDisplayAttemptStatus(attempt.status),
      10.8,
      tableColumns.status.width,
      false,
      "-",
    );
    const modeLines = wrapText(
      toDisplayMode(attempt.verificationMode || service.verificationMode),
      10.8,
      tableColumns.mode.width,
      false,
      "-",
    );

    const detailParts = [
      `Verifier: ${attempt.verifierName || "-"}`,
      `Manager: ${attempt.managerName || "-"}`,
    ];
    if (attempt.comment?.trim()) {
      detailParts.push(`Note: ${attempt.comment.trim()}`);
    }

    const detailsLines = detailParts.flatMap((part) =>
      wrapText(part, 10.8, tableColumns.details.width, false, "-"),
    );

    const rowLineHeight = 12.8;
    const rowLineCount = Math.max(
      dateLines.length,
      statusLines.length,
      modeLines.length,
      detailsLines.length,
    );

    return {
      attempt,
      dateLines,
      statusLines,
      modeLines,
      detailsLines,
      rowLineHeight,
      rowHeight: rowLineCount * rowLineHeight + 5,
    };
  }

  function estimateServiceBlockHeight(
    service: ReportPayload["services"][number],
    attemptRows: AttemptRowLayout[],
  ) {
    const introHeight = estimateServiceIntroHeight(service);
    if (attemptRows.length === 0) {
      return introHeight + 28;
    }

    const rowsHeight = attemptRows.reduce((sum, row) => sum + row.rowHeight + 6, 0);
    return introHeight + rowsHeight + 6;
  }

  function drawServiceTableHeader() {
    ensureSpace(30);
    drawHorizontalLine(y, contentLeft, contentWidth, palette.lineStrong, 0.9);
    const headerY = y - 16;

    page.drawText("Date & Time", {
      x: tableColumns.dateTime.x,
      y: headerY,
      size: 11,
      font: boldFont,
      color: palette.ink,
    });
    page.drawText("Status", {
      x: tableColumns.status.x,
      y: headerY,
      size: 11,
      font: boldFont,
      color: palette.ink,
    });
    page.drawText("Mode", {
      x: tableColumns.mode.x,
      y: headerY,
      size: 11,
      font: boldFont,
      color: palette.ink,
    });
    page.drawText("Attempt Details", {
      x: tableColumns.details.x,
      y: headerY,
      size: 11,
      font: boldFont,
      color: palette.ink,
    });

    y = headerY - 8;
    drawHorizontalLine(y, contentLeft, contentWidth, palette.lineSoft, 0.8);
    y -= 12;
  }

  function drawServiceIntro(
    service: ReportPayload["services"][number],
    serviceIndex: number,
    isContinuation = false,
  ) {
    const candidateAnswers = Array.isArray(service.candidateAnswers)
      ? service.candidateAnswers
      : [];
    ensureSpace(Math.min(estimateServiceIntroHeight(service) + 10, maxServiceBlockHeight));

    const heading = `${serviceIndex + 1}. ${service.serviceName}${isContinuation ? " (Continued)" : ""}`;
    page.drawText(sanitizePdfText(heading), {
      x: contentLeft,
      y,
      size: 13.5,
      font: boldFont,
      color: palette.ink,
    });
    y -= 22;

    const finalStatus = toDisplayStatus(service.status);
    const finalMode = toDisplayMode(service.verificationMode);
    const modeLines = wrapText(`Mode: ${finalMode}`, 11.5, contentRight - (contentLeft + 170), true, "-");

    drawLabelValue(
      contentLeft,
      y,
      "Final Status:",
      finalStatus,
      colorForStatus(service.status),
      11.5,
    );

    drawWrappedLines(modeLines, contentLeft + 170, y, 11.5, palette.ink, true, 14);
    y -= Math.max(14, modeLines.length * 14);

    if (service.comment?.trim()) {
      const commentLines = wrapText(
        `Comment: ${service.comment.trim()}`,
        11,
        contentWidth,
        false,
        "-",
      );
      drawWrappedLines(commentLines, contentLeft, y, 11, palette.ink, false, 13);
      y -= commentLines.length * 13;
    }

    if (candidateAnswers.length > 0) {
      y -= 2;
      page.drawText("Candidate Answers:", {
        x: contentLeft,
        y,
        size: 10.8,
        font: boldFont,
        color: palette.ink,
      });
      y -= 13;

      for (const answer of candidateAnswers) {
        const answerText = `${answer.question || "Field"}: ${answer.value || "-"}`;
        const answerLines = wrapText(answerText, 10.5, contentWidth, false, "-");
        drawWrappedLines(answerLines, contentLeft, y, 10.5, palette.ink, false, 12.2);
        y -= answerLines.length * 12.2 + 3;
      }
    }

    y -= 5;
    drawServiceTableHeader();
  }

  report.services.forEach((service, serviceIndex) => {
    const attempts = dedupeAttempts(service.attempts).slice().reverse();
    const attemptRows = attempts.map((attempt) => buildAttemptRowLayout(service, attempt));
    const serviceBlockHeight = estimateServiceBlockHeight(service, attemptRows);
    const keepServiceTogether = serviceBlockHeight <= maxServiceBlockHeight;

    if (keepServiceTogether && y - serviceBlockHeight < bottomLimitY) {
      addPage();
    }

    drawServiceIntro(service, serviceIndex, false);

    if (attemptRows.length === 0) {
      if (!keepServiceTogether && ensureSpace(26)) {
        drawServiceIntro(service, serviceIndex, true);
      }

      page.drawText("No verification attempts were logged for this service.", {
        x: contentLeft,
        y,
        size: 10.5,
        font: regularFont,
        color: palette.muted,
      });
      y -= 18;
      drawHorizontalLine(y + 4, contentLeft, contentWidth, palette.lineSoft, 0.8);
      y -= 10;
      return;
    }

    for (const attemptRow of attemptRows) {
      if (!keepServiceTogether && ensureSpace(attemptRow.rowHeight + 8)) {
        drawServiceIntro(service, serviceIndex, true);
      }

      const rowTop = y;
      drawWrappedLines(
        attemptRow.dateLines,
        tableColumns.dateTime.x,
        rowTop,
        10.8,
        palette.ink,
        false,
        attemptRow.rowLineHeight,
      );
      drawWrappedLines(
        attemptRow.statusLines,
        tableColumns.status.x,
        rowTop,
        10.8,
        colorForAttemptStatus(attemptRow.attempt.status),
        false,
        attemptRow.rowLineHeight,
      );
      drawWrappedLines(
        attemptRow.modeLines,
        tableColumns.mode.x,
        rowTop,
        10.8,
        palette.ink,
        false,
        attemptRow.rowLineHeight,
      );
      drawWrappedLines(
        attemptRow.detailsLines,
        tableColumns.details.x,
        rowTop,
        10.8,
        palette.ink,
        false,
        attemptRow.rowLineHeight,
      );

      y -= attemptRow.rowHeight;
      drawHorizontalLine(y + 2, contentLeft, contentWidth, rgb(0.35, 0.35, 0.35), 0.65);
      y -= 6;
    }

    y -= 6;
  });

  const latestAttempt = report.services
    .flatMap((service) => service.attempts)
    .sort((first, second) => {
      const firstTime = asDate(first.attemptedAt)?.getTime() ?? 0;
      const secondTime = asDate(second.attemptedAt)?.getTime() ?? 0;
      return secondTime - firstTime;
    })[0];

  const verifiedByName =
    latestAttempt?.managerName?.trim() ||
    latestAttempt?.verifierName?.trim() ||
    report.generatedByName ||
    "-";

  ensureSpace(58);
  const signatureTopY = y;
  page.drawText("Created By:", {
    x: contentLeft,
    y: signatureTopY,
    size: 12,
    font: boldFont,
    color: palette.ink,
  });
  page.drawText(sanitizePdfText(report.generatedByName || "-"), {
    x: contentLeft,
    y: signatureTopY - 18,
    size: 12,
    font: regularFont,
    color: palette.ink,
  });

  const verifiedLabel = "Verified By:";
  const verifiedLabelWidth = boldFont.widthOfTextAtSize(verifiedLabel, 12);
  const safeVerifiedName = sanitizePdfText(verifiedByName);
  const verifiedNameWidth = regularFont.widthOfTextAtSize(safeVerifiedName, 12);

  page.drawText(verifiedLabel, {
    x: contentRight - verifiedLabelWidth,
    y: signatureTopY,
    size: 12,
    font: boldFont,
    color: palette.ink,
  });
  page.drawText(safeVerifiedName, {
    x: contentRight - verifiedNameWidth,
    y: signatureTopY - 18,
    size: 12,
    font: regularFont,
    color: palette.ink,
  });

  y = signatureTopY - 52;

  const noticeHeading = "--END OF REPORT--";
  const noticeSubheading = "IMPORTANT NOTICE";
  const noticeParagraphs = [
    "The Cluso Report is provided by CLUSO INFOLINK, LLC. CLUSO INFOLINK, LLC does not warrant the completeness or correctness of this report or any of the information contained herein. CLUSO INFOLINK, LLC is not liable for any loss, damage or injury caused by negligence or other act or failure of CLUSO INFOLINK, LLC in procuring, collecting or communicating any such information. Reliance on any information contained herein shall be solely at the users risk and shall not constitute a waiver of any claim against, and a release of, CLUSO INFOLINK, LLC.",
    "This report is furnished in strict confidence for your exclusive use of legitimate business purposes and for no other purpose, and shall not be reproduced in whole or in part in any manner whatsoever. CLUSO INFOLINK is a private investigation company licensed by the Texas Private Security Bureau (TX License Number A16821). Contact the Texas PSB for regulatory information or complaints: TX Private Security, MSC 0241, PO Box 4087, Austin TX 78773-0001 Tel: 512-424-7298 Fax: 512-424-7728.",
  ];
  const questionHeading = "QUESTIONS?";
  const questionSupportText =
    "If you have any questions about this report, please feel free to contact us:";
  const questionContactText =
    "Toll Free: 866-685-5177     Tel: 817-945-2289     Fax: 817-945-2297     Email: support@cluso.in";
  const revisionText = "Rev 3.2 (15322)";

  const noticeBoxPadding = 14;
  const noticeInnerWidth = contentWidth - noticeBoxPadding * 2;
  const noticeBodySize = 8.7;
  const noticeBodyLineHeight = 10.2;

  const paragraphLines = noticeParagraphs.map((paragraph) =>
    wrapText(paragraph, noticeBodySize, noticeInnerWidth, false, "-"),
  );
  const questionSupportLines = wrapText(
    questionSupportText,
    noticeBodySize,
    noticeInnerWidth,
    false,
    "-",
  );
  const questionContactLines = wrapText(
    questionContactText,
    noticeBodySize,
    noticeInnerWidth,
    false,
    "-",
  );

  const noticeHeight =
    noticeBoxPadding +
    11 +
    14 +
    paragraphLines.reduce(
      (sum, lines) => sum + lines.length * noticeBodyLineHeight + 7,
      0,
    ) +
    6 +
    11 +
    questionSupportLines.length * noticeBodyLineHeight +
    5 +
    questionContactLines.length * noticeBodyLineHeight +
    14 +
    noticeBoxPadding;

  ensureSpace(noticeHeight + 12);

  const noticeTopY = y;
  const noticeBoxY = noticeTopY - noticeHeight;
  page.drawRectangle({
    x: contentLeft + 2,
    y: noticeBoxY,
    width: contentWidth - 4,
    height: noticeHeight,
    borderColor: palette.lineSoft,
    borderWidth: 0.9,
  });

  let noticeCursorY = noticeTopY - noticeBoxPadding - 2;
  page.drawText(noticeHeading, {
    x: contentLeft + noticeBoxPadding,
    y: noticeCursorY,
    size: 11,
    font: boldFont,
    color: palette.ink,
  });
  noticeCursorY -= 14;

  page.drawText(noticeSubheading, {
    x: contentLeft + noticeBoxPadding,
    y: noticeCursorY,
    size: 10.4,
    font: boldFont,
    color: palette.ink,
  });
  noticeCursorY -= 12;

  for (const lines of paragraphLines) {
    drawWrappedLines(
      lines,
      contentLeft + noticeBoxPadding,
      noticeCursorY,
      noticeBodySize,
      palette.ink,
      false,
      noticeBodyLineHeight,
    );
    noticeCursorY -= lines.length * noticeBodyLineHeight + 7;
  }

  drawHorizontalLine(
    noticeCursorY + 3,
    contentLeft + noticeBoxPadding,
    noticeInnerWidth,
    palette.lineSoft,
    0.7,
  );
  noticeCursorY -= 12;

  page.drawText(questionHeading, {
    x: contentLeft + noticeBoxPadding,
    y: noticeCursorY,
    size: 10.2,
    font: boldFont,
    color: palette.ink,
  });
  noticeCursorY -= 12;

  drawWrappedLines(
    questionSupportLines,
    contentLeft + noticeBoxPadding,
    noticeCursorY,
    noticeBodySize,
    palette.ink,
    false,
    noticeBodyLineHeight,
  );
  noticeCursorY -= questionSupportLines.length * noticeBodyLineHeight + 5;

  drawWrappedLines(
    questionContactLines,
    contentLeft + noticeBoxPadding,
    noticeCursorY,
    noticeBodySize,
    palette.ink,
    false,
    noticeBodyLineHeight,
  );

  const revisionSize = 7.6;
  const revisionWidth = regularFont.widthOfTextAtSize(revisionText, revisionSize);
  page.drawText(revisionText, {
    x: contentLeft + contentWidth - noticeBoxPadding - revisionWidth,
    y: noticeBoxY + 6,
    size: revisionSize,
    font: regularFont,
    color: palette.ink,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const auth = await getCustomerAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (auth.companyAccessStatus === "inactive") {
      return NextResponse.json({ error: COMPANY_ACCESS_INACTIVE_ERROR }, { status: 403 });
    }

    const { requestId } = await context.params;
    if (!requestId?.trim()) {
      return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
    }

    await connectMongo();

    const scoped = await getScopedRequest(auth, requestId);
    if (!scoped.item) {
      return NextResponse.json({ error: scoped.error || "Request not found." }, { status: scoped.status || 404 });
    }

    if (
      !scoped.item.reportData ||
      !scoped.item.reportMetadata ||
      !scoped.item.reportMetadata.customerSharedAt
    ) {
      return NextResponse.json(
        { error: "No shared report found for this request yet." },
        { status: 404 },
      );
    }

    const reportData = scoped.item.reportData as ReportPayload;

    const pdfBuffer = await buildPdfBuffer(reportData);
    const pdfBytes = Uint8Array.from(pdfBuffer);

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportData.reportNumber || "verification-report"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[report-download] failed", error);
    const message =
      error instanceof Error ? error.message : "Could not generate report download.";

    return NextResponse.json(
      {
        error: "Could not generate report download.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 },
    );
  }
}
