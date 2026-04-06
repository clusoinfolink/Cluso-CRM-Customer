import { NextResponse } from "next/server";
import { getCustomerAuthFromCookies } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import Service from "@/lib/models/Service";
import User from "@/lib/models/User";

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

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
          .select("isPackage includedServiceIds hiddenFromCustomerPortal isDefaultPersonalDetails")
          .lean()
      : [];

  const serviceMetaById = new Map(
    serviceDocs.map((service) => [
      String(service._id),
      {
        isPackage: Boolean(service.isPackage),
        hiddenFromCustomerPortal: Boolean(
          service.hiddenFromCustomerPortal || service.isDefaultPersonalDetails,
        ),
        includedServiceRefs: (service.includedServiceIds ?? [])
          .map((id) => String(id).trim())
          .filter((id) => id.length > 0),
        includedServiceIds: (service.includedServiceIds ?? [])
          .map((id) => String(id).trim())
          .filter((id) => OBJECT_ID_PATTERN.test(id)),
      },
    ]),
  );

  const includedServiceIds = [
    ...new Set(Array.from(serviceMetaById.values()).flatMap((serviceMeta) => serviceMeta.includedServiceIds)),
  ];

  const includedServiceDocs =
    includedServiceIds.length > 0
      ? await Service.find({ _id: { $in: includedServiceIds } })
          .select("name hiddenFromCustomerPortal isDefaultPersonalDetails")
          .lean()
      : [];

  const hiddenIncludedServiceIds = new Set(
    includedServiceDocs
      .filter((service) => Boolean(service.hiddenFromCustomerPortal || service.isDefaultPersonalDetails))
      .map((service) => String(service._id)),
  );

  const includedServiceNameById = new Map(
    includedServiceDocs
      .filter((service) => !hiddenIncludedServiceIds.has(String(service._id)))
      .map((service) => [String(service._id), service.name || "Service"]),
  );

  const availableServices = selectedServices
    .filter((item) => !serviceMetaById.get(item.serviceId)?.hiddenFromCustomerPortal)
    .map((item) => {
    const serviceMeta = serviceMetaById.get(item.serviceId);
    const includedServiceNames = [
      ...new Set(
        (serviceMeta?.includedServiceRefs ?? [])
          .map((reference) => {
            if (hiddenIncludedServiceIds.has(reference)) {
              return null;
            }

            const nameFromLookup = includedServiceNameById.get(reference);
            if (nameFromLookup) {
              return nameFromLookup;
            }

            if (OBJECT_ID_PATTERN.test(reference)) {
              return null;
            }

            return reference;
          })
          .filter((name): name is string => Boolean(name && name.trim().length > 0))
          .map((name) => name.trim()),
      ),
    ];

    return {
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      price: item.price,
      currency: item.currency,
      isPackage: Boolean(serviceMeta?.isPackage),
      includedServiceIds: (serviceMeta?.includedServiceIds ?? []).filter(
        (serviceId) => !hiddenIncludedServiceIds.has(serviceId),
      ),
      includedServiceNames,
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
