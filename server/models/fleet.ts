import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";
import { CAP_STATUSES, ROUTE_STATUSES, TRIP_STATUSES, VEHICLE_STATUSES } from "../../shared/constants";
import { documentSchema } from "./operator";

// ── Vehicles ─────────────────────────────────────────────────────────────────

const vehicleSchema = new Schema(
  {
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    /** Normalised, e.g. RAC204B */
    plateNumber: { type: String, required: true, uppercase: true, trim: true },
    model: { type: String, trim: true, default: null },
    capacity: { type: Number, required: true, min: 1, max: 120 },
    status: { type: String, enum: VEHICLE_STATUSES, default: "active", required: true },
    documents: { type: [documentSchema], default: [] },
  },
  { timestamps: true, collection: "vehicles" },
);
vehicleSchema.index({ plateNumber: 1 }, { unique: true });
vehicleSchema.index({ operatorId: 1, status: 1 });

export type Vehicle = InferSchemaType<typeof vehicleSchema>;
export type VehicleDoc = HydratedDocument<Vehicle>;
export const VehicleModel = model("Vehicle", vehicleSchema);

// ── Routes ───────────────────────────────────────────────────────────────────

const routeSchema = new Schema(
  {
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    originId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    destinationId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    viaIds: { type: [{ type: Schema.Types.ObjectId, ref: "Location" }], default: [] },
    distanceKm: { type: Number, default: null, min: 0 },
    durationMinutes: { type: Number, required: true, min: 5, max: 24 * 60 },
    priceRwf: { type: Number, required: true, min: 0 },
    /** Snapshot of the applicable RURA cap, refreshed whenever caps or the price change. */
    capRwf: { type: Number, default: null },
    capStatus: { type: String, enum: CAP_STATUSES, default: "no_cap", required: true },
    status: { type: String, enum: ROUTE_STATUSES, default: "active", required: true },
    pausedReason: { type: String, default: null },
  },
  { timestamps: true, collection: "routes" },
);
routeSchema.index({ operatorId: 1, status: 1 });
routeSchema.index({ originId: 1, destinationId: 1 });
routeSchema.index({ capStatus: 1 });

export type Route = InferSchemaType<typeof routeSchema>;
export type RouteDoc = HydratedDocument<Route>;
export const RouteModel = model("Route", routeSchema);

// ── Recurring departures ─────────────────────────────────────────────────────

const scheduleSchema = new Schema(
  {
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    routeId: { type: Schema.Types.ObjectId, ref: "Route", required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    /** Kigali local time, "HH:mm" */
    departureTime: { type: String, required: true },
    /** 0 = Sunday … 6 = Saturday */
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "route_schedules" },
);
scheduleSchema.index({ operatorId: 1, active: 1 });
scheduleSchema.index({ routeId: 1 });

export type Schedule = InferSchemaType<typeof scheduleSchema>;
export type ScheduleDoc = HydratedDocument<Schedule>;
export const ScheduleModel = model("Schedule", scheduleSchema);

// ── Trips (one bus departure on a given day) ─────────────────────────────────

const tripSchema = new Schema(
  {
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    routeId: { type: Schema.Types.ObjectId, ref: "Route", required: true },
    scheduleId: { type: Schema.Types.ObjectId, ref: "Schedule", default: null },
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    originId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    destinationId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    viaIds: { type: [{ type: Schema.Types.ObjectId, ref: "Location" }], default: [] },
    /** Scheduled departure. Delays are tracked separately in delayMinutes. */
    departureAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true },
    priceRwf: { type: Number, required: true },
    capRwf: { type: Number, default: null },
    seatsTotal: { type: Number, required: true, min: 1 },
    /** Places held or sold. Incremented atomically when booking to prevent overbooking. */
    seatsBooked: { type: Number, default: 0, min: 0 },
    checkedInCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: TRIP_STATUSES, default: "scheduled", required: true },
    delayMinutes: { type: Number, default: 0, min: 0 },
    statusChangedAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    operatorName: { type: String, required: true },
    plateNumber: { type: String, required: true },
    vehicleModel: { type: String, default: null },
  },
  { timestamps: true, collection: "trips" },
);
tripSchema.index({ originId: 1, destinationId: 1, departureAt: 1 });
tripSchema.index({ originId: 1, departureAt: 1 });
tripSchema.index({ destinationId: 1, departureAt: 1 });
tripSchema.index({ operatorId: 1, departureAt: 1 });
tripSchema.index({ status: 1, departureAt: 1 });
tripSchema.index(
  { scheduleId: 1, departureAt: 1 },
  { unique: true, partialFilterExpression: { scheduleId: { $type: "objectId" } } },
);

export type Trip = InferSchemaType<typeof tripSchema>;
export type TripDoc = HydratedDocument<Trip>;
export const TripModel = model("Trip", tripSchema);
