"use client";

import { useState } from "react";
import { createRequest } from "./actions";
import { getRequestJurisdiction } from "@/lib/request-consent";
import { RussianCityInput } from "@/components/russian-city-input";

export function HelpForm() {
  const [country, setCountry] = useState("Россия");

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
            Населённый пункт
            <RussianCityInput
              name="city"
              required
              maxLength={120}
              placeholder="Например, Псебай или Москва"
            />
            <small className="muted">
              Если населённого пункта нет в подсказках, введите его вручную — при отправке проверим название по ГАР/ФИАС.
            </small>
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
        <button className="btn">Опубликовать просьбу</button>
      </div>
    </form>
  );
}