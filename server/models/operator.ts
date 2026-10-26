import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";
import { DOCUMENT_TYPES, OPERATOR_STATUSES } from "../../shared/constants";

export const documentSchema = new Schema(
  {
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    fileId: { type: Schema.Types.ObjectId, ref: "FileObject", required: true },
    expiresAt: { type: Date, default: null },
    verified: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

const operatorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true },
    /** RURA licence number */
    registrationNumber: { type: String, required: true, trim: true, uppercase: true },
    contactPhone: { type: String, required: true },
    contactEmail: { type: String, lowercase: true, trim: true, default: null },
    headquartersId: { type: Schema.Types.ObjectId, ref: "Location", default: null },
    status: { type: String, enum: OPERATOR_STATUSES, default: "pending", required: true },
    statusReason: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    documents: { type: [documentSchema], default: [] },
    bankAccount: {
      type: new Schema(
        {
          bankName: { type: String, required: true },
          accountName: { type: String, required: true },
          accountNumber: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    parcelPricing: {
      enabled: { type: Boolean, default: true },
      perKg: { type: Number, default: 1000, min: 0 },
      minimum: { type: Number, default: 1000, min: 0 },
    },
    cancellationHours: { type: Number, default: 2, min: 0, max: 72 },
    /** Overrides the platform commission rate when set (0..1). */
    commissionRate: { type: Number, default: null, min: 0, max: 1 },
  },
  { timestamps: true, collection: "operators" },
);
operatorSchema.index({ slug: 1 }, { unique: true });
operatorSchema.index({ registrationNumber: 1 }, { unique: true });
operatorSchema.index({ status: 1, createdAt: -1 });

export type Operator = InferSchemaType<typeof operatorSchema>;
export type OperatorDoc = HydratedDocument<Operator>;
export const OperatorModel = model("Operator", operatorSchema);
