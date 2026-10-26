import type { Locale } from "../constants";
import { createTranslator, type Translator } from "./index";
import { en, type Messages } from "./messages/en";
import { fr } from "./messages/fr";
import { rw } from "./messages/rw";
import { sw } from "./messages/sw";

// Eager catalog of every locale. Used by the API (SMS/email templates, error messages) and by the
// web app's server components. Client components load other locales lazily (see lib/i18n).

export const catalogs: Record<Locale, Messages> = { en, fr, rw, sw };

const cache = new Map<Locale, Translator>();

export function getTranslator(locale: Locale): Translator {
  let t = cache.get(locale);
  if (!t) {
    t = createTranslator(locale, catalogs[locale], en);
    cache.set(locale, t);
  }
  return t;
}
