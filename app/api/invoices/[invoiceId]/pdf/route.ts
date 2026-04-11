import { NextRequest, NextResponse } from "next/server";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import { buildInvoicePdf, toInvoicePdfPayload } from "@/lib/invoicePdf";
import Invoice from "@/lib/models/Invoice";
import type { PortalRole } from "@/lib/types";

function canAccessInvoices(auth: { role: PortalRole } | null) {
  if (!auth) {
    return false;
  }

  return auth.role === "customer" || auth.role === "delegate" || auth.role === "delegate_user";
}

function companyIdFromAuth(auth: {
  userId: string;
  role: PortalRole;
  parentCustomerId: string | null;
}) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const auth = await getCustomerAuthFromRequest(req);
  if (!canAccessInvoices(auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = companyIdFromAuth(auth);
  if (!companyId) {
    return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
  }

  const { invoiceId } = await context.params;
  if (!invoiceId?.trim()) {
    return NextResponse.json({ error: "Invalid invoice id." }, { status: 400 });
  }

  await connectMongo();
  const invoiceDoc = await Invoice.findOne({ _id: invoiceId, customer: companyId }).lean();
  if (!invoiceDoc) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const payload = toInvoicePdfPayload(invoiceDoc as unknown as Record<string, unknown>);
  const pdfBuffer = await buildInvoicePdf(payload);
  const responseBody = new Uint8Array(pdfBuffer);

  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${payload.invoiceNumber || "invoice"}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
