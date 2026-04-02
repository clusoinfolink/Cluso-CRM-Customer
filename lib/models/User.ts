import { InferSchemaType, Model, Schema, models, model } from "mongoose";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const AddressSchema = new Schema(
  {
    line1: { type: String, default: "", trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    postalCode: { type: String, default: "", trim: true },
    country: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const PhoneSchema = new Schema(
  {
    countryCode: { type: String, default: "India (+91)", trim: true },
    number: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const CompanyDocumentSchema = new Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true, min: 0 },
    fileType: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const PartnerProfileSchema = new Schema(
  {
    companyInformation: {
      companyName: { type: String, default: "", trim: true },
      gstin: { type: String, default: "", trim: true },
      cinRegistrationNumber: { type: String, default: "", trim: true },
      address: { type: AddressSchema, default: () => ({}) },
      documents: { type: [CompanyDocumentSchema], default: [] },
    },
    invoicingInformation: {
      billingSameAsCompany: { type: Boolean, default: true },
      invoiceEmail: { type: String, default: "", trim: true },
      address: { type: AddressSchema, default: () => ({}) },
    },
    primaryContactInformation: {
      firstName: { type: String, default: "", trim: true },
      lastName: { type: String, default: "", trim: true },
      designation: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true },
      officePhone: { type: PhoneSchema, default: () => ({}) },
      mobilePhone: { type: PhoneSchema, default: () => ({}) },
      whatsappPhone: { type: PhoneSchema, default: () => ({}) },
    },
    additionalQuestions: {
      heardAboutUs: { type: String, default: "", trim: true },
      referredBy: { type: String, default: "", trim: true },
      yearlyBackgroundsExpected: { type: String, default: "", trim: true },
      promoCode: { type: String, default: "", trim: true },
      primaryIndustry: { type: String, default: "", trim: true },
    },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["superadmin", "admin", "customer", "delegate", "delegate_user", "candidate"],
      required: true,
    },
    parentCustomer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdByDelegate: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    sessionVersion: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deactivatedAt: {
      type: Date,
      default: null,
    },
    deactivatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deactivationReason: {
      type: String,
      default: "",
      trim: true,
    },
    accessRoleHistory: [
      {
        fromRole: {
          type: String,
          enum: ["delegate", "delegate_user"],
          required: true,
        },
        toRole: {
          type: String,
          enum: ["delegate", "delegate_user"],
          required: true,
        },
        changedBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        changedAt: {
          type: Date,
          default: Date.now,
          required: true,
        },
        reason: {
          type: String,
          required: true,
          trim: true,
        },
      },
    ],
    selectedServices: [
      {
        serviceId: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          required: true,
        },
        serviceName: { type: String, required: true },
        price: { type: Number, required: true },
        currency: { type: String, enum: SUPPORTED_CURRENCIES, default: "INR" },
      },
    ],
    partnerProfile: {
      type: PartnerProfileSchema,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

export type UserDocument = InferSchemaType<typeof UserSchema> & { _id: string };

const existingUserRoleValues = models.User?.schema.path("role")?.options?.enum;
const hasDelegateUserRole =
  Array.isArray(existingUserRoleValues) && existingUserRoleValues.includes("delegate_user");
const hasCandidateRole =
  Array.isArray(existingUserRoleValues) && existingUserRoleValues.includes("candidate");
const hasCreatedByDelegatePath = Boolean(models.User?.schema.path("createdByDelegate"));
const hasSessionVersionPath = Boolean(models.User?.schema.path("sessionVersion"));
const hasIsActivePath = Boolean(models.User?.schema.path("isActive"));
const hasDeactivatedAtPath = Boolean(models.User?.schema.path("deactivatedAt"));
const hasDeactivatedByPath = Boolean(models.User?.schema.path("deactivatedBy"));
const hasDeactivationReasonPath = Boolean(models.User?.schema.path("deactivationReason"));
const hasAccessRoleHistoryPath = Boolean(models.User?.schema.path("accessRoleHistory"));
const hasPartnerProfilePath = Boolean(models.User?.schema.path("partnerProfile"));

if (
  models.User &&
  (!models.User.schema.path("selectedServices") ||
    !hasDelegateUserRole ||
    !hasCandidateRole ||
    !hasCreatedByDelegatePath ||
    !hasSessionVersionPath ||
    !hasIsActivePath ||
    !hasDeactivatedAtPath ||
    !hasDeactivatedByPath ||
    !hasDeactivationReasonPath ||
    !hasAccessRoleHistoryPath ||
    !hasPartnerProfilePath)
) {
  delete models.User;
}

const User = (models.User as Model<UserDocument>) || model("User", UserSchema);

export default User;
