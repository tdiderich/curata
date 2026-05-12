import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

interface AuditEntry {
  orgId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actorType?: string;
  actorId: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        orgId: entry.orgId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        actorType: entry.actorType ?? "user",
        actorId: entry.actorId,
        metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
  }
}
