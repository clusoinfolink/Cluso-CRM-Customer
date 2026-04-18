import type { SupportedCurrency } from "@/lib/currencies";

export type AdminRole = "admin" | "superadmin" | "manager" | "verifier";
export type PortalRole = "customer" | "delegate" | "delegate_user";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
};

export type PortalAvailableService = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: SupportedCurrency;
  countryRates?: CountrySpecificRate[];
  isPackage: boolean;
  includedServiceIds?: string[];
  includedServiceNames?: string[];
};

export type CountrySpecificRate = {
  country: string;
  price: number;
  currency: SupportedCurrency;
};

export type PortalUser = {
  id: string;
  name: string;
  email: string;
  role: PortalRole;
  companyId?: string | null;
  companyAccessStatus?: "active" | "inactive";
  availableServices: PortalAvailableService[];
};

export type MeResponse = {
  user: PortalUser;
};

export type RequestStatus = "pending" | "approved" | "rejected" | "verified";

export type ServiceVerificationStatus = "pending" | "verified" | "unverified";

export type ServiceVerificationAttempt = {
  status: Exclude<ServiceVerificationStatus, "pending">;
  verificationMode: string;
  comment: string;
  verifierNote?: string;
  attemptedAt: string;
  verifierId?: string | null;
  verifierName?: string;
  managerId?: string | null;
  managerName?: string;
  screenshotFileName?: string;
  screenshotMimeType?: string;
  screenshotFileSize?: number | null;
  screenshotData?: string;
};

export type ServiceVerification = {
  serviceId: string;
  serviceName: string;
  serviceEntryIndex?: number;
  serviceEntryCount?: number;
  serviceInstanceKey?: string;
  status: ServiceVerificationStatus;
  verificationMode: string;
  comment: string;
  attempts: ServiceVerificationAttempt[];
};

export type ReportMetadata = {
  generatedAt?: string | null;
  generatedBy?: string | null;
  generatedByName?: string;
  reportNumber?: string;
  customerSharedAt?: string | null;
};

export type InvoiceSnapshot = {
  currency: SupportedCurrency;
  subtotal: number;
  items: Array<{
    serviceId: string;
    serviceName: string;
    price: number;
  }>;
  billingEmail?: string;
  companyName?: string;
};

export type ReverificationAppeal = {
  status: "open" | "resolved";
  submittedAt: string;
  submittedBy?: string | null;
  submittedByName?: string;
  services?: Array<{
    serviceId: string;
    serviceName: string;
  }>;
  serviceId?: string;
  serviceName?: string;
  comment: string;
  attachmentFileName?: string;
  attachmentMimeType?: string;
  attachmentFileSize?: number | null;
  attachmentData?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolvedByName?: string;
};

export type RequestItem = {
  _id: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  verifierNames?: string[];
  createdByName?: string;
  verificationCountry?: string;
  createdByRole?: string;
  delegateName?: string;
  status: RequestStatus;
  rejectionNote: string;
  candidateFormStatus?: "pending" | "submitted";
  candidateSubmittedAt?: string | null;
  enterpriseApprovedAt?: string | null;
  enterpriseDecisionLockedAt?: string | null;
  enterpriseDecisionLocked?: boolean;
  enterpriseDecisionRemainingMs?: number;
  selectedServices?: CompanyServiceSelection[];
  serviceVerifications?: ServiceVerification[];
  reportMetadata?: ReportMetadata;
  reportData?: Record<string, unknown> | null;
  reverificationAppeal?: ReverificationAppeal | null;
  invoiceSnapshot?: InvoiceSnapshot | null;
  customerRejectedFields?: Array<{
    serviceId: string;
    serviceName: string;
    fieldKey?: string;
    question: string;
    fieldType:
      | "text"
      | "long_text"
      | "number"
      | "file"
      | "date"
      | "dropdown"
      | "composite";
  }>;
  candidateFormResponses?: Array<{
    serviceId: string;
    serviceName: string;
    serviceEntryCount?: number;
    answers: Array<{
      fieldKey?: string;
      question: string;
      fieldType:
        | "text"
        | "long_text"
        | "number"
        | "file"
        | "date"
        | "dropdown"
        | "composite";
      subFields?: Array<{
        fieldKey?: string;
        question: string;
        fieldType: "text" | "number" | "date" | "dropdown";
        value: string;
        required?: boolean;
        dropdownOptions?: string[];
      }>;
      required?: boolean;
      repeatable?: boolean;
      notApplicable?: boolean;
      notApplicableText?: string;
      value: string;
      fileName?: string;
      fileMimeType?: string;
      fileSize?: number | null;
      fileData?: string;
    }>;
  }>;
  createdAt: string;
  customerName: string;
  customerEmail: string;
};

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
  fieldType:
    | "text"
    | "long_text"
    | "number"
    | "file"
    | "date"
    | "dropdown"
    | "composite";
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

