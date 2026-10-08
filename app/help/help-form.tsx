"use client";

import { useActionState, useState } from "react";
import { createRequest } from "./actions";
import { getRequestJurisdiction } from "@/lib/request-consent";

export function HelpForm() {
  const [country, setCountry] = useState("Россия");
  // Sensitive user content stays in this component only: no localStorage, analytics,
  // URL parameters, session recording or server echo on validation errors.
  const [draft, setDraft] = useState({
    category: "PREGNANCY",
    city: "",
    description: "",
    urgency: "NORMAL",
    canMessage: true,
    canCall: false,
    contactWindow: "",
    externalContact: "",
    consent: false,
  });
  const [state, submit, pending] = useActionState(createRequest, { ok: false, message: "" });

  const jurisdiction = getRequestJurisdiction(country);

  return (
    <form action={submit} className="card grid public-form-card help-form-card" aria-busy={pending}>
      {state.message ? <p className="form-alert" role="alert">{state.message}</p> : null}
      <div className="form-section">
        <div className="form-section-heading">
          <span className="request-section-kicker">Просьба</span>
          <h2>Что и где нужно</h2>
        </div>

        <label>
          Категория
          <select name="category" required value={draft.category} onChange={e => setDraft(current => ({ ...current, category: e.target.value }))}>
            <option value="PREGNANCY">Беременность и материнство</option>
            <option value="FAMILY">Семья</option>
            <option value="HOUSING">Жильё</option>
            <option value="FOOD_GOODS">Продукты и вещи</option>
            <option value="LEGAL_DOCUMENTS">Документы и право</option>
            <option value="WORK_EDUCATION">Работа и обучение</option>
            <option value="OTHER">Другое</option>
          </select>
        </label>

        <div className="grid cols2 compact-form-grid">
          <label>
            Страна
            <input
              name="country"
              autoComplete="country-name"
              required
              maxLength={80}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>

          <label>
            Город
            <input
              name="city"
              autoComplete="address-level2"
              value={draft.city}
              onChange={e => setDraft(current => ({ ...current, city: e.target.value }))}
              required
              maxLength={120}
              placeholder="Например, Москва"
            />
          </label>
        </div>

        <label>
          Описание
          <textarea
            name="description"
            value={draft.description}
            onChange={e => setDraft(current => ({ ...current, description: e.target.value }))}
            autoComplete="off"
            required
            minLength={20}
            maxLength={5000}
            rows={7}
          />
        </label>

        <p className="muted form-help-text">
          Не публикуйте телефон, email, точный адрес, документы, диагнозы,
          результаты анализов и другие чувствительные персональные данные.
          Медицинские услуги не оказываются через Mercy.
        </p>

        <label>
          Срочность
          <select name="urgency" value={draft.urgency} onChange={e => setDraft(current => ({ ...current, urgency: e.target.value }))}>
            <option value="NORMAL">Обычная</option>
            <option value="SOON">Желательно скоро</option>
            <option value="URGENT">Срочно</option>
          </select>
        </label>
      </div>

      <div className="form-section">
        <div className="form-section-heading">
          <span className="request-section-kicker">Связь</span>
          <h2>Как с вами связаться</h2>
        </div>

        <div className="compact-choice-grid">
          <label className="compact-choice">
            <input name="can_message" type="checkbox" checked={draft.canMessage} onChange={e => setDraft(current => ({ ...current, canMessage: e.target.checked }))} />
            Можно писать
          </label>

          <label className="compact-choice">
            <input name="can_call" type="checkbox" checked={draft.canCall} onChange={e => setDraft(current => ({ ...current, canCall: e.target.checked }))} />
            Можно звонить
          </label>
        </div>

        <div className="grid cols2 compact-form-grid">
          <label>
            Подходящее время
            <input name="contact_window" maxLength={120} value={draft.contactWindow} autoComplete="off"
              onChange={e => setDraft(current => ({ ...current, contactWindow: e.target.value }))} />
          </label>

          <label>
            Внешний контакт (необязательно)
            <input name="external_contact" maxLength={200} value={draft.externalContact} autoComplete="off"
              onChange={e => setDraft(current => ({ ...current, externalContact: e.target.value }))} />
          </label>
        </div>
      </div>

      <div className="form-section form-section-consent">
        <label className="consent-row">
          <input name="consent" type="checkbox" checked={draft.consent} onChange={e => setDraft(current => ({ ...current, consent: e.target.checked }))} required />

          <span>
            Я согласен(-на) на обработку данных обращения в соответствии с{" "}
            <a
              href={`/consent/request?country=${jurisdiction}`}
              target="_blank"
              rel="noreferrer"
            >
              условиями обработки персональных данных
            </a>
            .
          </span>
        </label>
      </div>

      <div className="form-submit-row">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Сохраняем…" : "Опубликовать просьбу"}
        </button>
      </div>
    </form>
  );
}
