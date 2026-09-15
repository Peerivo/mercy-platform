"use client";

import { useState } from "react";
import { createRequest } from "./actions";
import { getRequestJurisdiction } from "@/lib/request-consent";

export function HelpForm() {
  const [country, setCountry] = useState("Россия");

  const jurisdiction = getRequestJurisdiction(country);

  return (
    <form action={createRequest} className="card grid">
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

      <div className="grid cols2">
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

      <p className="muted">
        Не публикуйте телефон, email, точный адрес,
        документы, диагнозы, результаты анализов и другие
        чувствительные персональные данные.
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
        <input name="can_message" type="checkbox" defaultChecked />
        Можно писать
      </label>

      <label>
        <input name="can_call" type="checkbox" />
        Можно звонить
      </label>

      <label>
        Подходящее время
        <input name="contact_window" maxLength={120} />
      </label>

      <label>
        Внешний контакт (необязательно)
        <input name="external_contact" maxLength={200} />
      </label>

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

      <button className="btn">Опубликовать просьбу</button>
    </form>
  );
}