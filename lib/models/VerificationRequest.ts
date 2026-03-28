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
    candidateUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
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
    rejectionNote: { type: String, default: "" },
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
              enum: ["text", "long_text", "number", "file"],
              required: true,
            },
            required: { type: Boolean, default: false },
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
  (!models.VerificationRequest.schema.path("candidateFormStatus") ||
    !models.VerificationRequest.schema.path("candidateFormResponses") ||
    !models.VerificationRequest.schema.path("candidateUser") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.fileData") ||
    !models.VerificationRequest.schema.path("candidateFormResponses.answers.required"))
) {
  delete models.VerificationRequest;
}

const VerificationRequest =
  (models.VerificationRequest as Model<VerificationRequestDocument>) ||
  model("VerificationRequest", VerificationRequestSchema);

export default VerificationRequest;
