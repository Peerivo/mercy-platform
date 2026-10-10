
import { getTranslations } from "@/lib/i18n/server";
import { updatePassword } from "../actions";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Новый пароль — Язык милосердия"),
  robots: { index: false, follow: false },
};
}

export default async function UpdatePassword({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { t } = await getTranslations();

  const q = await searchParams;

  return (
    <section className="container section">
      <h1>{t("Новый пароль")}</h1>
      {q.error && (
        <p role="alert">{t("Не удалось обновить пароль. Запросите новую ссылку.")}</p>
      )}
      <form action={updatePassword} className="card grid">
        <label>{t("Новый пароль")}<input
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
          />
        </label>
        <button className="btn">{t("Сохранить пароль")}</button>
      </form>
    </section>
  );
}
