import { Logo } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper sm:bg-canvas">
      <header className="flex items-center justify-between px-6 py-5">
        <Logo />
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16 sm:items-center">
        <div className="w-full max-w-md sm:rounded-2xl sm:border sm:border-line sm:bg-paper sm:p-8">{children}</div>
      </main>
    </div>
  );
}
