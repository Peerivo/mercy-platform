import { reset, signIn, signUp } from "./actions";

export default async function Auth({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const q = await searchParams;

  return (
    <section className="page-shell section">
      <h1>Вход и регистрация</h1>
      <p className="page-lead">
        Войдите в существующий аккаунт или создайте новый. Настоящее имя, телефон и адрес для регистрации не нужны.
      </p>

      {q.error && (
        <p role="alert">Не удалось выполнить действие. Проверьте данные.</p>
      )}
      {q.check && (
        <p role="status">Проверьте email: мы отправили письмо для подтверждения аккаунта.</p>
      )}

      <div className="grid cols2 auth-grid">
        <form className="card grid" action={signIn}>
          <div>
            <h2>Войти</h2>
            <p className="muted">Для тех, у кого уже есть аккаунт.</p>
          </div>
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Пароль
            <input name="password" type="password" minLength={10} required autoComplete="current-password" />
          </label>
          <button className="btn">Войти</button>
        </form>

        <form className="card grid" action={signUp}>
          <div>
            <h2>Создать аккаунт</h2>
            <p className="muted">
              Email используется только для входа и восстановления доступа.
            </p>
          </div>
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Пароль от 10 символов
            <input name="password" type="password" minLength={10} required autoComplete="new-password" />
          </label>
          <button className="btn">Зарегистрироваться</button>
        </form>
      </div>

      <form action={reset} className="auth-reset grid">
        <div>
          <h2>Забыли пароль?</h2>
          <p className="muted">Укажите email — пришлём ссылку для восстановления доступа.</p>
        </div>
        <label>
          Email для восстановления
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <div className="form-actions">
          <button className="btn secondary">Восстановить доступ</button>
        </div>
      </form>
    </section>
  );
}
