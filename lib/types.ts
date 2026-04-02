import type { SupportedCurrency } from "@/lib/currencies";

export type PortalRole = "customer" | "delegate" | "delegate_user";

export type ServiceOption = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: SupportedCurrency;
  isPackage?: boolean;
  includedServiceIds?: string[];
};

export type PortalUser = {
  id: string;
  name: string;
  email: string;
  role: PortalRole;
  companyId: string;
  availableServices: ServiceOption[];
};

export type PartnerProfileAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type PartnerProfilePhone = {
  countryCode: string;
  number: string;
};

export type PartnerProfileDocument = {
  fileName: string;
  fileSize: number;
  fileType: string;
};

export type PartnerProfile = {
  companyInformation: {
    companyName: string;
    gstin: string;
    cinRegistrationNumber: string;
    address: PartnerProfileAddress;
    documents: PartnerProfileDocument[];
  };
  invoicingInformation: {
    billingSameAsCompany: boolean;
    invoiceEmail: string;
    address: PartnerProfileAddress;
  };
  primaryContactInformation: {
    firstName: string;
    lastName: string;
    designation: string;
    email: string;
    officePhone: PartnerProfilePhone;
    mobilePhone: PartnerProfilePhone;
    whatsappPhone: PartnerProfilePhone;
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

export type MeResponse = {
  user: PortalUser;
};

export type PartnerProfileResponse = {
  profile: PartnerProfile;
};

export type RequestStatus = "pending" | "approved" | "rejected" | "verified";

export type CandidateAnswer = {
  question: string;
  fieldType: "text" | "long_text" | "number" | "file" | "date";
  required?: boolean;
  value: string;
  fileName?: string;
  fileMimeType?: string;
  fileSize?: number | null;
  fileData?: string;
};

export type CandidateServiceResponse = {
  serviceId: string;
  serviceName: string;
  answers: CandidateAnswer[];
};

export type RejectedCandidateField = {
  serviceId: string;
  serviceName: string;
  question: string;
  fieldType: "text" | "long_text" | "number" | "file" | "date";
};

export type RequestItem = {
  _id: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  createdByName?: string;
  createdByRole?: string;
  delegateName?: string;
  status: RequestStatus;
  candidateFormStatus?: "pending" | "submitted";
  candidateSubmittedAt?: string | null;
  rejectionNote: string;
  createdAt: string;
  selectedServices?: ServiceOption[];
  candidateFormResponses?: CandidateServiceResponse[];
  customerRejectedFields?: RejectedCandidateField[];
};
