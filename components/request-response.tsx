"use client";
import { useLocale } from "@/components/locale-provider";


import Link from "next/link";
import { useActionState } from "react";
import {
  respondToRequest,
  type RequestResponseState,
} from "@/app/cabinet/requests/[id]/response-actions";

const initialState: RequestResponseState = {
  ok: false,
  message: "",
};

export function RequestResponse({
  caseId,
  signedIn,
  existing,
}: {
  caseId: string;
  signedIn: boolean;
  existing?: {
    message: string;
    contact_method: string;
  } | null;
}) {
  const { t } = useLocale();

  const [state, action, pending] = useActionState(
    respondToRequest,
    initialState
  );

  if (!signedIn) {
    return (
      <section className="request-response card" id="help-response">
        <h2>{t("Можете помочь?")}</h2>
        <p>{t("Отклик видит только автор просьбы и, если назначен, координатор.")}</p>
        <Link
          className="btn"
          href={`/auth?next=${encodeURIComponent(
            `/cabinet/requests/${caseId}#help-response`
          )}`}
        >{t("Хочу помочь")}</Link>
        <p className="muted response-auth-note">{t("Вход теперь простой: только email, без пароля.")}</p>
      </section>
    );
  }

  return (
    <section className="request-response card" id="help-response">
      <h2>{existing ? t("Ваш отклик") : t("Хочу помочь")}</h2>
      <p className="muted">{t("Напишите коротко, чем можете помочь и как с вами связаться. Эти данные не публикуются.")}</p>

      <form action={action} className="grid">
        <input type="hidden" name="caseId" value={caseId} />

        <label>{t("Чем вы можете помочь")}<textarea
            name="message"
            minLength={10}
            maxLength={1500}
            rows={5}
            required
            defaultValue={existing?.message ?? ""}
            placeholder={t("Например: могу привезти продукты вечером или помочь с документами онлайн.")}
          />
        </label>

        <label>{t("Как с вами связаться")}<input
            name="contactMethod"
            minLength={2}
            maxLength={200}
            required
            defaultValue={existing?.contact_method ?? ""}
            placeholder={t("Telegram, телефон или другой удобный способ")}
          />
        </label>

        <label className="consent-row">
          <input name="consent" type="checkbox" required />
          <span>{t("Я согласен(-на), что сообщение и указанный способ связи будут доступны автору этой просьбы и назначенному координатору.")}</span>
        </label>

        <button className="btn" disabled={pending}>
          {pending
            ? t("Отправляем…")
            : existing
              ? t("Обновить отклик")
              : t("Отправить отклик")}
        </button>
      </form>

      {state.message && (
        <p role={state.ok ? "status" : "alert"}>{t(state.message)}</p>
      )}
    </section>
  );
}
