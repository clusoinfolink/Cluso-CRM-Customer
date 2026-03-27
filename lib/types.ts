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

export type RequestItem = {
  _id: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  createdByName?: string;
  createdByRole?: string;
  delegateName?: string;
  status: RequestStatus;
  rejectionNote: string;
  createdAt: string;
  selectedServices?: ServiceOption[];
};