export type ServiceItem = {
  id: string;
  name: string;
  description: string;
  defaultPrice: number | null;
  defaultCurrency: SupportedCurrency;
  isPackage: boolean;
  allowMultipleEntries?: boolean;
  multipleEntriesLabel?: string;
  hiddenFromCustomerPortal?: boolean;
  isDefaultPersonalDetails?: boolean;
  includedServiceIds: string[];
  formFields: ServiceFormField[];
};

export type CompanyServiceSelection = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: SupportedCurrency;
  countryRates?: CountrySpecificRate[];
  yearsOfChecking?: string;
};

export type CompanyProfileAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type CompanyProfilePhone = {
  countryCode: string;
  number: string;
};

export type CompanyProfileDocument = {
  fileName: string;
  fileSize: number;
  fileType: string;
};

export type PartnerProfileAddress = CompanyProfileAddress;
export type PartnerProfilePhone = CompanyProfilePhone;
export type PartnerProfileDocument = CompanyProfileDocument;

export type CompanyPartnerProfile = {
  companyInformation: {
    companyName: string;
    gstin: string;
    cinRegistrationNumber: string;
    sacCode?: string;
    ltuCode?: string;
    address: CompanyProfileAddress;
    documents: CompanyProfileDocument[];
  };
  invoicingInformation: {
    billingSameAsCompany: boolean;
    invoiceEmail: string;
    address: CompanyProfileAddress;
    gstEnabled?: boolean;
    gstRate?: number;
    paymentMethods?: {
      upiId?: string;
      upiQrCodeImageUrl?: string;
      wireTransfer?: {
        accountHolderName?: string;
        accountNumber?: string;
        bankName?: string;
        ifscCode?: string;
        branchName?: string;
        swiftCode?: string;
        instructions?: string;
      };
    };
  };
  primaryContactInformation: {
    firstName: string;
    lastName: string;
    designation: string;
    email: string;
    officePhone: CompanyProfilePhone;
    mobilePhone: CompanyProfilePhone;
    whatsappPhone: CompanyProfilePhone;
  };
  additionalQuestions: {
    heardAboutUs: string;
    referredBy: string;
    yearlyBackgroundsExpected: string;
    promoCode: string;
    primaryIndustry: string;
  };
  updatedAt: string | null;
};

export type PartnerProfile = CompanyPartnerProfile;

export type ClusoDetailsResponse = {
  profile: CompanyPartnerProfile;
};

export type PartnerProfileResponse = ClusoDetailsResponse;

export type InvoicePartyDetails = {
  companyName: string;
  loginEmail: string;
  gstin: string;
  cinRegistrationNumber: string;
  sacCode: string;
  ltuCode: string;
  address: string;
  invoiceEmail: string;
  billingSameAsCompany: boolean;
  billingAddress: string;
};

export type InvoicePaymentDetails = {
  upi: {
    upiId: string;
    qrCodeImageUrl: string;
  };
  wireTransfer: {
    accountHolderName: string;
    accountNumber: string;
    bankName: string;
    ifscCode: string;
    branchName: string;
    swiftCode: string;
    instructions: string;
  };
};

export type InvoicePaymentMethod = "upi" | "wireTransfer" | "adminUpload";

export type InvoicePaymentStatus = "unpaid" | "submitted" | "paid";

export type InvoicePaymentRelatedFile = {
  fileData: string;
  fileName: string;
  fileMimeType: string;
  fileSize: number;
  uploadedAt: string;
};

export type InvoicePaymentProof = {
  method: InvoicePaymentMethod;
  screenshotData: string;
  screenshotFileName: string;
  screenshotMimeType: string;
  screenshotFileSize: number;
  uploadedAt: string;
  relatedFiles: InvoicePaymentRelatedFile[];
};

export type InvoiceLineItem = {
  serviceId: string;
  serviceName: string;
  usageCount: number;
  price: number;
  lineTotal: number;
  currency: SupportedCurrency;
};

export type InvoiceCurrencyTotal = {
  currency: SupportedCurrency;
  subtotal: number;
};

export type InvoiceRecord = {
  id: string;
  invoiceNumber: string;
  billingMonth: string;
  gstEnabled: boolean;
  gstRate: number;
  customerId: string;
  customerName: string;
  customerEmail: string;
  enterpriseDetails: InvoicePartyDetails;
  clusoDetails: InvoicePartyDetails;
  paymentDetails: InvoicePaymentDetails;
  paymentStatus: InvoicePaymentStatus;
  paymentProof: InvoicePaymentProof | null;
  paidAt: string;
  lineItems: InvoiceLineItem[];
  totalsByCurrency: InvoiceCurrencyTotal[];
  generatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceWorkspaceResponse = {
  invoices: InvoiceRecord[];
  clusoDefaultDetails: InvoicePartyDetails;
  clusoDefaultPaymentDetails: InvoicePaymentDetails;
};

export type CompanyItem = {
  id: string;
  name: string;
  email: string;
  companyAccessStatus: "active" | "inactive";
  selectedServices: CompanyServiceSelection[];
  partnerProfile: CompanyPartnerProfile;
  stats?: {
    totalRequests: number;
    assignedVerifiers: string[];
    lastRequestDate: string | null;
    lastRequestStatus: string | null;
  };
};
