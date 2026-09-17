import Link from "next/link";
import { submitFeedback } from "./actions";

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const q = await searchParams;
  const isSupport = q.topic === "support";
  const sourcePath = q.from?.startsWith("/") ? q.from : "";
  const returnHref = sourcePath || "/";

  return (
    <section className="page-shell section feedback-page">
      <div className="page-heading">
        <div>
          <h1>{isSupport ? "Поддержать Mercy" : "Обратная связь"}</h1>
          <p className="page-lead">
            {isSupport
              ? "Если вы хотите финансово поддержать развитие проекта, оставьте сообщение и email для ответа. Мы свяжемся с вами по email и сообщим доступные способы поддержки."
              : "Если что-то непонятно, не работает или кажется слишком сложным — напишите. Особенно важны проблемы со входом и регистрацией."}
          </p>
        </div>
      </div>

      {isSupport && !q.sent && (
        <div className="notice feedback-form">
          На этой странице платежи не принимаются. Поддержка добровольна, не
          влияет на получение помощи и не означает обещание налогового вычета или
          наличие специального благотворительного статуса.
        </div>
      )}

      {q.sent ? (
        <div className="card feedback-success" role="status">
          <h2>Спасибо</h2>
          <p>
            {isSupport
              ? "Сообщение отправлено. Мы сможем ответить на указанный email."
              : "Сообщение сохранено. Если вы указали email, мы сможем ответить."}
          </p>
          <Link className="btn secondary" href={returnHref}>
            {sourcePath === "/cabinet" ? "Вернуться в кабинет" : "На главную"}
          </Link>
        </div>
      ) : (
        <form className="card grid feedback-form" action={submitFeedback}>
          <input type="hidden" name="topic" value={isSupport ? "support" : "feedback"} />
          <input type="hidden" name="sourcePath" value={sourcePath} />

          {q.error && (
            <p role="alert">
              Не удалось отправить сообщение. Проверьте данные и попробуйте ещё
              раз.
            </p>
          )}

          <label>
            {isSupport
              ? "Как вы хотите поддержать проект или что хотите уточнить?"
              : "Что было сложно или что нужно исправить?"}
            <textarea
              name="message"
              minLength={3}
              maxLength={3000}
              rows={7}
              required
              placeholder={
                isSupport
                  ? "Например: хочу поддержать развитие проекта и узнать доступные способы."
                  : "Например: не поняла, куда нажать после ввода email."
              }
            />
          </label>

          <label>
            Email для ответа {isSupport ? "" : "— необязательно"}
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
            <label>
              На какой странице возникла проблема — необязательно
              <input
                name="pagePath"
                maxLength={500}
                placeholder="Например: /auth"
              />
            </label>
          )}

          <p className="muted">
            Не указывайте здесь пароли, документы, точный адрес, диагнозы или
            другие чувствительные данные.
          </p>

          <button className="btn">
            {isSupport ? "Отправить запрос о поддержке" : "Отправить обратную связь"}
          </button>
        </form>
      )}
    </section>
  );
}
