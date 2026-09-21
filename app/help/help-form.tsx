"use client";

import { useState } from "react";
import { createRequest } from "./actions";
import { getRequestJurisdiction } from "@/lib/request-consent";

export function HelpForm() {
  const [country, setCountry] = useState("Россия");
  const [beneficiaryScope, setBeneficiaryScope] =
    useState<"SELF" | "OTHER">("SELF");

  const jurisdiction = getRequestJurisdiction(country);

  return (
    <form action={createRequest} className="card grid public-form-card help-form-card">
      <div className="form-section">
        <div className="form-section-heading">
          <span className="request-section-kicker">Просьба</span>
          <h2>Что и где нужно</h2>
        </div>

        <label>
          Категория
          <select name="category" required>
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
              required
              maxLength={80}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>

          <label>
            Город
            <input name="city" required maxLength={120} />
          </label>
        </div>

        <label>
          Описание
          <textarea
            name="description"
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
          <select name="urgency">
            <option value="NORMAL">Обычная</option>
            <option value="SOON">Желательно скоро</option>
            <option value="URGENT">Срочно</option>
          </select>
        </label>

        <label>
          Кому нужна помощь
          <select
            name="beneficiary_scope"
            value={beneficiaryScope}
            onChange={(event) =>
              setBeneficiaryScope(event.target.value as "SELF" | "OTHER")
            }
          >
            <option value="SELF">Мне</option>
            <option value="OTHER">Другому человеку</option>
          </select>
        </label>

        {beneficiaryScope === "OTHER" && (
          <label className="consent-row">
            <input
              name="beneficiary_consent_attested"
              type="checkbox"
              required
            />
            <span>
              Я подтверждаю, что человек знает о размещении этой просьбы и
              согласен принять помощь. Перед публикацией модератор попросит
              отдельно подтвердить это согласие.
            </span>
          </label>
        )}

        <label>
          Формат помощи
          <select name="interaction_mode" defaultValue="REMOTE_OR_PUBLIC">
            <option value="REMOTE_OR_PUBLIC">
              Без входа домой / онлайн / общественное место
            </option>
            <option value="HOME_VISIT">Нужен визит домой</option>
          </select>
        </label>

        <p className="muted form-help-text">
          Домашний визит проходит усиленную проверку. Обычный прямой отклик на
          такую просьбу не открывается — нужен координатор. Подробнее:{" "}
          <a href="/safety">как устроена безопасность Mercy</a>.
        </p>
      </div>

      <div className="form-section">
        <div className="form-section-heading">
          <span className="request-section-kicker">Связь</span>
          <h2>Как с вами связаться</h2>
        </div>

        <div className="compact-choice-grid">
          <label className="compact-choice">
            <input name="can_message" type="checkbox" defaultChecked />
            Можно писать
          </label>

          <label className="compact-choice">
            <input name="can_call" type="checkbox" />
            Можно звонить
          </label>
        </div>

        <div className="grid cols2 compact-form-grid">
          <label>
            Подходящее время
            <input name="contact_window" maxLength={120} />
          </label>

          <label>
            Внешний контакт (необязательно)
            <input name="external_contact" maxLength={200} />
          </label>
        </div>
      </div>

      <div className="form-section form-section-consent">
        <label className="consent-row">
          <input name="consent" type="checkbox" required />

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
        <button className="btn">Отправить на проверку</button>
      </div>
    </form>
  );
}