import { InferSchemaType, Model, Schema, model, models } from "mongoose";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const INVOICE_PAYMENT_STATUS_VALUES = ["unpaid", "submitted", "paid"] as const;

const InvoicePartyDetailsSchema = new Schema(
  {
    companyName: { type: String, default: "", trim: true },
    loginEmail: { type: String, default: "", trim: true },
    gstin: { type: String, default: "", trim: true },
    cinRegistrationNumber: { type: String, default: "", trim: true },
    sacCode: { type: String, default: "", trim: true },
    ltuCode: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    invoiceEmail: { type: String, default: "", trim: true },
    billingSameAsCompany: { type: Boolean, default: true },
    billingAddress: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const InvoiceLineItemSchema = new Schema(
  {
    serviceId: { type: String, required: true, trim: true },
    serviceName: { type: String, required: true, trim: true },
    usageCount: { type: Number, required: true, min: 1, default: 1 },
    price: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, default: "INR" },
  },
  { _id: false },
);

const InvoiceCurrencyTotalSchema = new Schema(
  {
    currency: { type: String, enum: SUPPORTED_CURRENCIES, default: "INR" },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const InvoiceUpiDetailsSchema = new Schema(
  {
    upiId: { type: String, default: "", trim: true },
    qrCodeImageUrl: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const InvoiceWireTransferDetailsSchema = new Schema(
  {
    accountHolderName: { type: String, default: "", trim: true },
    accountNumber: { type: String, default: "", trim: true },
    bankName: { type: String, default: "", trim: true },
    ifscCode: { type: String, default: "", trim: true },
    branchName: { type: String, default: "", trim: true },
    swiftCode: { type: String, default: "", trim: true },
    instructions: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const InvoicePaymentDetailsSchema = new Schema(
  {
    upi: {
      type: InvoiceUpiDetailsSchema,
      default: () => ({}),
      required: true,
    },
    wireTransfer: {
      type: InvoiceWireTransferDetailsSchema,
      default: () => ({}),
      required: true,
    },
  },
  { _id: false },
);

const InvoicePaymentRelatedFileSchema = new Schema(
  {
    fileData: { type: String, default: "", trim: true },
    fileName: { type: String, default: "", trim: true },
    fileMimeType: { type: String, default: "", trim: true },
    fileSize: { type: Number, min: 0, default: 0 },
    uploadedAt: { type: Date, default: null },
  },
  { _id: false },
);

const InvoicePaymentProofSchema = new Schema(
  {
    method: {
      type: String,
      enum: ["upi", "wireTransfer", "adminUpload"],
      default: "upi",
    },
    screenshotData: { type: String, default: "", trim: true },
    screenshotFileName: { type: String, default: "", trim: true },
    screenshotMimeType: { type: String, default: "", trim: true },
    screenshotFileSize: { type: Number, min: 0, default: 0 },
    uploadedAt: { type: Date, default: null },
    relatedFiles: {
      type: [InvoicePaymentRelatedFileSchema],
      default: [],
    },
  },
  { _id: false },
);

const InvoiceSchema = new Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    billingMonth: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    gstEnabled: {
      type: Boolean,
      default: false,
    },
    gstRate: {
      type: Number,
      default: 18,
      min: 0,
      max: 100,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    customerName: { type: String, default: "", trim: true },
    customerEmail: { type: String, default: "", trim: true },
    enterpriseDetails: {
      type: InvoicePartyDetailsSchema,
      default: () => ({}),
      required: true,
    },
    clusoDetails: {
      type: InvoicePartyDetailsSchema,
      default: () => ({}),
      required: true,
    },
    paymentDetails: {
      type: InvoicePaymentDetailsSchema,
      default: () => ({}),
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: INVOICE_PAYMENT_STATUS_VALUES,
      default: "unpaid",
      index: true,
    },
    paymentProof: {
      type: InvoicePaymentProofSchema,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    lineItems: {
      type: [InvoiceLineItemSchema],
      default: [],
    },
    totalsByCurrency: {
      type: [InvoiceCurrencyTotalSchema],
      default: [],
    },
    generatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    generatedByName: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

export type InvoiceDocument = InferSchemaType<typeof InvoiceSchema> & {
  _id: string;
};

const hasInvoiceNumberPath = Boolean(models.Invoice?.schema.path("invoiceNumber"));
const hasBillingMonthPath = Boolean(models.Invoice?.schema.path("billingMonth"));
const hasGstEnabledPath = Boolean(models.Invoice?.schema.path("gstEnabled"));
const hasGstRatePath = Boolean(models.Invoice?.schema.path("gstRate"));
const hasCustomerPath = Boolean(models.Invoice?.schema.path("customer"));
const hasEnterpriseDetailsPath = Boolean(models.Invoice?.schema.path("enterpriseDetails"));
const hasClusoDetailsPath = Boolean(models.Invoice?.schema.path("clusoDetails"));
const hasEnterpriseSacCodePath = Boolean(models.Invoice?.schema.path("enterpriseDetails.sacCode"));
const hasEnterpriseLtuCodePath = Boolean(models.Invoice?.schema.path("enterpriseDetails.ltuCode"));
const hasClusoSacCodePath = Boolean(models.Invoice?.schema.path("clusoDetails.sacCode"));
const hasClusoLtuCodePath = Boolean(models.Invoice?.schema.path("clusoDetails.ltuCode"));
const hasPaymentDetailsPath = Boolean(models.Invoice?.schema.path("paymentDetails"));
const hasUpiIdPath = Boolean(models.Invoice?.schema.path("paymentDetails.upi.upiId"));
const hasWireTransferPath = Boolean(models.Invoice?.schema.path("paymentDetails.wireTransfer.accountNumber"));
const hasPaymentStatusPath = Boolean(models.Invoice?.schema.path("paymentStatus"));
const hasPaymentProofPath = Boolean(models.Invoice?.schema.path("paymentProof.screenshotData"));
const hasPaidAtPath = Boolean(models.Invoice?.schema.path("paidAt"));
const hasLineItemsPath = Boolean(models.Invoice?.schema.path("lineItems"));
const hasUsageCountPath = Boolean(models.Invoice?.schema.path("lineItems.usageCount"));
const hasLineTotalPath = Boolean(models.Invoice?.schema.path("lineItems.lineTotal"));

if (
  models.Invoice &&
  (!hasInvoiceNumberPath ||
    !hasBillingMonthPath ||
    !hasGstEnabledPath ||
    !hasGstRatePath ||
    !hasCustomerPath ||
    !hasEnterpriseDetailsPath ||
    !hasClusoDetailsPath ||
    !hasEnterpriseSacCodePath ||
    !hasEnterpriseLtuCodePath ||
    !hasClusoSacCodePath ||
    !hasClusoLtuCodePath ||
    !hasPaymentDetailsPath ||
    !hasUpiIdPath ||
    !hasWireTransferPath ||
    !hasPaymentStatusPath ||
    !hasPaymentProofPath ||
    !hasPaidAtPath ||
    !hasLineItemsPath ||
    !hasUsageCountPath ||
    !hasLineTotalPath)
) {
  delete models.Invoice;
}

const Invoice =
  (models.Invoice as Model<InvoiceDocument>) || model("Invoice", InvoiceSchema);

export default Invoice;
