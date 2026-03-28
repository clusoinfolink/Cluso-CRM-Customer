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

if (
  models.User &&
  (!models.User.schema.path("selectedServices") ||
    !hasDelegateUserRole ||
    !hasCandidateRole ||
    !hasCreatedByDelegatePath)
) {
  delete models.User;
}

const User = (models.User as Model<UserDocument>) || model("User", UserSchema);

export default User;
