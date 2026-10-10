
import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { submitFeedback } from "./actions";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Обратная связь — Язык милосердия"),
  robots: { index: false, follow: false },
};
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { t } = await getTranslations();

  const q = await searchParams;
  const isSupport = q.topic === "support";
  const sourcePath = q.from?.startsWith("/") ? q.from : "";
  const returnHref = sourcePath || "/";

  return (
    <section className="page-shell section feedback-page">
      <div className="page-heading">
        <div>
          <h1>{isSupport ? t("Поддержать Mercy") : t("Обратная связь")}</h1>
          <p className="page-lead">
            {isSupport
              ? t("Если вы хотите обсудить поддержку развития проекта, оставьте сообщение и email для ответа. Мы свяжемся с вами по email и расскажем о доступных вариантах.")
              : t("Если что-то непонятно, не работает или кажется слишком сложным — напишите. Особенно важны проблемы со входом и регистрацией.")}
          </p>
        </div>
      </div>

      {isSupport && !q.sent && (
        <div className="notice feedback-form">{t("На этой странице платежи не принимаются. Поддержка добровольна, не влияет на получение помощи и не означает обещание налогового вычета или наличие специального благотворительного статуса.")}</div>
      )}

      {q.sent ? (
        <div className="card feedback-success" role="status">
          <h2>{t("Спасибо")}</h2>
          <p>
            {isSupport
              ? t("Сообщение отправлено. Мы сможем ответить на указанный email.")
              : t("Сообщение сохранено. Если вы указали email, мы сможем ответить.")}
          </p>
          <Link className="btn secondary" href={returnHref}>
            {sourcePath === "/cabinet" ? t("Вернуться в кабинет") : t("На главную")}
          </Link>
        </div>
      ) : (
        <form className="card grid feedback-form" action={submitFeedback}>
          <input type="hidden" name="topic" value={isSupport ? "support" : "feedback"} />
          <input type="hidden" name="sourcePath" value={sourcePath} />

          {q.error && (
            <p role="alert">{t("Не удалось отправить сообщение. Проверьте данные и попробуйте ещё раз.")}</p>
          )}

          <label>
            {isSupport
              ? t("Как вы хотите поддержать проект или что хотите уточнить?")
              : t("Что было сложно или что нужно исправить?")}
            <textarea
              name="message"
              minLength={3}
              maxLength={3000}
              rows={7}
              required
              placeholder={
                isSupport
                  ? t("Например: хочу обсудить поддержку развития проекта и узнать доступные варианты.")
                  : t("Например: не поняла, куда нажать после ввода email.")
              }
            />
          </label>

          <label>{t("Email для ответа")}{" "}{isSupport ? "" : t("— необязательно")}
            <input
              name="replyEmail"
              type="email"
              maxLength={320}
              autoComplete="email"
              required={isSupport}
              placeholder="name@example.com"
            />
          </label>

          {!isSupport && (
            <label>{t("На какой странице возникла проблема — необязательно")}<input
                name="pagePath"
                maxLength={500}
                placeholder={t("Например: /auth")}
              />
            </label>
          )}

          <p className="muted">{t("Не указывайте здесь пароли, документы, точный адрес, диагнозы или другие чувствительные данные.")}</p>

          <button className="btn">
            {isSupport ? t("Отправить запрос о поддержке") : t("Отправить обратную связь")}
          </button>
        </form>
      )}
    </section>
  );
}
