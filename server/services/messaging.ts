import nodemailer from "nodemailer";
import { config } from "../config";
import { errorFields, logger } from "../lib/logger";
import { MessageLogModel } from "../models";

// SMS and email delivery behind small provider interfaces. The SMS gateway is "TBD by FIKA", so
// Africa's Talking is implemented as the first live provider and the console provider is the default.

export interface SmsProvider {
  name: string;
  send(to: string, message: string): Promise<{ providerRef?: string }>;
}

export interface EmailProvider {
  name: string;
  send(to: string, subject: string, text: string): Promise<{ providerRef?: string }>;
}

const consoleSms: SmsProvider = {
  name: "console",
  async send(to, message) {
    logger.info(`[SMS → ${to}] ${message}`);
    return {};
  },
};

const africasTalking: SmsProvider = {
  name: "africastalking",
  async send(to, message) {
    const at = config.sms.africastalking;
    if (!at.apiKey) throw new Error("AT_API_KEY is not configured");
    const url = at.sandbox
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";
    const body = new URLSearchParams({ username: at.username, to, message });
    if (at.senderId) body.set("from", at.senderId);
    const res = await fetch(url, {
      method: "POST",
      headers: { apiKey: at.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Africa's Talking responded ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      SMSMessageData?: { Recipients?: { status: string; messageId?: string; statusCode?: number }[] };
    };
    const recipient = json.SMSMessageData?.Recipients?.[0];
    if (!recipient || (recipient.status !== "Success" && recipient.statusCode !== 101)) {
      throw new Error(`SMS rejected: ${recipient?.status ?? "no recipient"}`);
    }
    return { providerRef: recipient.messageId };
  },
};

const consoleEmail: EmailProvider = {
  name: "console",
  async send(to, subject, text) {
    logger.info(`[EMAIL → ${to}] ${subject}\n${text}`);
    return {};
  },
};

let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
const smtpEmail: EmailProvider = {
  name: "smtp",
  async send(to, subject, text) {
    const smtp = config.email.smtp;
    if (!smtp.host) throw new Error("SMTP_HOST is not configured");
    smtpTransport ??= nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    const info = await smtpTransport.sendMail({ from: config.email.from, to, subject, text });
    return { providerRef: info.messageId };
  },
};

export function smsProvider(): SmsProvider {
  return config.sms.provider === "africastalking" ? africasTalking : consoleSms;
}

export function emailProvider(): EmailProvider {
  return config.email.provider === "smtp" ? smtpEmail : consoleEmail;
}

export function isConsoleDelivery(channel: "sms" | "email"): boolean {
  return channel === "sms" ? config.sms.provider === "console" : config.email.provider === "console";
}

export async function sendSms(to: string, body: string): Promise<void> {
  const provider = smsProvider();
  try {
    const { providerRef } = await provider.send(to, body);
    await MessageLogModel.create({ channel: "sms", to, body, provider: provider.name, status: "sent", providerRef });
  } catch (err) {
    logger.error("SMS delivery failed", { to, ...errorFields(err) });
    await MessageLogModel.create({
      channel: "sms",
      to,
      body,
      provider: provider.name,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const provider = emailProvider();
  try {
    const { providerRef } = await provider.send(to, subject, body);
    await MessageLogModel.create({ channel: "email", to, subject, body, provider: provider.name, status: "sent", providerRef });
  } catch (err) {
    logger.error("Email delivery failed", { to, ...errorFields(err) });
    await MessageLogModel.create({
      channel: "email",
      to,
      subject,
      body,
      provider: provider.name,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
