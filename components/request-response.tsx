"use client";

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
  const [state, action, pending] = useActionState(
    respondToRequest,
    initialState
  );

  if (!signedIn) {
    return (
      <section className="request-response card" id="help-response">
        <h2>Можете помочь?</h2>
        <p>
          Отклик видит только автор просьбы и, если назначен, координатор.
        </p>
        <Link
          className="btn"
          href={`/auth?next=${encodeURIComponent(
            `/cabinet/requests/${caseId}#help-response`
          )}`}
        >
          Хочу помочь
        </Link>
        <p className="muted response-auth-note">
          Вход теперь простой: только email, без пароля.
        </p>
      </section>
    );
  }

  return (
    <section className="request-response card" id="help-response">
      <h2>{existing ? "Ваш отклик" : "Хочу помочь"}</h2>
      <p className="muted">
        Напишите коротко, чем можете помочь и как с вами связаться. Эти данные не публикуются.
      </p>

      <form action={action} className="grid">
        <input type="hidden" name="caseId" value={caseId} />

        <label>
          Чем вы можете помочь
          <textarea
            name="message"
            minLength={10}
            maxLength={1500}
            rows={5}
            required
            defaultValue={existing?.message ?? ""}
            placeholder="Например: могу привезти продукты вечером или помочь с документами онлайн."
          />
        </label>

        <label>
          Как с вами связаться
          <input
            name="contactMethod"
            minLength={2}
            maxLength={200}
            required
            defaultValue={existing?.contact_method ?? ""}
            placeholder="Telegram, телефон или другой удобный способ"
          />
        </label>

        <label className="consent-row">
          <input name="consent" type="checkbox" required />
          <span>
            Я согласен(-на), что сообщение и указанный способ связи будут доступны автору этой просьбы и назначенному координатору.
          </span>
        </label>

        <button className="btn" disabled={pending}>
          {pending
            ? "Отправляем…"
            : existing
              ? "Обновить отклик"
              : "Отправить отклик"}
        </button>
      </form>

      {state.message && (
        <p role={state.ok ? "status" : "alert"}>{state.message}</p>
      )}
    </section>
  );
}
