import { type HydratedDocument, type InferSchemaType, model, Schema } from "mongoose";
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYOUT_STATUSES } from "../../shared/constants";

const paymentSchema = new Schema(
  {
    kind: { type: String, enum: ["booking", "parcel"], required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    parcelId: { type: Schema.Types.ObjectId, ref: "Parcel", default: null },
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    mode: { type: String, enum: ["mock", "live"], default: "mock" },
    /** Mobile money number that paid (no PINs or card data are ever stored). */
    phone: { type: String, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "RWF" },
    status: { type: String, enum: PAYMENT_STATUSES, default: "initiated", required: true },
    providerRef: { type: String, default: null },
    failureReason: { type: String, default: null },
    commissionRate: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    operatorAmount: { type: Number, default: 0 },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundAmount: { type: Number, default: 0 },
    /** Set once the service is delivered (bus departed / parcel shipped); only then is it paid out. */
    eligibleForPayoutAt: { type: Date, default: null },
    payoutId: { type: Schema.Types.ObjectId, ref: "Payout", default: null },
    events: {
      type: [
        new Schema(
          { status: String, at: { type: Date, default: () => new Date() }, note: { type: String, default: null } },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, collection: "payments" },
);
paymentSchema.index({ bookingId: 1 });
paymentSchema.index({ parcelId: 1 });
paymentSchema.index({ providerRef: 1 });
paymentSchema.index({ operatorId: 1, paidAt: -1 });
paymentSchema.index({ status: 1, payoutId: 1, eligibleForPayoutAt: 1 });
paymentSchema.index({ status: 1, createdAt: 1 });

export type Payment = InferSchemaType<typeof paymentSchema>;
export type PaymentDoc = HydratedDocument<Payment>;
export const PaymentModel = model("Payment", paymentSchema);

/** Raw provider webhooks, kept for debugging and reconciliation. */
const paymentCallbackSchema = new Schema(
  {
    provider: { type: String, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", default: null },
    providerRef: { type: String, default: null },
    payload: { type: String, required: true },
    processed: { type: Boolean, default: false },
    error: { type: String, default: null },
  },
  { timestamps: true, collection: "mobile_money_callbacks" },
);
paymentCallbackSchema.index({ providerRef: 1 });

export const PaymentCallbackModel = model("PaymentCallback", paymentCallbackSchema);

const payoutSchema = new Schema(
  {
    operatorId: { type: Schema.Types.ObjectId, ref: "Operator", required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    paymentsCount: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    onlineGross: { type: Number, default: 0 },
    cashGross: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    /** Online collections minus commission on all sales (cash is already with the operator). */
    net: { type: Number, default: 0 },
    status: { type: String, enum: PAYOUT_STATUSES, default: "pending", required: true },
    dueDate: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    processedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reference: { type: String, default: null },
    failureReason: { type: String, default: null },
    bankAccountMasked: { type: String, default: null },
  },
  { timestamps: true, collection: "payouts" },
);
payoutSchema.index({ operatorId: 1, periodEnd: -1 });
payoutSchema.index({ status: 1, dueDate: 1 });

export type Payout = InferSchemaType<typeof payoutSchema>;
export type PayoutDoc = HydratedDocument<Payout>;
export const PayoutModel = model("Payout", payoutSchema);
