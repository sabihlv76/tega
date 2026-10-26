import type { Types } from "mongoose";
import { DEFAULT_SETTINGS, type PlatformSettings } from "../../shared/constants";
import { SettingModel } from "../models";

// Platform settings live in the app_settings collection under one key and are cached briefly.

const KEY = "platform";
const TTL_MS = 15_000;
let cache: { value: PlatformSettings; at: number } | null = null;

function merge(stored: Partial<PlatformSettings> | null | undefined): PlatformSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    channels: { ...DEFAULT_SETTINGS.channels, ...(stored?.channels ?? {}) },
  };
}

export async function getSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const doc = await SettingModel.findOne({ key: KEY }).lean();
  const value = merge(doc?.value as Partial<PlatformSettings> | undefined);
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(
  patch: Partial<PlatformSettings>,
  userId?: Types.ObjectId | string,
): Promise<PlatformSettings> {
  const current = await getSettings();
  const next = merge({ ...current, ...patch, channels: { ...current.channels, ...(patch.channels ?? {}) } });
  await SettingModel.updateOne({ key: KEY }, { $set: { value: next, updatedBy: userId ?? null } }, { upsert: true });
  cache = { value: next, at: Date.now() };
  return next;
}

export function clearSettingsCache(): void {
  cache = null;
}
