import { getTranslations } from "@/lib/i18n/server";
import { authLoginNotice } from "@/lib/auth-login-notice";
import { isPeerivoAuthEnabled } from "@/lib/peerivo-auth";
import { PeerivoAuthForm } from "./peerivo-auth-form";
import { sendLoginLink } from "./actions";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return { title: t("Вход — Язык милосердия"), robots: { index: false, follow: false } };
}

function safeNext(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/cabinet";
  return value.slice(0, 500);
}

async function providerCapabilities(enabled: boolean) {
  if (!enabled) return { google: false, password: false, available: false };
  try {
    const response = await fetch("https://auth.peerivo.net/api/providers", {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) throw new Error("unavailable");
    const providers: unknown = await response.json();
    if (!providers || typeof providers !== "object") throw new Error("unavailable");
    const flags = providers as Record<string, unknown>;
    return {
      available: flags.available === true,
      google: flags.google === true,
      password: flags.password === true && process.env.PEERIVO_EMBEDDED_PASSWORD_ENABLED === "1",
    };
  } catch {
    // The first-party hosted login remains reachable on provider-status failures.
    return { google: false, password: false, available: false };
  }
}

export default async function Auth({ searchParams }: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { t } = await getTranslations();
  const q = await searchParams;
  const next = safeNext(q.next);
  const notice = authLoginNotice(q.error);
  const peerivoEnabled = isPeerivoAuthEnabled();
  const capabilities = await providerCapabilities(peerivoEnabled);

  return <section className="page-shell section auth-simple">
    <div className="auth-simple-card card">
      <div>
        <p className="auth-kicker">Peerivo ID</p>
        <p className="page-lead">{t("Один аккаунт Peerivo для входа в «Язык милосердия». Роли, права и данные Mercy остаются внутри сервиса.")}</p>
      </div>

      {notice && <p role={notice.role}>{t(notice.message)}</p>}
      {peerivoEnabled ? (
        <PeerivoAuthForm next={next} capabilities={capabilities} />
      ) : (
        // Recovery-only fallback for installations where central Auth has not
        // yet been configured. Do not display two competing forms in production.
        <div>
          <p role="status">{t("Единый вход Peerivo пока не настроен для этого окружения.")}</p>
          {q.sent ? <p role="status">{t("Письмо отправлено. Проверьте почту.")}</p> :
            <form className="grid auth-email-form" action={sendLoginLink}>
              <input type="hidden" name="next" value={next} />
              <label>{t("Email")}<input name="email" type="email" required autoComplete="email" /></label>
              <button className="btn">{t("Получить ссылку для входа")}</button>
            </form>}
        </div>
      )}
      <p className="muted auth-privacy-note">{t("Учётная запись Peerivo не предоставляет права администратора или куратора без отдельного назначения.")}</p>
      <p className="auth-help-link"><a href="/feedback">{t("Не получается войти? Напишите нам")}</a></p>
    </div>
  </section>;
}
