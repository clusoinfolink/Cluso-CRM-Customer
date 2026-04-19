import mongoose, { Document, Model, Schema } from "mongoose";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currencies";

export type ServiceFormFieldType =
  | "text"
  | "long_text"
  | "number"
  | "file"
  | "date"
  | "dropdown"
  | "email"
  | "mobile"
  | "composite";

export type ServiceFormSubField = {
  fieldKey?: string;
  question: string;
  fieldType: "text" | "number" | "date" | "dropdown";
  dropdownOptions?: string[];
  required: boolean;
};

export type ServiceFormField = {
  fieldKey?: string;
  question: string;
  iconKey?: string;
  fieldType: ServiceFormFieldType;
  subFields?: ServiceFormSubField[];
  dropdownOptions?: string[];
  required: boolean;
  repeatable?: boolean;
  minLength?: number | null;
  maxLength?: number | null;
  forceUppercase?: boolean;
  allowNotApplicable?: boolean;
  notApplicableText?: string;
  copyFromPersonalDetailsFieldKey?: string;
  previewWidth?: "full" | "half" | "third";
};

export type CandidateLayoutSnapshotField = {
  fieldKey?: string;
  question: string;
  iconKey?: string;
  fieldType: "text" | "long_text" | "number" | "file" | "date" | "dropdown" | "email" | "mobile";
  dropdownOptions?: string[];
  required: boolean;
  repeatable?: boolean;
  minLength?: number | null;
  maxLength?: number | null;
  forceUppercase?: boolean;
  allowNotApplicable?: boolean;
  notApplicableText?: string;
  copyFromPersonalDetailsFieldKey?: string;
  previewWidth?: "full" | "half" | "third";
};

export interface IService extends Document {
  name: string;
  description: string;
  defaultPrice?: number;
  defaultCurrency: SupportedCurrency;
  isPackage: boolean;
  allowMultipleEntries?: boolean;
  multipleEntriesLabel?: string;
  includedServiceIds: mongoose.Types.ObjectId[];
  hiddenFromCustomerPortal?: boolean;
  isDefaultPersonalDetails?: boolean;
  formFields: ServiceFormField[];
  candidateLayoutSnapshot?: CandidateLayoutSnapshotField[];
  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema = new Schema<IService>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    defaultPrice: { type: Number },
    defaultCurrency: { type: String, enum: SUPPORTED_CURRENCIES, default: "INR" },
    isPackage: { type: Boolean, default: false },
    allowMultipleEntries: { type: Boolean, default: false },
    multipleEntriesLabel: { type: String, required: false },
    includedServiceIds: [{ type: Schema.Types.ObjectId, ref: "Service" }],
    hiddenFromCustomerPortal: { type: Boolean, default: false },
    isDefaultPersonalDetails: { type: Boolean, default: false },
    formFields: [
      {
        fieldKey: { type: String, default: "" },
        question: { type: String, required: true },
        iconKey: { type: String, default: "diary" },
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
            dropdownOptions: { type: [String], default: [] },
            required: { type: Boolean, default: false },
          },
        ],
        dropdownOptions: { type: [String], default: [] },
        required: { type: Boolean, default: false },
        repeatable: { type: Boolean, default: false },
        minLength: { type: Number, default: null },
        maxLength: { type: Number, default: null },
        forceUppercase: { type: Boolean, default: false },
        allowNotApplicable: { type: Boolean, default: false },
        notApplicableText: { type: String, default: "" },
        copyFromPersonalDetailsFieldKey: { type: String, default: "" },
        previewWidth: {
          type: String,
          enum: ["full", "half", "third"],
          required: false,
        },
      },
    ],
    candidateLayoutSnapshot: [
      {
        fieldKey: { type: String, default: "" },
        question: { type: String, required: true },
        iconKey: { type: String, default: "diary" },
        fieldType: {
          type: String,
          enum: ["text", "long_text", "number", "file", "date", "dropdown", "email", "mobile"],
          required: true,
        },
        dropdownOptions: { type: [String], default: [] },
        required: { type: Boolean, default: false },
        repeatable: { type: Boolean, default: false },
        minLength: { type: Number, default: null },
        maxLength: { type: Number, default: null },
        forceUppercase: { type: Boolean, default: false },
        allowNotApplicable: { type: Boolean, default: false },
        notApplicableText: { type: String, default: "" },
        copyFromPersonalDetailsFieldKey: { type: String, default: "" },
        previewWidth: {
          type: String,
          enum: ["full", "half", "third"],
          required: false,
        },
      },
    ],
  },
  { timestamps: true },
);

const hasEnhancedServiceFields = Boolean(
  mongoose.models.Service?.schema.path("formFields.required") &&
    mongoose.models.Service?.schema.path("formFields.fieldKey") &&
    mongoose.models.Service?.schema.path("formFields.iconKey") &&
    mongoose.models.Service?.schema.path("formFields.subFields") &&
    mongoose.models.Service?.schema.path("formFields.dropdownOptions") &&
    mongoose.models.Service?.schema.path("formFields.repeatable") &&
    mongoose.models.Service?.schema.path("formFields.minLength") &&
    mongoose.models.Service?.schema.path("formFields.maxLength") &&
    mongoose.models.Service?.schema.path("formFields.forceUppercase") &&
    mongoose.models.Service?.schema.path("formFields.allowNotApplicable") &&
    mongoose.models.Service?.schema.path("formFields.notApplicableText") &&
    mongoose.models.Service?.schema.path("formFields.copyFromPersonalDetailsFieldKey") &&
    mongoose.models.Service?.schema.path("formFields.previewWidth") &&
    mongoose.models.Service?.schema.path("candidateLayoutSnapshot") &&
    mongoose.models.Service?.schema.path("candidateLayoutSnapshot.fieldType") &&
    mongoose.models.Service?.schema.path("candidateLayoutSnapshot.previewWidth"),
);
const hasPackageFields = Boolean(
  mongoose.models.Service?.schema.path("isPackage") &&
    mongoose.models.Service?.schema.path("includedServiceIds"),
);
const hasServiceEntryField = Boolean(
  mongoose.models.Service?.schema.path("allowMultipleEntries") &&
    mongoose.models.Service?.schema.path("multipleEntriesLabel"),
);
const hasVisibilityFields = Boolean(
  mongoose.models.Service?.schema.path("hiddenFromCustomerPortal") &&
    mongoose.models.Service?.schema.path("isDefaultPersonalDetails"),
);

if (
  mongoose.models.Service &&
  (!mongoose.models.Service.schema.path("formFields") ||
    !hasEnhancedServiceFields ||
    !hasPackageFields ||
    !hasServiceEntryField ||
    !hasVisibilityFields)
) {
  delete mongoose.models.Service;
}

const Service: Model<IService> =
  mongoose.models.Service || mongoose.model<IService>("Service", serviceSchema);

export default Service;
