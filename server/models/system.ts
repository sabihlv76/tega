import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";
import { DOCUMENT_TYPES, ROLES } from "../../shared/constants";

// ── In-app notifications ─────────────────────────────────────────────────────

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "notifications" },
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

export const NotificationModel = model("Notification", notificationSchema);

// ── Outgoing SMS / email log ─────────────────────────────────────────────────

const messageLogSchema = new Schema(
  {
    channel: { type: String, enum: ["sms", "email"], required: true },
    to: { type: String, required: true },
    subject: { type: String, default: null },
    body: { type: String, required: true },
    provider: { type: String, required: true },
    status: { type: String, enum: ["sent", "failed"], required: true },
    providerRef: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true, collection: "message_logs" },
);
messageLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const MessageLogModel = model("MessageLog", messageLogSchema);

// ── Audit trail for staff actions ────────────────────────────────────────────

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, enum: [...ROLES, "system"], default: "system" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    summary: { type: String, default: null },
    data: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", default: null },
  },
  { timestamps: true, collection: "audit_logs" },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ operatorId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

export const AuditLogModel = model("AuditLog", auditLogSchema);

// ── Platform settings (key/value) ────────────────────────────────────────────

const settingSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "app_settings" },
);
settingSchema.index({ key: 1 }, { unique: true });

export const SettingModel = model("Setting", settingSchema);

// ── Background jobs (MongoDB-backed queue) ───────────────────────────────────

const jobSchema = new Schema(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued", required: true },
    runAt: { type: Date, default: () => new Date() },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastError: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    finishedAt: { type: Date, default: null },
    /** Prevents enqueueing the same job twice (e.g. one recurring tick per minute). */
    uniqueKey: { type: String, default: null },
  },
  { timestamps: true, collection: "jobs" },
);
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ uniqueKey: 1 }, { unique: true, partialFilterExpression: { uniqueKey: { $type: "string" } } });
jobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export type Job = InferSchemaType<typeof jobSchema>;
export type JobDoc = HydratedDocument<Job>;
export const JobModel = model("Job", jobSchema);

// ── Uploaded files (documents, logos) ────────────────────────────────────────

const fileSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", default: null },
    purpose: { type: String, enum: [...DOCUMENT_TYPES, "logo"], default: "other" },
    driver: { type: String, enum: ["local", "s3"], required: true },
    key: { type: String, required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true, collection: "files" },
);
fileSchema.index({ operatorId: 1 });

export type FileObject = InferSchemaType<typeof fileSchema>;
export const FileModel = model("FileObject", fileSchema);

// ── Applied migrations ───────────────────────────────────────────────────────

const migrationSchema = new Schema(
  { name: { type: String, required: true }, appliedAt: { type: Date, default: () => new Date() } },
  { collection: "migrations" },
);
migrationSchema.index({ name: 1 }, { unique: true });

export const MigrationModel = model("Migration", migrationSchema);
