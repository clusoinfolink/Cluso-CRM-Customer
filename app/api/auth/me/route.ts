import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { customerCookieName, verifyCustomerToken } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(customerCookieName())?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = verifyCustomerToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectMongo();

  const user = await User.findById(payload.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = payload.role === "customer" ? payload.userId : payload.parentCustomerId;
  const companyUser = companyId ? await User.findById(companyId).lean() : null;
  const availableServices = (companyUser?.selectedServices ?? []).map((item) => ({
    serviceId: String(item.serviceId),
    serviceName: item.serviceName,
    price: item.price,
    currency: item.currency,
  }));

  return NextResponse.json({
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      companyId,
      availableServices,
    },
  });
}
