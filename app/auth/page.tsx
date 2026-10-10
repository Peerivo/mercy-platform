
import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { authLoginNotice } from "@/lib/auth-login-notice";
import { isPeerivoAuthEnabled } from "@/lib/peerivo-auth";
import { sendLoginLink } from "./actions";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Вход — Язык милосердия"),
  robots: { index: false, follow: false },
};
}

function safeNext(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/cabinet";
  return value.slice(0, 500);
}

export default async function Auth({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { t } = await getTranslations();

  const q = await searchParams;
  const next = safeNext(q.next);
  const notice = authLoginNotice(q.error);
  const peerivoEnabled = isPeerivoAuthEnabled();

  return (
    <section className="page-shell section auth-simple">
      <div className="auth-simple-card card">
        <div>
          <p className="auth-kicker">Peerivo ID</p>
          <h1>{t("Войти через Peerivo")}</h1>
          <p className="page-lead">{t("Используйте единый Peerivo ID для входа в «Язык милосердия». Локальные роли и доступы Mercy остаются внутри кабинета и не смешиваются с общей авторизацией Peerivo.")}</p>
        </div>

        {notice && <p role={notice.role}>{t(notice.message)}</p>}

        {peerivoEnabled && <p className="notice">{t("Peerivo ID — отдельный сервис. Его страницы входа и письма могут быть на русском. Язык Mercy сохранится после возвращения.")}</p>}

        {peerivoEnabled ? (
          <p>
            <Link className="btn" href={`/auth/start?next=${encodeURIComponent(next)}`}>{t("Войти через Peerivo")}</Link>
          </p>
        ) : null}

        {q.sent ? (
          <div className="auth-sent" role="status">
            <h2>{t("Письмо отправлено")}</h2>
            <p>{t("Письмо со ссылкой может быть на русском языке; откройте ссылку для возвращения в Mercy.")}</p>
            <p>{t("Откройте письмо от «Языка милосердия» и нажмите ссылку. После этого вы сразу вернётесь на нужную страницу.")}</p>
            <p className="muted">{t("Если письма нет, проверьте «Спам» или отправьте ссылку ещё раз через минуту.")}</p>
          </div>
        ) : (
          <details className="auth-email-fallback" open={!peerivoEnabled}>
            <summary>{t("Войти по email без Peerivo")}</summary>
            <form className="grid auth-email-form" action={sendLoginLink}>
              <input type="hidden" name="next" value={next} />
              <label>
                {t("Email")}
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@example.com"
                  autoFocus={!peerivoEnabled}
                />
              </label>
              <button className="btn">{t("Получить ссылку для входа")}</button>
            </form>
          </details>
        )}

        <p className="muted auth-privacy-note">{t("Для входа нужен только email. Имя, телефон и адрес при регистрации не требуются.")}</p>
        <p className="auth-help-link">
          <a href="/feedback">{t("Не получается войти? Напишите нам")}</a>
        </p>
      </div>
    </section>
  );
}
