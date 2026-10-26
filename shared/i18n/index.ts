import { DEFAULT_LOCALE, type Locale, LOCALES } from "../constants";
import type { Messages } from "./messages/en";

export type { Messages };

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type StripPlural<K> = K extends `${infer Base}_one` ? Base : K extends `${infer Base}_other` ? Base : K;

/** Every translatable key, e.g. "home.whereTo" or "search.placesLeft" (plural base). */
export type MessageKey = Leaves<Messages>;
type Leaves<T, Depth extends number[] = []> = Depth["length"] extends 5
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? StripPlural<K> | K : Join<K, Leaves<T[K], [...Depth, 1]>>;
    }[keyof T & string];

export type TranslationVars = Record<string, string | number | null | undefined>;
export type Translator = (key: MessageKey | (string & {}), vars?: TranslationVars) => string;

function lookup(messages: unknown, path: string): string | undefined {
  let node: unknown = messages;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: Locale, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/**
 * Builds a translator. Missing keys fall back to `fallback` (English), then to the key itself.
 * Plural forms are picked from `<key>_<category>` using the `count` variable.
 */
export function createTranslator(locale: Locale, messages: Messages, fallback?: Messages): Translator {
  return (key, vars) => {
    const candidates: string[] = [];
    if (vars && typeof vars.count === "number") {
      const category = pluralCategory(locale, vars.count);
      candidates.push(`${key}_${category}`, `${key}_other`);
    }
    candidates.push(key);
    for (const source of fallback ? [messages, fallback] : [messages]) {
      for (const candidate of candidates) {
        const value = lookup(source, candidate);
        if (value !== undefined) return interpolate(value, vars);
      }
    }
    return key;
  };
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Picks the best supported locale from an Accept-Language header or a raw value. */
export function resolveLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  if (isLocale(input)) return input;
  for (const part of input.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
    if (base === "kin" || base === "ki") return "rw";
    if (base === "swa") return "sw";
  }
  return DEFAULT_LOCALE;
}
