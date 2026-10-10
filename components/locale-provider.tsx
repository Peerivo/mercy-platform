"use client";

import { createContext, useContext, useMemo } from "react";
import { type Locale, translate } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("ru");

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({ locale, t: (message: string) => translate(locale, message) }), [locale]);
}
