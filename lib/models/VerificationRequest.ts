import { InferSchemaType, Model, Schema, models, model } from "mongoose";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const VerificationRequestSchema = new Schema(
  {
    candidateName: { type: String, required: true },
    candidateEmail: { type: String, default: "" },
    candidatePhone: { type: String, default: "" },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByDelegate: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    candidateUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "verified"],
      default: "pending",
    },
    candidateFormStatus: {
      type: String,
      enum: ["pending", "submitted"],
      default: "pending",
    },
    candidateSubmittedAt: {
      type: Date,
      default: null,
    },
    enterpriseApprovedAt: {
      type: Date,
      default: null,
    },
    enterpriseDecisionLockedAt: {
      type: Date,
      default: null,
    },
    rejectionNote: { type: String, default: "" },
    customerRejectedFields: [
      {
        serviceId: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          required: true,
        },
        serviceName: { type: String, required: true },
        question: { type: String, required: true },
        fieldType: {
          type: String,
          enum: ["text", "long_text", "number", "file", "date"],
          required: true,
        },
      },
    ],
    candidateFormResponses: [
      {
        serviceId: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          required: true,
        },
        serviceName: { type: String, required: true },
        answers: [
          {
            question: { type: String, required: true },
            fieldType: {
              type: String,
              enum: ["text", "long_text", "number", "file", "date"],
              required: true,
            },
            required: { type: Boolean, default: false },
            repeatable: { type: Boolean, default: false },
            value: { type: String, default: "" },
            fileName: { type: String, default: "" },
            fileMimeType: { type: String, default: "" },
            fileSize: { type: Number, default: null },
            fileData: { type: String, default: "" },
          },
        ],
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
    serviceVerifications: [
      {
        serviceId: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          required: true,
        },
        serviceName: { type: String, required: true },
        status: {
          type: String,
          enum: ["pending", "verified", "unverified"],
          default: "pending",
        },
        verificationMode: { type: String, default: "" },
        comment: { type: String, default: "" },
        attempts: [
          {
            status: {
              type: String,
              enum: ["verified", "unverified"],
              required: true,
            },
            verificationMode: { type: String, default: "" },
            comment: { type: String, default: "" },
            attemptedAt: { type: Date, required: true },
            verifierId: {
              type: Schema.Types.ObjectId,
              ref: "User",
              default: null,
            },
            verifierName: { type: String, default: "" },
            managerId: {
              type: Schema.Types.ObjectId,
              ref: "User",
              default: null,
            },
            managerName: { type: String, default: "" },
          },
        ],
      },
    ],
    reportMetadata: {
      generatedAt: { type: Date, default: null },
      generatedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      generatedByName: { type: String, default: "" },
      reportNumber: { type: String, default: "" },
    },
    reportData: {
      type: Schema.Types.Mixed,
      default: null,
    },
    invoiceSnapshot: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

export type VerificationRequestDocument = InferSchemaType<
  typeof VerificationRequestSchema
> & { _id: string };

if (models.VerificationRequest && !models.VerificationRequest.schema.path("selectedServices")) {
  delete models.VerificationRequest;
}

if (
  models.VerificationRequest &&
  (!models.VerificationRequest.schema.path("status")?.options?.enum?.includes("verified") ||
    !models.VerificationRequest.schema.path("candidateFormStatus") ||
    !models.VerificationRequest.schema.path("customerRejectedFields") ||
    !models.VerificationRequest.schema.path("candidateFormResponses") ||
    !models.VerificationRequest.schema.path("createdByDelegate") ||
    !models.VerificationRequest.schema.path("candidateUser") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.fileData") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.required") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.repeatable") ||
    !models.VerificationRequest.schema.path("enterpriseApprovedAt") ||
    !models.VerificationRequest.schema.path("enterpriseDecisionLockedAt") ||
    !models.VerificationRequest.schema.path("serviceVerifications") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.attemptedAt") ||
    !models.VerificationRequest.schema.path("reportMetadata") ||
    !models.VerificationRequest.schema.path("reportData") ||
    !models.VerificationRequest.schema.path("invoiceSnapshot"))
) {
  delete models.VerificationRequest;
}

const VerificationRequest =
  (models.VerificationRequest as Model<VerificationRequestDocument>) ||
  model("VerificationRequest", VerificationRequestSchema);

export default VerificationRequest;
