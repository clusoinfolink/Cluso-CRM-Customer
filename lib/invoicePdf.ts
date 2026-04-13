import fs from "fs";
import path from "path";

export type InvoicePdfPartyDetails = {
  companyName?: string;
  loginEmail?: string;
  gstin?: string;
  cinRegistrationNumber?: string;
  sacCode?: string;
  ltuCode?: string;
  address?: string;
  invoiceEmail?: string;
  billingSameAsCompany?: boolean;
  billingAddress?: string;
};

export type InvoicePdfLineItem = {
  serviceName?: string;
  usageCount?: number;
  currency?: string;
  price?: number;
  lineTotal?: number;
};

export type InvoicePdfCurrencyTotal = {
  currency?: string;
  subtotal?: number;
};

export type InvoicePdfPayload = {
  invoiceNumber: string;
  billingMonth: string;
  gstEnabled: boolean;
  gstRate: number;
  createdAt: string;
  generatedByName: string;
  enterpriseDetails: InvoicePdfPartyDetails;
  clusoDetails: InvoicePdfPartyDetails;
  lineItems: InvoicePdfLineItem[];
  totalsByCurrency: InvoicePdfCurrencyTotal[];
};

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

export function toInvoicePdfPayload(value: unknown): InvoicePdfPayload {
  const raw = asRecord(value);

  const lineItemsRaw = Array.isArray(raw.lineItems) ? raw.lineItems : [];
  const totalsRaw = Array.isArray(raw.totalsByCurrency) ? raw.totalsByCurrency : [];

  return {
    invoiceNumber: asString(raw.invoiceNumber, "INV"),
    billingMonth: asString(raw.billingMonth),
    gstEnabled: asBoolean(raw.gstEnabled, false),
    gstRate: normalizeGstRate(raw.gstRate, 18),
    createdAt: asString(raw.createdAt),
    generatedByName: asString(raw.generatedByName),
    enterpriseDetails: asRecord(raw.enterpriseDetails) as InvoicePdfPartyDetails,
    clusoDetails: asRecord(raw.clusoDetails) as InvoicePdfPartyDetails,
    lineItems: lineItemsRaw.map((entry) => asRecord(entry) as InvoicePdfLineItem),
    totalsByCurrency: totalsRaw.map((entry) => asRecord(entry) as InvoicePdfCurrencyTotal),
  };
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
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

function formatBillingPeriod(value: string) {
  const parsedStart = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(parsedStart.getTime())) {
    return value || "-";
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

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function sanitizePdfText(value: string) {
  return value.replace(/₹/g, "INR ").replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, "");
}

function wrapPdfText(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (input: string, size: number) => number },
  fontSize: number,
) {
  const normalized = sanitizePdfText(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return ["-"];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const char of word) {
      const chunkCandidate = `${chunk}${char}`;
      if (font.widthOfTextAtSize(chunkCandidate, fontSize) <= maxWidth) {
        chunk = chunkCandidate;
        continue;
      }

      if (chunk) {
        lines.push(chunk);
      }
      chunk = char;
    }

    current = chunk;
  }

  pushCurrent();
  return lines.length > 0 ? lines : ["-"];
}

function drawRightAlignedText(
  page: unknown,
  text: string,
  rightX: number,
  y: number,
  font: { widthOfTextAtSize: (input: string, size: number) => number },
  fontSize: number,
  color: unknown,
) {
  const clean = sanitizePdfText(text);
  const textWidth = font.widthOfTextAtSize(clean, fontSize);
  // @ts-ignore
  page.drawText(clean, {
    x: rightX - textWidth,
    y,
    size: fontSize,
    font,
    color,
  });
}

