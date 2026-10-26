import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";
import {
  BOOKING_STATUSES,
  LOCALES,
  PAYMENT_METHODS,
  PAYMENT_STATES,
  TICKET_SCAN_RESULTS,
} from "../../shared/constants";

const bookingSchema = new Schema(
  {
    reference: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tripId: { type: Schema.Types.ObjectId, ref: "Trip", required: true },
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    originId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    destinationId: { type: Schema.Types.ObjectId, ref: "Location", required: true },
    /** Denormalised scheduled departure, for fast "upcoming / past" queries and reminders. */
    departureAt: { type: Date, required: true },
    places: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    traveler: {
      type: new Schema(
        {
          name: { type: String, required: true, trim: true },
          phone: { type: String, required: true },
          email: { type: String, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    status: { type: String, enum: BOOKING_STATUSES, default: "pending_payment", required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATES, default: "unpaid", required: true },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
    holdExpiresAt: { type: Date, default: null },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ["passenger", "operator", "admin", "system", null], default: null },
    cancelReason: { type: String, default: null },
    refundAmount: { type: Number, default: 0 },
    locale: { type: String, enum: LOCALES, default: "en" },
    reminderSentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "bookings" },
);
bookingSchema.index({ reference: 1 }, { unique: true });
bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ tripId: 1, status: 1 });
bookingSchema.index({ operatorId: 1, departureAt: -1 });
bookingSchema.index({ status: 1, holdExpiresAt: 1 });
bookingSchema.index({ status: 1, departureAt: 1 });

export type Booking = InferSchemaType<typeof bookingSchema>;
export type BookingDoc = HydratedDocument<Booking>;
export const BookingModel = model("Booking", bookingSchema);

const ticketScanSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    input: { type: String, default: null },
    stationId: { type: Schema.Types.ObjectId, ref: "Location", default: null },
    scannedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    method: { type: String, enum: ["qr", "manual"], required: true },
    result: { type: String, enum: TICKET_SCAN_RESULTS, required: true },
  },
  { timestamps: true, collection: "ticket_scans" },
);
ticketScanSchema.index({ stationId: 1, createdAt: -1 });
ticketScanSchema.index({ bookingId: 1 });

export const TicketScanModel = model("TicketScan", ticketScanSchema);
