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
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionNote: { type: String, default: "" },
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

const VerificationRequest =
  (models.VerificationRequest as Model<VerificationRequestDocument>) ||
  model("VerificationRequest", VerificationRequestSchema);

export default VerificationRequest;
