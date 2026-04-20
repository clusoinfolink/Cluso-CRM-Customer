import { InferSchemaType, Model, Schema, models, model } from "mongoose";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const VerificationRequestSchema = new Schema(
  {
    candidateName: { type: String, required: true },
    candidateEmail: { type: String, default: "" },
    candidatePhone: { type: String, default: "" },
    verificationCountry: { type: String, default: "", trim: true },
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
        fieldKey: { type: String, default: "" },
        question: { type: String, required: true },
        fieldType: {
          type: String,
          enum: ["text", "long_text", "number", "file", "date", "dropdown", "email", "mobile", "composite"],
          required: true,
        },
        subFields: [
          {
            fieldKey: { type: String, default: "" },
            question: { type: String, required: true },
            fieldType: {
              type: String,
              enum: ["text", "number", "date", "dropdown"],
              required: true,
            },
            value: { type: String, default: "" },
            required: { type: Boolean, default: false },
            dropdownOptions: { type: [String], default: [] },
          },
        ],
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
        serviceEntryCount: { type: Number, default: 1, min: 1 },
        answers: [
          {
            fieldKey: { type: String, default: "" },
            question: { type: String, required: true },
            fieldType: {
              type: String,
              enum: ["text", "long_text", "number", "file", "date", "dropdown", "email", "mobile", "composite"],
              required: true,
            },
            subFields: [
              {
                fieldKey: { type: String, default: "" },
                question: { type: String, required: true },
                fieldType: {
                  type: String,
                  enum: ["text", "number", "date", "dropdown"],
                  required: true,
                },
                value: { type: String, default: "" },
                required: { type: Boolean, default: false },
                dropdownOptions: { type: [String], default: [] },
              },
            ],
            required: { type: Boolean, default: false },
            repeatable: { type: Boolean, default: false },
            notApplicable: { type: Boolean, default: false },
            notApplicableText: { type: String, default: "" },
            value: { type: String, default: "" },
            fileName: { type: String, default: "" },
            fileMimeType: { type: String, default: "" },
            fileSize: { type: Number, default: null },
            fileData: { type: String, default: "" },
            entryFiles: [
              {
                entryIndex: { type: Number, required: true, min: 1 },
                fileName: { type: String, default: "" },
                fileMimeType: { type: String, default: "" },
                fileSize: { type: Number, default: null },
                fileData: { type: String, default: "" },
              },
            ],
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
        yearsOfChecking: { type: String, default: "default" },
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
        serviceEntryIndex: { type: Number, default: 1, min: 1 },
        serviceEntryCount: { type: Number, default: 1, min: 1 },
        serviceInstanceKey: { type: String, default: "", trim: true },
        status: {
          type: String,
          enum: ["pending", "in-progress", "verified", "unverified"],
          default: "pending",
        },
        verificationMode: { type: String, default: "" },
        comment: { type: String, default: "" },
        attempts: [
          {
            status: {
              type: String,
              enum: ["in-progress", "verified", "unverified"],
              required: true,
            },
            verificationMode: { type: String, default: "" },
            comment: { type: String, default: "" },
            verifierNote: { type: String, default: "" },
            respondentName: { type: String, default: "" },
            respondentEmail: { type: String, default: "" },
            respondentComment: { type: String, default: "" },
            extraPaymentDone: { type: Boolean, default: false },
            extraPaymentAmount: { type: Number, default: null, min: 0 },
            extraPaymentApprovalRequested: { type: Boolean, default: false },
            extraPaymentApprovalStatus: {
              type: String,
              enum: ["not-requested", "pending", "approved", "rejected"],
              default: "not-requested",
            },
            extraPaymentApprovalRequestedAt: { type: Date, default: null },
            extraPaymentApprovalRequestedBy: {
              type: Schema.Types.ObjectId,
              ref: "User",
              default: null,
            },
            extraPaymentApprovalRespondedAt: { type: Date, default: null },
            extraPaymentApprovalRespondedBy: {
              type: Schema.Types.ObjectId,
              ref: "User",
              default: null,
            },
            extraPaymentApprovalRejectionNote: { type: String, default: "" },
            screenshotFileName: { type: String, default: "" },
            screenshotMimeType: { type: String, default: "" },
            screenshotFileSize: { type: Number, default: null },
            screenshotData: { type: String, default: "" },
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
      customerSharedAt: { type: Date, default: null },
    },
    reportData: {
      type: Schema.Types.Mixed,
      default: null,
    },
    reverificationAppeal: {
      type: {
        status: {
          type: String,
          enum: ["open", "resolved"],
          required: true,
        },
        submittedAt: {
          type: Date,
          required: true,
        },
        submittedBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        submittedByName: {
          type: String,
          default: "",
        },
        services: [
          {
            serviceId: {
              type: Schema.Types.ObjectId,
              ref: "Service",
              required: true,
            },
            serviceName: {
              type: String,
              required: true,
            },
          },
        ],
        serviceId: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          required: true,
        },
        serviceName: {
          type: String,
          required: true,
        },
        comment: {
          type: String,
          default: "",
        },
        attachmentFileName: {
          type: String,
          default: "",
        },
        attachmentMimeType: {
          type: String,
          default: "",
        },
        attachmentFileSize: {
          type: Number,
          default: null,
        },
        attachmentData: {
          type: String,
          default: "",
        },
        resolvedAt: {
          type: Date,
          default: null,
        },
        resolvedBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        resolvedByName: {
          type: String,
          default: "",
        },
      },
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
    !models.VerificationRequest.schema.path("customerRejectedFields.fieldKey") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.serviceEntryCount") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.fileData") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.entryFiles") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.fieldKey") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.notApplicable") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.notApplicableText") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.required") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.repeatable") ||
    !models.VerificationRequest.schema.path("enterpriseApprovedAt") ||
    !models.VerificationRequest.schema.path("enterpriseDecisionLockedAt") ||
    !models.VerificationRequest.schema.path("verificationCountry") ||
    !models.VerificationRequest.schema.path("serviceVerifications") ||
    !models.VerificationRequest.schema.path("serviceVerifications.serviceEntryIndex") ||
    !models.VerificationRequest.schema.path("serviceVerifications.serviceEntryCount") ||
    !models.VerificationRequest.schema.path("serviceVerifications.serviceInstanceKey") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.screenshotData") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.verifierNote") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.respondentName") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.respondentEmail") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.respondentComment") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.extraPaymentDone") ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.extraPaymentAmount") ||
    !models.VerificationRequest.schema.path(
      "serviceVerifications.attempts.extraPaymentApprovalStatus",
    ) ||
    !models.VerificationRequest.schema.path("serviceVerifications.attempts.attemptedAt") ||
    !models.VerificationRequest.schema.path("reportMetadata") ||
    !models.VerificationRequest.schema.path("reportMetadata.customerSharedAt") ||
    !models.VerificationRequest.schema.path("reportData") ||
    !models.VerificationRequest.schema.path("reverificationAppeal") ||
    !models.VerificationRequest.schema.path("reverificationAppeal.status") ||
    !models.VerificationRequest.schema.path("reverificationAppeal.services") ||
    !models.VerificationRequest.schema.path("invoiceSnapshot"))
) {
  delete models.VerificationRequest;
}

const VerificationRequest =
  (models.VerificationRequest as Model<VerificationRequestDocument>) ||
  model("VerificationRequest", VerificationRequestSchema);

export default VerificationRequest;
