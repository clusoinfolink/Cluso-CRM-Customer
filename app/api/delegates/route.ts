import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await getCustomerAuthFromRequest(req);
    if (!auth || (auth.role !== "customer" && auth.role !== "delegate")) {
      return NextResponse.json(
        { error: "Only company account or delegate can create users." },
        { status: 403 },
      );
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }

    await connectMongo();

    const email = parsed.data.email.toLowerCase();
    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return NextResponse.json({ error: "Email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const companyId = auth.role === "customer" ? auth.userId : auth.parentCustomerId;
    if (!companyId) {
      return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
    }

    const roleToCreate = auth.role === "customer" ? "delegate" : "delegate_user";

    await User.create({
      name: parsed.data.name,
      email,
      passwordHash,
      role: roleToCreate,
      parentCustomer: companyId,
      createdByDelegate: auth.role === "delegate" ? auth.userId : null,
    });

    return NextResponse.json(
      {
        message:
          roleToCreate === "delegate"
            ? "Delegate created successfully."
            : "User created successfully.",
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not create user due to a server error." },
      { status: 500 },
    );
  }
}
