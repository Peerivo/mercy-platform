"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, LOCALE_MAX_AGE } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

export function LanguageSwitcher() {
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function selectLocale(next: string) {
    if ((next !== "ru" && next !== "ka") || next === locale || pending) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    // Refresh merges the new server tree, preserving form DOM and client state.
    // No form contents are copied into cookies, URLs, or browser storage.
    startTransition(() => router.refresh());
  }

  return (
    <select
      className="language-switcher"
      aria-label={locale === "ka" ? "ენა" : "Язык"}
      lang={locale}
      value={locale}
      aria-busy={pending}
      aria-disabled={pending}
      onChange={event => selectLocale(event.currentTarget.value)}
    >
      <option value="ru" lang="ru">{"🇷🇺"} Русский</option>
      <option value="ka" lang="ka">{"🇬🇪"} ქართული</option>
    </select>
  );
}
