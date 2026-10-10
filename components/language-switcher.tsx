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
    <div className="language-control">
      <svg className="language-flag" data-locale={locale} viewBox="0 0 36 24" width="24" height="16" aria-hidden="true" focusable="false">
        <rect width="36" height="24" fill="#fff" />
        {locale === "ru" ? <>
          <rect y="8" width="36" height="8" fill="#0039a6" />
          <rect y="16" width="36" height="8" fill="#d52b1e" />
        </> : <g fill="#e8112d">
          <path d="M16 0h4v10h16v4H20v10h-4V14H0v-4h16z" />
          {[[8, 5], [28, 5], [8, 19], [28, 19]].map(([x, y]) => (
            <path key={`${x}-${y}`} transform={`translate(${x} ${y})`} d="M-1-1l-.6-2Q0-2.2 1.6-3L1-1l2-.6Q2.2 0 3 1.6L1 1l.6 2Q0 2.2-1.6 3L-1 1l-2 .6Q-2.2 0-3-1.6z" />
          ))}
        </g>}
      </svg>
      <select
        className="language-switcher"
        aria-label={locale === "ka" ? "ენა" : "Язык"}
        lang={locale}
        value={locale}
        aria-busy={pending}
        aria-disabled={pending}
        onChange={event => selectLocale(event.currentTarget.value)}
      >
        <option value="ru" lang="ru">Русский</option>
        <option value="ka" lang="ka">ქართული</option>
      </select>
    </div>
  );
}
