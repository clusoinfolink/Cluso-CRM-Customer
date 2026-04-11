import { InferSchemaType, Model, Schema, model, models } from "mongoose";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const InvoicePartyDetailsSchema = new Schema(
  {
    companyName: { type: String, default: "", trim: true },
    loginEmail: { type: String, default: "", trim: true },
    gstin: { type: String, default: "", trim: true },
    cinRegistrationNumber: { type: String, default: "", trim: true },
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
    !hasLineItemsPath ||
    !hasUsageCountPath ||
    !hasLineTotalPath)
) {
  delete models.Invoice;
}

const Invoice =
  (models.Invoice as Model<InvoiceDocument>) || model("Invoice", InvoiceSchema);

export default Invoice;
