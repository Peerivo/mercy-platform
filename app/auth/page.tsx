import { authLoginNotice } from "@/lib/auth-login-notice";
import { sendLoginLink } from "./actions";

export const metadata = {
  title: "Вход — Язык милосердия",
  robots: { index: false, follow: false },
};

function safeNext(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/cabinet";
  return value.slice(0, 500);
}

export default async function Auth({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const q = await searchParams;
  const next = safeNext(q.next);
  const notice = authLoginNotice(q.error);

  return (
    <section className="page-shell section auth-simple">
      <div className="auth-simple-card card">
        <div>
          <p className="auth-kicker">Один шаг</p>
          <h1>Войти по email</h1>
          <p className="page-lead">
            Введите email — мы пришлём ссылку для входа. Если аккаунта ещё нет, он создастся автоматически.
            Пароль придумывать не нужно.
          </p>
        </div>

        {notice && <p role={notice.role}>{notice.message}</p>}

        {q.sent ? (
          <div className="auth-sent" role="status">
            <h2>Письмо отправлено</h2>
            <p>
              Откройте письмо от «Языка милосердия» и нажмите ссылку. После этого вы сразу вернётесь на нужную страницу.
            </p>
            <p className="muted">
              Если письма нет, проверьте «Спам» или отправьте ссылку ещё раз через минуту.
            </p>
          </div>
        ) : (
          <form className="grid auth-email-form" action={sendLoginLink}>
            <input type="hidden" name="next" value={next} />
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="name@example.com"
                autoFocus
              />
            </label>
            <button className="btn">Получить ссылку для входа</button>
          </form>
        )}

        <p className="muted auth-privacy-note">
          Для входа нужен только email. Имя, телефон и адрес при регистрации не требуются.
        </p>
        <p className="auth-help-link">
          <a href="/feedback">Не получается войти? Напишите нам</a>
        </p>
      </div>
    </section>
  );
}