export async function buildInvoicePdf(payload: InvoicePdfPayload): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdfDoc = await PDFDocument.create();
  const pageSize: [number, number] = [595, 842];
  let page = pdfDoc.addPage(pageSize);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let logoImage: unknown = null;
  try {
    const logoPath = path.join(process.cwd(), "public", "images", "cluso-infolink-logo.png");
    if (fs.existsSync(logoPath)) {
      const logoBytes = fs.readFileSync(logoPath);
      logoImage = await pdfDoc.embedPng(logoBytes);
    }
  } catch (err) {
    console.error("Failed to load invoice logo", err);
  }

  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 26;
  const contentWidth = width - margin * 2;
  const bottomSafeY = 56;

  const colors = {
    border: rgb(0.85, 0.82, 0.78),
    cardBg: rgb(0.99, 0.98, 0.96),
    heading: rgb(0.12, 0.25, 0.40),
    text: rgb(0.20, 0.20, 0.20),
    muted: rgb(0.40, 0.40, 0.40),
    tableHeaderBg: rgb(0.96, 0.94, 0.90),
    rowAlt: rgb(0.99, 0.98, 0.96),
  };

  const drawOuterFrame = () => {
    page.drawRectangle({
      x: 16,
      y: 16,
      width: width - 32,
      height: height - 32,
      borderColor: rgb(0.56, 0.08, 0.15),
      borderWidth: 1.8,
    });
  };

  const startNewPageForTable = () => {
    page = pdfDoc.addPage(pageSize);
    drawOuterFrame();

    page.drawText(sanitizePdfText(`Invoice #: ${payload.invoiceNumber} (continued)`), {
      x: margin,
      y: height - 52,
      size: 11,
      font: boldFont,
      color: colors.heading,
    });

    return height - 84;
  };

  const drawTableHeader = (topY: number) => {
    const headerHeight = 22;
    const serviceWidth = 250;
    const countWidth = 50;
    const currencyWidth = 70;
    const rateWidth = 82;
    const totalWidth = contentWidth - serviceWidth - countWidth - currencyWidth - rateWidth;

    const xService = margin;
    const xCount = xService + serviceWidth;
    const xCurrency = xCount + countWidth;
    const xRate = xCurrency + currencyWidth;
    const xTotal = xRate + rateWidth;

    page.drawRectangle({
      x: margin,
      y: topY - headerHeight,
      width: contentWidth,
      height: headerHeight,
      borderColor: colors.border,
      borderWidth: 1,
      color: colors.tableHeaderBg,
    });

    page.drawText("Service", {
      x: xService + 6,
      y: topY - 15,
      size: 10,
      font: boldFont,
      color: colors.text,
    });
    page.drawText("Count", {
      x: xCount + 6,
      y: topY - 15,
      size: 10,
      font: boldFont,
      color: colors.text,
    });
    page.drawText("Currency", {
      x: xCurrency + 6,
      y: topY - 15,
      size: 10,
      font: boldFont,
      color: colors.text,
    });
    page.drawText("Rate", {
      x: xRate + 6,
      y: topY - 15,
      size: 10,
      font: boldFont,
      color: colors.text,
    });
    page.drawText("Total", {
      x: xTotal + 6,
      y: topY - 15,
      size: 10,
      font: boldFont,
      color: colors.text,
    });

    return {
      nextY: topY - headerHeight,
      columns: {
        xService,
        xCount,
        xCurrency,
        xRate,
        xTotal,
        serviceWidth,
        countWidth,
        currencyWidth,
        rateWidth,
        totalWidth,
      },
    };
  };

  drawOuterFrame();

  page.drawText(sanitizePdfText("Invoice"), {
    x: margin,
    y: height - 62,
    size: 44,
    font: boldFont,
    color: colors.heading,
  });

  if (logoImage) {
    const { width: origW, height: origH } = (logoImage as { width: number; height: number });
    const desiredWidth = 140;
    const scale = desiredWidth / origW;
    const drawH = origH * scale;
    // @ts-ignore
    page.drawImage(logoImage, {
      x: contentWidth + margin - desiredWidth,
      y: height - margin - drawH - 10,
      width: desiredWidth,
      height: drawH,
    });
  }

  const metadataLines = [
    `Invoice #: ${payload.invoiceNumber}`,
    `Generated: ${formatDateTime(payload.createdAt)}`,
    payload.generatedByName.trim() ? `Generated By: ${payload.generatedByName}` : "",
    `Billing Period: ${formatBillingPeriod(payload.billingMonth)}`,
  ].filter(Boolean);

  let metaY = height - 90;
  for (const line of metadataLines) {
    page.drawText(sanitizePdfText(line), {
      x: margin,
      y: metaY,
      size: line.startsWith("Invoice #") ? 12 : 10.5,
      font: line.startsWith("Invoice #") ? boldFont : font,
      color: line.startsWith("Invoice #") ? colors.text : colors.muted,
    });
    metaY -= 17;
  }

  const sectionTopY = metaY - 14;
  const colGap = 14;
  const colWidth = (contentWidth - colGap) / 2;
  const detailsFontSize = 9;
  const detailsLineHeight = 11;
  const sectionHeaderHeight = 22;
  const sectionPaddingX = 10;
  const sectionPaddingY = 10;

  const buildPartyRows = (
    details: InvoicePdfPartyDetails,
    includeClusoTaxCodes = false,
  ) => {
    const rows = [
      { label: "Company Name", value: details.companyName || "-" },
      { label: "Login Email", value: details.loginEmail || "-" },
      { label: "GSTIN", value: details.gstin || "-" },
      { label: "CIN / Registration", value: details.cinRegistrationNumber || "-" },
      { label: "Address", value: details.address || "-" },
      { label: "Invoice Email", value: details.invoiceEmail || "-" },
      {
        label: "Billing same as company",
        value: details.billingSameAsCompany ? "Yes" : "No",
      },
      { label: "Billing Address", value: details.billingAddress || "-" },
    ];

    if (includeClusoTaxCodes) {
      rows.splice(4, 0,
        { label: "SAC Code", value: details.sacCode || "-" },
        { label: "LTU Code", value: details.ltuCode || "-" },
      );
    }

    return rows.map((row) => ({
      ...row,
      lines: wrapPdfText(
        `${row.label}: ${row.value}`,
        colWidth - sectionPaddingX * 2,
        font,
        detailsFontSize,
      ),
    }));
  };

  const leftRows = buildPartyRows(payload.enterpriseDetails);
  const rightRows = buildPartyRows(payload.clusoDetails, true);

  const estimateRowsHeight = (rows: Array<{ lines: string[] }>) => {
    return rows.reduce((total, row) => total + row.lines.length * detailsLineHeight + 3, 0);
  };

  const detailsHeight = Math.max(estimateRowsHeight(leftRows), estimateRowsHeight(rightRows));
  const sectionHeight = sectionHeaderHeight + sectionPaddingY * 2 + detailsHeight;

  const drawPartySection = (
    sectionTitle: string,
    rows: Array<{ lines: string[] }>,
    x: number,
    topY: number,
  ) => {
    page.drawRectangle({
      x,
      y: topY - sectionHeight,
      width: colWidth,
      height: sectionHeight,
      borderColor: colors.border,
      borderWidth: 1,
      color: colors.cardBg,
    });

    page.drawRectangle({
      x,
      y: topY - sectionHeaderHeight,
      width: colWidth,
      height: sectionHeaderHeight,
      color: rgb(0.93, 0.95, 0.99),
    });

    page.drawText(sanitizePdfText(sectionTitle), {
      x: x + sectionPaddingX,
      y: topY - 15,
      size: 10,
      font: boldFont,
      color: colors.heading,
    });

    let y = topY - sectionHeaderHeight - sectionPaddingY - 1;
    for (const row of rows) {
      for (const line of row.lines) {
        page.drawText(sanitizePdfText(line), {
          x: x + sectionPaddingX,
          y,
          size: detailsFontSize,
          font,
          color: colors.text,
        });
        y -= detailsLineHeight;
      }
      y -= 3;
    }
  };

  drawPartySection(
    "Customer details - Enterprise details",
    leftRows,
    margin,
    sectionTopY,
  );
  drawPartySection("Cluso Infolink details", rightRows, margin + colWidth + colGap, sectionTopY);

  let tableTopY = sectionTopY - sectionHeight - 22;
  page.drawText(sanitizePdfText("Invoice Items (Monthly Service Usage)"), {
    x: margin,
    y: tableTopY,
    size: 13,
    font: boldFont,
    color: colors.heading,
  });

  let { nextY: rowY, columns } = drawTableHeader(tableTopY - 8);
  let rowIndex = 0;

  for (const item of payload.lineItems) {
    const serviceLines = wrapPdfText(
      item.serviceName || "-",
      columns.serviceWidth - 12,
      font,
      9,
    );
    const rowContentHeight = Math.max(14, serviceLines.length * 11);
    const rowHeight = rowContentHeight + 8;

    if (rowY - rowHeight < bottomSafeY) {
      tableTopY = startNewPageForTable();
      page.drawText(sanitizePdfText("Invoice Items (Monthly Service Usage)"), {
        x: margin,
        y: tableTopY,
        size: 13,
        font: boldFont,
        color: colors.heading,
      });
      ({ nextY: rowY, columns } = drawTableHeader(tableTopY - 8));
    }

    page.drawRectangle({
      x: margin,
      y: rowY - rowHeight,
      width: contentWidth,
      height: rowHeight,
      borderColor: colors.border,
      borderWidth: 0.6,
      color: rowIndex % 2 === 0 ? colors.rowAlt : rgb(1, 1, 1),
    });

    let serviceY = rowY - 13;
    for (const line of serviceLines) {
      page.drawText(sanitizePdfText(line), {
        x: columns.xService + 6,
        y: serviceY,
        size: 9,
        font,
        color: colors.text,
      });
      serviceY -= 11;
    }

    const middleY = rowY - Math.max(14, rowHeight / 2 + 3);
    page.drawText(String(Math.max(0, Math.trunc(asNumber(item.usageCount, 0)))), {
      x: columns.xCount + 8,
      y: middleY,
      size: 9,
      font,
      color: colors.text,
    });
    page.drawText(sanitizePdfText(asString(item.currency, "INR")), {
      x: columns.xCurrency + 8,
      y: middleY,
      size: 9,
      font,
      color: colors.text,
    });

    drawRightAlignedText(
      page,
      formatMoney(asNumber(item.price, 0), asString(item.currency, "INR")),
      columns.xRate + columns.rateWidth - 8,
      middleY,
      boldFont,
      9,
      colors.text,
    );
    drawRightAlignedText(
      page,
      formatMoney(asNumber(item.lineTotal, 0), asString(item.currency, "INR")),
      columns.xTotal + columns.totalWidth - 8,
      middleY,
      boldFont,
      9,
      colors.text,
    );

    rowY -= rowHeight;
    rowIndex += 1;
  }

  rowY -= 10;
  const normalizedGstRate = normalizeGstRate(payload.gstRate, 18);

  for (const total of payload.totalsByCurrency) {
    const currency = asString(total.currency, "INR");
    const subtotal = asNumber(total.subtotal, 0);
    const gstAmount = payload.gstEnabled
      ? Math.round((((subtotal * normalizedGstRate) / 100) * 100)) / 100
      : 0;
    const grandTotal = subtotal + gstAmount;

    const summaryRows = [
      {
        label: `Sub Total (${currency})`,
        amount: subtotal,
        emphasize: false,
      },
      ...(payload.gstEnabled
        ? [
            {
              label: `GST @${normalizedGstRate}%`,
              amount: gstAmount,
              emphasize: false,
            },
          ]
        : []),
      {
        label: `Total (${currency})`,
        amount: grandTotal,
        emphasize: true,
      },
    ];

    for (const summaryRow of summaryRows) {
      const summaryHeight = 20;
      const summaryWidth = 250;

      if (rowY - summaryHeight < bottomSafeY) {
        rowY = startNewPageForTable();
      }

      const summaryX = margin + contentWidth - summaryWidth;
      page.drawRectangle({
        x: summaryX,
        y: rowY - summaryHeight,
        width: summaryWidth,
        height: summaryHeight,
        borderColor: colors.border,
        borderWidth: 1,
        color: summaryRow.emphasize ? colors.tableHeaderBg : rgb(1, 1, 1),
      });

      page.drawText(sanitizePdfText(summaryRow.label), {
        x: summaryX + 8,
        y: rowY - 13,
        size: 10,
        font: summaryRow.emphasize ? boldFont : font,
        color: colors.text,
      });

      drawRightAlignedText(
        page,
        formatMoney(summaryRow.amount, currency),
        summaryX + summaryWidth - 8,
        rowY - 13,
        summaryRow.emphasize ? boldFont : font,
        10,
        colors.text,
      );

      rowY -= summaryHeight + 4;
    }

    rowY -= 4;
  }

  const footerY = 36;
  page.drawLine({
    start: { x: margin, y: footerY + 12 },
    end: { x: margin + contentWidth, y: footerY + 12 },
    thickness: 0.7,
    color: colors.border,
  });
  page.drawText("System generated invoice from Cluso Infolink", {
    x: margin,
    y: footerY,
    size: 8.5,
    font,
    color: colors.muted,
  });

  if (payload.generatedByName.trim()) {
    drawRightAlignedText(
      page,
      `Generated by ${payload.generatedByName}`,
      margin + contentWidth,
      footerY,
      font,
      8.5,
      colors.muted,
    );
  }

  return Buffer.from(await pdfDoc.save());
}
