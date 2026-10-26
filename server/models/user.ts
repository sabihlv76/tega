import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";
import { LOCALES, ROLES, USER_STATUSES } from "../../shared/constants";

const userSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 120, default: null },
    /** E.164, e.g. +250788123456 */
    phone: { type: String, default: null },
    email: { type: String, lowercase: true, trim: true, default: null },
    googleId: { type: String, default: null },
    role: { type: String, enum: ROLES, default: "passenger", required: true },
    status: { type: String, enum: USER_STATUSES, default: "active", required: true },
    language: { type: String, enum: LOCALES, default: "en", required: true },
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", default: null },
    stationId: { type: Schema.Types.ObjectId, ref: "Location", default: null },
    isOperatorOwner: { type: Boolean, default: false },
    notificationPrefs: {
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "users" },
);

// Partial unique indexes: many users have no email (phone-only / USSD) or no phone (Google).
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } } });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ operatorId: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model("User", userSchema);

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true },
    /** All refresh tokens issued from one sign-in share a family; reuse of a rotated token revokes the family. */
    familyId: { type: String, required: true },
    client: { type: String, enum: ["web", "mobile"], default: "web" },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true, collection: "user_sessions" },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ familyId: 1 });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model("Session", sessionSchema);

const otpSchema = new Schema(
  {
    channel: { type: String, enum: ["sms", "email"], required: true },
    target: { type: String, required: true },
    codeHash: { type: String, required: true },
    purpose: { type: String, default: "login" },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "verification_codes" },
);
otpSchema.index({ target: 1, createdAt: -1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const OtpModel = model("OtpCode", otpSchema);
