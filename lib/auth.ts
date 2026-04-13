import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";

const TOKEN_NAME = "cluso_customer_token";

type PortalRole = "customer" | "delegate" | "delegate_user";

type AuthPayload = {
  userId: string;
  role: PortalRole;
  parentCustomerId: string | null;
  sessionVersion: number;
};

type CompanyAccessStatus = "active" | "inactive";

type CustomerAuth = AuthPayload & {
  companyAccessStatus: CompanyAccessStatus;
};

type RawAuthPayload = {
  userId?: unknown;
  role?: unknown;
  parentCustomerId?: unknown;
  sessionVersion?: unknown;
};

function isPortalRole(role: unknown): role is PortalRole {
  return role === "customer" || role === "delegate" || role === "delegate_user";
}

function parseSessionVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeAuthPayload(value: unknown): AuthPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as RawAuthPayload;
  if (typeof payload.userId !== "string" || !isPortalRole(payload.role)) {
    return null;
  }

  return {
    userId: payload.userId,
    role: payload.role,
    parentCustomerId:
      typeof payload.parentCustomerId === "string" ? payload.parentCustomerId : null,
    sessionVersion: parseSessionVersion(payload.sessionVersion),
  };
}

async function hydrateCustomerAuthFromToken(token?: string): Promise<CustomerAuth | null> {
  if (!token) {
    return null;
  }

  const payload = verifyCustomerToken(token);
  if (!payload) {
    return null;
  }

  await connectMongo();

  const user = await User.findById(payload.userId)
    .select("_id role parentCustomer sessionVersion isActive companyAccessStatus")
    .lean();
  if (!user || !isPortalRole(user.role)) {
    return null;
  }

  if (user.isActive === false) {
    return null;
  }

  const currentSessionVersion = parseSessionVersion(user.sessionVersion);
  if (currentSessionVersion !== payload.sessionVersion) {
    return null;
  }

  const companyId =
    user.role === "customer"
      ? String(user._id)
      : user.parentCustomer
        ? String(user.parentCustomer)
        : null;
  if (!companyId) {
    return null;
  }

  let companyAccessStatus: CompanyAccessStatus = "active";
  if (user.role === "customer") {
    companyAccessStatus = user.companyAccessStatus === "inactive" ? "inactive" : "active";
  } else {
    const company = await User.findById(companyId)
      .select("_id isActive companyAccessStatus")
      .lean();

    if (!company || company.isActive === false) {
      return null;
    }

    companyAccessStatus = company.companyAccessStatus === "inactive" ? "inactive" : "active";
  }

  return {
    userId: String(user._id),
    role: user.role,
    parentCustomerId: user.parentCustomer ? String(user.parentCustomer) : null,
    sessionVersion: currentSessionVersion,
    companyAccessStatus,
  };
}

export function signCustomerToken(payload: AuthPayload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET in environment variables.");
  }

  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function verifyCustomerToken(token: string): AuthPayload | null {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return null;
    }

    const decoded = jwt.verify(token, secret);
    return normalizeAuthPayload(decoded);
  } catch {
    return null;
  }
}

export async function getCustomerAuthFromRequest(req: NextRequest) {
  const token = req.cookies.get(TOKEN_NAME)?.value;
  return hydrateCustomerAuthFromToken(token);
}

export async function getCustomerAuthFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_NAME)?.value;
  return hydrateCustomerAuthFromToken(token);
}

export function customerCookieName() {
  return TOKEN_NAME;
}
