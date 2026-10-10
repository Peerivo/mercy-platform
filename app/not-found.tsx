import Link from "next/link";
import { getTranslations } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getTranslations();
  return <section className="page-shell section">
    <h1>{t("Страница не найдена")}</h1>
    <p>{t("Эта страница недоступна или больше не существует.")}</p>
    <Link className="btn" href="/">{t("На главную")}</Link>
  </section>;
}
