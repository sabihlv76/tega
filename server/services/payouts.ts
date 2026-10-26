import type { Types } from "mongoose";
import { formatRwf } from "../../shared/money";
import { maskAccount, randomCode } from "../lib/crypto";
import { conflict, notFound } from "../lib/errors";
import { OperatorModel, PaymentModel, type PayoutDoc, PayoutModel } from "../models";
import { type Actor, audit } from "./audit";
import { notifyOperatorStaff } from "./notify";
import { getSettings } from "./settings";

// Operators are paid out per cycle for services already delivered (bus departed / parcel shipped).
// Net payout = mobile money collected by FIKA − FIKA commission on all sales (cash is already with
// the operator, so commission on cash sales is deducted here).

const DAY = 24 * 60 * 60_000;

export async function generatePayouts(options: { force?: boolean; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const settings = await getSettings();
  const operators = await OperatorModel.find({ status: { $in: ["approved", "suspended"] } }).lean();
  let created = 0;
  for (const operator of operators) {
    if (!options.force) {
      const last = await PayoutModel.findOne({ operatorId: operator._id }).sort({ periodEnd: -1 }).lean();
      if (last && now.getTime() - last.periodEnd.getTime() < settings.payoutCycleDays * DAY) continue;
    }
    const payments = await PaymentModel.find({
      operatorId: operator._id,
      status: "success",
      payoutId: null,
      eligibleForPayoutAt: { $ne: null, $lte: now },
    }).lean();
    if (payments.length === 0) continue;

    const gross = payments.reduce((s, p) => s + p.amount, 0);
    const onlineGross = payments.filter((p) => p.method !== "cash").reduce((s, p) => s + p.amount, 0);
    const commission = payments.reduce((s, p) => s + (p.commissionAmount ?? 0), 0);
    const periodStart = new Date(Math.min(...payments.map((p) => (p.eligibleForPayoutAt ?? p.paidAt ?? now).getTime())));
    const payout = await PayoutModel.create({
      operatorId: operator._id,
      periodStart,
      periodEnd: now,
      paymentsCount: payments.length,
      gross,
      onlineGross,
      cashGross: gross - onlineGross,
      commission,
      net: onlineGross - commission,
      status: "pending",
      dueDate: new Date(now.getTime() + 2 * DAY),
      bankAccountMasked: maskAccount(operator.bankAccount?.accountNumber),
    });
    await PaymentModel.updateMany({ _id: { $in: payments.map((p) => p._id) } }, { $set: { payoutId: payout._id } });
    created++;
  }
  return created;
}

/** Sends one payout. Bank transfers are mocked until FIKA's banking integration is connected. */
export async function processPayout(payoutOrId: PayoutDoc | Types.ObjectId | string, actor: Actor | null): Promise<PayoutDoc> {
  const payout = typeof payoutOrId === "object" && "save" in payoutOrId ? payoutOrId : await PayoutModel.findById(payoutOrId);
  if (!payout) throw notFound();
  if (payout.status !== "pending" && payout.status !== "failed") throw conflict("INVALID_STATE");
  const operator = await OperatorModel.findById(payout.operatorId).lean();
  payout.processedAt = new Date();
  payout.processedBy = actor ? (actor.id as Types.ObjectId) : null;

  if (payout.net < 0) {
    payout.status = "failed";
    payout.failureReason = `Operator owes ${formatRwf(-payout.net)} commission on cash sales`;
  } else if (payout.net > 0 && !operator?.bankAccount?.accountNumber) {
    payout.status = "failed";
    payout.failureReason = "No payout account on file";
  } else {
    payout.status = "paid";
    payout.failureReason = null;
    payout.reference = payout.net > 0 ? `PO-${randomCode(8)}` : "NO-TRANSFER";
    payout.bankAccountMasked = maskAccount(operator?.bankAccount?.accountNumber) ?? payout.bankAccountMasked;
  }
  await payout.save();
  await audit(actor, `payout.${payout.status}`, "payout", payout._id, `${operator?.name ?? ""} ${formatRwf(payout.net)}`, {
    operatorId: payout.operatorId,
  });
  if (payout.status === "paid" && payout.net > 0) {
    await notifyOperatorStaff(
      payout.operatorId,
      "payout.paid",
      { title: "notifications.payoutPaidTitle", body: "notifications.payoutPaidBody" },
      { amount: formatRwf(payout.net), account: payout.bankAccountMasked ?? "" },
    );
  }
  return payout;
}

export async function processAllPayouts(actor: Actor | null): Promise<number> {
  const pending = await PayoutModel.find({ status: "pending" });
  let processed = 0;
  for (const payout of pending) {
    await processPayout(payout, actor);
    processed++;
  }
  return processed;
}
