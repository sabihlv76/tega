import { FlowHeader } from "@/components/passenger/shell";
import { requestLocale, supportContacts } from "@/lib/server";
import { getTranslator } from "@/shared/i18n/catalog";

const SECTIONS = [
  "service",
  "bookings",
  "payments",
  "cancellations",
  "parcels",
  "privacy",
  "contact",
] as const;

export default async function TermsPage() {
  const t = getTranslator(await requestLocale());
  const support = await supportContacts();
  return (
    <div className="min-h-dvh pb-12">
      <FlowHeader title={t("terms.title")} />
      <main className="space-y-6 px-6 py-6">
        <p className="text-[15px] text-muted">{t("terms.intro")}</p>
        {SECTIONS.map((section) => (
          <section key={section}>
            <h2 className="font-semibold">{t(`terms.sections.${section}.title`)}</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">
              {t(`terms.sections.${section}.body`, { phone: support.phone, email: support.email })}
            </p>
          </section>
        ))}
      </main>
    </div>
  );
}
