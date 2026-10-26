import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";
import { LOCALES, PARCEL_SIZES, PARCEL_STATUSES, PAYMENT_METHODS, PAYMENT_STATES } from "../../shared/constants";

const parcelEventSchema = new Schema(
  {
    status: { type: String, enum: PARCEL_STATUSES, required: true },
    at: { type: Date, default: () => new Date() },
    stationId: { type: Schema.Types.ObjectId, ref: "Location", default: null },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const contactSchema = new Schema(
  { name: { type: String, required: true, trim: true }, phone: { type: String, required: true } },
  { _id: false },
);

const parcelSchema = new Schema(
  {
    code: { type: String, required: true },
    /** HMAC of the receiver's pickup code (verification). */
    pickupCodeHash: { type: String, default: null },
    /** AES-GCM encrypted pickup code so the sender can read it back in the app. */
    pickupCodeEnc: { type: String, default: null },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: contactSchema, required: true },
    receiver: { type: contactSchema, required: true },
    originId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    destinationId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    description: { type: String, required: true, trim: true, maxlength: 200 },
    weightKg: { type: Number, required: true, min: 0.1, max: 100 },
    size: { type: String, enum: PARCEL_SIZES, required: true },
    priceRwf: { type: Number, required: true, min: 0 },
    status: { type: String, enum: PARCEL_STATUSES, default: "pending_payment", required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATES, default: "unpaid", required: true },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
    tripId: { type: Schema.Types.ObjectId, ref: "Trip", default: null },
    holdExpiresAt: { type: Date, default: null },
    locale: { type: String, enum: LOCALES, default: "en" },
    events: { type: [parcelEventSchema], default: [] },
  },
  { timestamps: true, collection: "parcels" },
);
parcelSchema.index({ code: 1 }, { unique: true });
parcelSchema.index({ senderId: 1, createdAt: -1 });
parcelSchema.index({ operatorId: 1, status: 1, createdAt: -1 });
parcelSchema.index({ originId: 1, status: 1 });
parcelSchema.index({ destinationId: 1, status: 1 });
parcelSchema.index({ tripId: 1 });
parcelSchema.index({ status: 1, holdExpiresAt: 1 });

export type Parcel = InferSchemaType<typeof parcelSchema>;
export type ParcelDoc = HydratedDocument<Parcel>;
export const ParcelModel = model("Parcel", parcelSchema);
