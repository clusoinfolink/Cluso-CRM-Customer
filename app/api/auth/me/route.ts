import { NextResponse } from "next/server";
import { getCustomerAuthFromCookies } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";

export async function GET() {
  const auth = await getCustomerAuthFromCookies();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectMongo();

  const user = await User.findById(auth.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = auth.role === "customer" ? auth.userId : auth.parentCustomerId;
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
