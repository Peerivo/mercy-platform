import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, translate } from ".";

export async function getTranslations() {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { locale, t: (message: string) => translate(locale, message) };
}
