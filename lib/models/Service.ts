import mongoose, { Document, Model, Schema } from "mongoose";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currencies";

export interface IService extends Document {
  name: string;
  description: string;
  defaultPrice?: number;
  defaultCurrency: SupportedCurrency;
  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema = new Schema<IService>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    defaultPrice: { type: Number },
    defaultCurrency: { type: String, enum: SUPPORTED_CURRENCIES, default: "INR" },
  },
  { timestamps: true },
);

const Service: Model<IService> =
  mongoose.models.Service || mongoose.model<IService>("Service", serviceSchema);

export default Service;