import type { Types } from "mongoose";
import type { Locale } from "../../shared/constants";
import type { MessageKey, TranslationVars } from "../../shared/i18n";
import { getTranslator } from "../../shared/i18n/catalog";
import { enqueue } from "../jobs/queue";
import { errorFields, logger } from "../lib/logger";
import { NotificationModel, UserModel } from "../models";
import { emit, rooms } from "../realtime";
import { getSettings } from "./settings";

// One entry point for every user-facing message. Each channel (in-app, SMS, email) is independently
// switchable by admins (platform settings) and by users (profile preferences), and every message is
// rendered in the recipient's language.

export interface NotifyInput {
  userId?: Types.ObjectId | string | null;
  /** SMS destination when it differs from the user's phone (e.g. a parcel receiver). */
  phone?: string | null;
  email?: string | null;
  locale?: Locale;
  type: string;
  vars: TranslationVars;
  inApp?: { title: MessageKey; body: MessageKey };
  sms?: MessageKey;
  emailMsg?: { subject: MessageKey; body: MessageKey };
  data?: Record<string, unknown>;
  /** Ignore user opt-outs (used for transactional SMS such as tickets and refunds). */
  transactional?: boolean;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const settings = await getSettings();
    const user = input.userId ? await UserModel.findById(input.userId).lean() : null;
    const locale = input.locale ?? (user?.language as Locale | undefined) ?? "en";
    const t = getTranslator(locale);
    const prefs = user?.notificationPrefs ?? { sms: true, email: true, inApp: true };

    if (input.inApp && user && settings.channels.inApp && prefs.inApp) {
      const doc = await NotificationModel.create({
        userId: user._id,
        type: input.type,
        title: t(input.inApp.title, input.vars),
        body: t(input.inApp.body, input.vars),
        data: input.data ?? null,
      });
      emit(rooms.user(user._id.toString()), "notification.new", {
        id: doc._id.toString(),
        type: doc.type,
        title: doc.title,
        body: doc.body,
        data: doc.data,
        readAt: null,
        createdAt: doc.createdAt.toISOString(),
      });
    }

    const phone = input.phone ?? user?.phone ?? null;
    if (input.sms && phone && settings.channels.sms && (input.transactional || prefs.sms)) {
      await enqueue("sms.send", { to: phone, body: t(input.sms, input.vars) }, { maxAttempts: 4 });
    }

    const email = input.email ?? user?.email ?? null;
    if (input.emailMsg && email && settings.channels.email && (input.transactional || prefs.email)) {
      await enqueue(
        "email.send",
        { to: email, subject: t(input.emailMsg.subject, input.vars), body: t(input.emailMsg.body, input.vars) },
        { maxAttempts: 4 },
      );
    }
  } catch (err) {
    // Notifications must never break the business flow that triggered them.
    logger.error("Notification failed", { type: input.type, ...errorFields(err) });
  }
}

/** Notify every admin (in-app only), e.g. new operator applications or fare cap violations. */
export async function notifyAdmins(
  type: string,
  inApp: { title: MessageKey; body: MessageKey },
  vars: TranslationVars,
  data?: Record<string, unknown>,
): Promise<void> {
  const admins = await UserModel.find({ role: "admin", status: "active" }, { _id: 1 }).lean();
  await Promise.all(admins.map((a) => notify({ userId: a._id, type, inApp, vars, data })));
}

/** Notify the active staff of an operator (in-app). */
export async function notifyOperatorStaff(
  operatorId: Types.ObjectId | string,
  type: string,
  inApp: { title: MessageKey; body: MessageKey },
  vars: TranslationVars,
  data?: Record<string, unknown>,
): Promise<void> {
  const staff = await UserModel.find({ role: "operator", operatorId, status: "active" }, { _id: 1 }).lean();
  await Promise.all(staff.map((u) => notify({ userId: u._id, type, inApp, vars, data })));
}
