import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { signCustomerToken, customerCookieName } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  await connectMongo();

  const user = await User.findOne({ email: parsed.data.email.toLowerCase() }).lean();
  if (
    !user ||
    (user.role !== "customer" && user.role !== "delegate" && user.role !== "delegate_user")
  ) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = signCustomerToken({
    userId: String(user._id),
    role: user.role,
    parentCustomerId: user.parentCustomer ? String(user.parentCustomer) : null,
  });

  const res = NextResponse.json({ message: "Logged in" });
  res.cookies.set(customerCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
