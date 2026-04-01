import { NextResponse } from "next/server";
import { getCustomerAuthFromCookies } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import Service from "@/lib/models/Service";
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
  const selectedServices = (companyUser?.selectedServices ?? []).map((item) => ({
    serviceId: String(item.serviceId),
    serviceName: item.serviceName,
    price: item.price,
    currency: item.currency,
  }));

  const selectedServiceIds = [...new Set(selectedServices.map((item) => item.serviceId))];
  const serviceDocs =
    selectedServiceIds.length > 0
      ? await Service.find({ _id: { $in: selectedServiceIds } })
          .select("isPackage includedServiceIds")
          .lean()
      : [];

  const serviceMetaById = new Map(
    serviceDocs.map((service) => [
      String(service._id),
      {
        isPackage: Boolean(service.isPackage),
        includedServiceIds: (service.includedServiceIds ?? []).map((id) => String(id)),
      },
    ]),
  );

  const availableServices = selectedServices.map((item) => {
    const serviceMeta = serviceMetaById.get(item.serviceId);
    return {
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      price: item.price,
      currency: item.currency,
      isPackage: Boolean(serviceMeta?.isPackage),
      includedServiceIds: serviceMeta?.includedServiceIds ?? [],
    };
  });

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
