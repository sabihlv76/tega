import type { Types } from "mongoose";
import { errorFields, logger } from "../lib/logger";
import { AuditLogModel } from "../models";

export interface Actor {
  id: Types.ObjectId | string;
  role: string;
  ip?: string | null;
}

type ActorRole = "passenger" | "operator" | "station" | "admin" | "system";

/** Records a staff action. Failures are logged, never thrown. */
export async function audit(
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: Types.ObjectId | string | null,
  summary: string | null,
  extra: { data?: unknown; operatorId?: Types.ObjectId | string | null } = {},
): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: actor?.id ?? null,
      actorRole: (actor?.role ?? "system") as ActorRole,
      action,
      entityType,
      entityId: entityId ? entityId.toString() : null,
      summary,
      data: extra.data ?? null,
      ip: actor?.ip ?? null,
      operatorId: extra.operatorId ?? null,
    });
  } catch (err) {
    logger.error("Audit log write failed", { action, ...errorFields(err) });
  }
}
