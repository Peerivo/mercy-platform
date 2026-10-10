"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, LOCALE_MAX_AGE, type Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

export function LanguageSwitcher() {
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function selectLocale(next: Locale) {
    if (next === locale || pending) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    // Refresh merges the new server tree, preserving form DOM and client state.
    // No form contents are copied into cookies, URLs, or browser storage.
    startTransition(() => router.refresh());
  }

  return (
    <div className="language-switcher" role="group" aria-label={locale === "ka" ? "ენა" : "Язык"} aria-busy={pending}>
      <button type="button" lang="ru" aria-pressed={locale === "ru"} disabled={pending} onClick={() => selectLocale("ru")}>RU</button>
      <button type="button" lang="ka" aria-pressed={locale === "ka"} disabled={pending} onClick={() => selectLocale("ka")}>ქართული</button>
    </div>
  );
}
