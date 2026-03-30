import { InferSchemaType, Model, Schema, models, model } from "mongoose";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

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
const hasAccessRoleHistoryPath = Boolean(models.User?.schema.path("accessRoleHistory"));

if (
  models.User &&
  (!models.User.schema.path("selectedServices") ||
    !hasDelegateUserRole ||
    !hasCandidateRole ||
    !hasCreatedByDelegatePath ||
    !hasSessionVersionPath ||
    !hasAccessRoleHistoryPath)
) {
  delete models.User;
}

const User = (models.User as Model<UserDocument>) || model("User", UserSchema);

export default User;
