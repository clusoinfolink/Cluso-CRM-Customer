export type PortalRole = "customer" | "delegate" | "delegate_user";

export type ServiceOption = {
  serviceId: string;
  serviceName: string;
  price: number;
  currency: "INR" | "USD";
};

export type PortalUser = {
  id: string;
  name: string;
  email: string;
  role: PortalRole;
  companyId: string;
  availableServices: ServiceOption[];
};

export type MeResponse = {
  user: PortalUser;
};

export type RequestStatus = "pending" | "approved" | "rejected";

export type CandidateAnswer = {
  question: string;
  fieldType: "text" | "long_text" | "number" | "file";
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
  fieldType: "text" | "long_text" | "number" | "file";
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
