import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCustomerAuthFromRequest } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import User from "@/lib/models/User";

const MANAGEABLE_ROLES = ["delegate", "delegate_user"] as const;

const createSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  roleToCreate: z.enum(["delegate", "delegate_user"]).optional(),
  parentDelegateId: z.string().optional(),
});

const updateRoleSchema = z.object({
  userId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, "Invalid user id."),
  action: z.enum(["switch_role", "deactivate"]).default("switch_role"),
  targetRole: z.enum(MANAGEABLE_ROLES).optional(),
  reason: z.string().trim().min(5).max(280),
});

function resolveCompanyId(auth: {
  userId: string;
  role: "customer" | "delegate" | "delegate_user";
  parentCustomerId: string | null;
}) {
  return auth.role === "customer" ? auth.userId : auth.parentCustomerId;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getCustomerAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (auth.role !== "customer" && auth.role !== "delegate") {
      return NextResponse.json(
        { error: "You do not have access to team member data." },
        { status: 403 },
      );
    }

    const companyId = resolveCompanyId(auth);
    if (!companyId) {
      return NextResponse.json({ error: "Invalid account mapping." }, { status: 400 });
    }

    await connectMongo();

    const members = await User.find({
      parentCustomer: companyId,
      role: { $in: MANAGEABLE_ROLES },
    })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({
      members: members.map((member) => ({
        id: String(member._id),
        name: member.name,
        email: member.email,
        role: member.role,
        isActive: member.isActive !== false,
        createdAt: member.createdAt
          ? new Date(member.createdAt).toISOString()
          : null,
        createdByDelegate: member.createdByDelegate
          ? String(member.createdByDelegate)
          : null,
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load team members due to a server error." },
      { status: 500 },
    );
  }
}

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
    const parsed = createSchema.safeParse(body);
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

    let roleToCreate = auth.role === "customer" ? "delegate" : "delegate_user";
    let createdByDelegate = auth.role === "delegate" ? auth.userId : null;

    if (auth.role === "customer" && parsed.data.roleToCreate === "delegate_user") {
      if (!parsed.data.parentDelegateId) {
        return NextResponse.json({ error: "Missing parent delegate for this user." }, { status: 400 });
      }
      roleToCreate = "delegate_user";
      createdByDelegate = parsed.data.parentDelegateId;
      
      // Verify that the requested parentDelegateId actually belongs to this customer
      const parentDel = await User.findOne({ 
        _id: parsed.data.parentDelegateId, 
        parentCustomer: companyId, 
        role: "delegate" 
      }).lean();
      
      if (!parentDel) {
         return NextResponse.json({ error: "Invalid parent delegate specified." }, { status: 400 });
      }
    }

    await User.create({
      name: parsed.data.name,
      email,
      passwordHash,
      role: roleToCreate,
      parentCustomer: companyId,
      createdByDelegate,
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

export async function PATCH(req: NextRequest) {
  try {
    const auth = await getCustomerAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (auth.role !== "customer") {
      return NextResponse.json(
        { error: "Only enterprise account can edit team access." },
        { status: 403 },
      );
    }

    const body = await req.json();
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }

    await connectMongo();

    const targetUser = await User.findOne({
      _id: parsed.data.userId,
      parentCustomer: auth.userId,
      role: { $in: MANAGEABLE_ROLES },
    }).lean();

    if (!targetUser) {
      return NextResponse.json({ error: "Team member not found." }, { status: 404 });
    }

    const action = parsed.data.action;

    if (action === "deactivate") {
      if (targetUser.isActive === false) {
        return NextResponse.json(
          { error: "Selected account is already deactivated." },
          { status: 409 },
        );
      }

      await User.findByIdAndUpdate(parsed.data.userId, {
        $set: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: auth.userId,
          deactivationReason: parsed.data.reason.trim(),
        },
        $inc: {
          sessionVersion: 1,
        },
      });

      return NextResponse.json({
        message: "Account deactivated successfully. The user must contact admin to regain access.",
      });
    }

    if (!parsed.data.targetRole) {
      return NextResponse.json(
        { error: "Please select a target role for role switch." },
        { status: 400 },
      );
    }

    if (targetUser.role === parsed.data.targetRole && targetUser.isActive !== false) {
      return NextResponse.json(
        { error: "Selected role is already assigned to this account." },
        { status: 409 },
      );
    }

    const wasInactive = targetUser.isActive === false;

    await User.findByIdAndUpdate(parsed.data.userId, {
      $set: {
        role: parsed.data.targetRole,
        isActive: true,
        deactivatedAt: null,
        deactivatedBy: null,
        deactivationReason: "",
      },
      $inc: {
        sessionVersion: 1,
      },
      $push: {
        accessRoleHistory: {
          fromRole: targetUser.role,
          toRole: parsed.data.targetRole,
          changedBy: auth.userId,
          changedAt: new Date(),
          reason: parsed.data.reason.trim(),
        },
      },
    });

    return NextResponse.json({
      message: wasInactive
        ? "Account reactivated and access updated. The user must log in again."
        : parsed.data.targetRole === "delegate"
          ? "User upgraded to delegate. The account must log in again."
          : "Delegate downgraded to user. The account must log in again.",
    });
  } catch {
    return NextResponse.json(
      { error: "Could not update team access due to a server error." },
      { status: 500 },
    );
  }
}
