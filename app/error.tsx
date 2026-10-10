"use client";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useLocale();
  return <section className="page-shell section" role="alert">
    <h1>{t("Не удалось загрузить страницу")}</h1>
    <p>{t("Попробуйте ещё раз. Если ошибка повторяется, напишите нам.")}</p>
    <div className="nav">
      <button className="btn" onClick={reset}>{t("Попробовать ещё раз")}</button>
      <Link className="btn secondary" href="/feedback">{t("Обратная связь")}</Link>
    </div>
  </section>;
}
