import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const TOKEN_NAME = "cluso_customer_token";

type AuthPayload = {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
};

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

    return jwt.verify(token, secret) as AuthPayload;
  } catch {
    return null;
  }
}

export async function getCustomerAuthFromRequest(req: NextRequest) {
  const token = req.cookies.get(TOKEN_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifyCustomerToken(token);
}

export async function getCustomerAuthFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifyCustomerToken(token);
}

export function customerCookieName() {
  return TOKEN_NAME;
}
