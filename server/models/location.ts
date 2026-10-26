import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";

const locationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true },
    /** Upper-case search terms, e.g. KIGALI, NYABUGOGO. */
    aliases: { type: [String], default: [] },
    /** Major bus park with a FIKA station desk. Other locations are roadside stops / towns. */
    isStation: { type: Boolean, default: false },
    district: { type: String, default: null },
    province: { type: String, default: null },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "locations" },
);
locationSchema.index({ slug: 1 }, { unique: true });
locationSchema.index({ isStation: -1, name: 1 });
locationSchema.index({ aliases: 1 });

export type Location = InferSchemaType<typeof locationSchema>;
export type LocationDoc = HydratedDocument<Location>;
export const LocationModel = model("Location", locationSchema);

const fareCapSchema = new Schema(
  {
    originId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    destinationId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    /** Some corridors have different caps depending on the road taken (e.g. Kamembe via Huye vs via Karongi). */
    viaId: { type: Schema.Types.ObjectId, ref: "Location", default: null },
    capRwf: { type: Number, required: true, min: 0 },
    distanceKm: { type: Number, default: null },
    effectiveFrom: { type: Date, default: () => new Date() },
    source: { type: String, enum: ["rura_registry", "manual", "import"], default: "manual" },
    corridor: { type: String, default: null },
  },
  { timestamps: true, collection: "location_fares" },
);
fareCapSchema.index({ originId: 1, destinationId: 1, viaId: 1 }, { unique: true });
fareCapSchema.index({ destinationId: 1, originId: 1 });

export type FareCap = InferSchemaType<typeof fareCapSchema>;
export type FareCapDoc = HydratedDocument<FareCap>;
export const FareCapModel = model("FareCap", fareCapSchema);
