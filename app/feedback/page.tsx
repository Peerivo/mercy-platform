import Link from "next/link";
import { submitFeedback } from "./actions";

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const q = await searchParams;

  return (
    <section className="page-shell section feedback-page">
      <div className="page-heading">
        <div>
          <h1>Обратная связь</h1>
          <p className="page-lead">
            Если что-то непонятно, не работает или кажется слишком сложным — напишите. Особенно важны проблемы со входом и регистрацией.
          </p>
        </div>
      </div>

      {q.sent ? (
        <div className="card feedback-success" role="status">
          <h2>Спасибо</h2>
          <p>Сообщение сохранено. Если вы указали email, мы сможем ответить.</p>
          <Link className="btn secondary" href="/">
            На главную
          </Link>
        </div>
      ) : (
        <form className="card grid feedback-form" action={submitFeedback}>
          {q.error && (
            <p role="alert">Не удалось отправить сообщение. Проверьте данные и попробуйте ещё раз.</p>
          )}

          <label>
            Что было сложно или что нужно исправить?
            <textarea
              name="message"
              minLength={3}
              maxLength={3000}
              rows={7}
              required
              placeholder="Например: не поняла, куда нажать после ввода email."
            />
          </label>

          <label>
            Email для ответа — необязательно
            <input
              name="replyEmail"
              type="email"
              maxLength={320}
              autoComplete="email"
              placeholder="name@example.com"
            />
          </label>

          <label>
            На какой странице возникла проблема — необязательно
            <input
              name="pagePath"
              maxLength={500}
              placeholder="Например: /auth"
            />
          </label>

          <p className="muted">
            Не указывайте здесь пароли, документы, точный адрес, диагнозы или другие чувствительные данные.
          </p>

          <button className="btn">Отправить обратную связь</button>
        </form>
      )}
    </section>
  );
}
