"use client";

import { useState } from "react";
import { createRequest } from "./actions";
import { getRequestJurisdiction } from "@/lib/request-consent";

export function HelpForm() {
  const [country, setCountry] = useState("Россия");
  const [homeVisit, setHomeVisit] = useState(false);

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
            <input
              name="city"
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
          <span className="request-section-kicker">Безопасность визита</span>
          <h2>Если волонтёру нужно войти домой</h2>
        </div>

        <label className="compact-choice compact-choice-single">
          <input
            name="home_visit_required"
            type="checkbox"
            checked={homeVisit}
            onChange={(event) => setHomeVisit(event.target.checked)}
          />
          <span>Для этой помощи волонтёру потребуется войти в дом или квартиру</span>
        </label>

        {homeVisit && (
          <>
            <p className="muted form-help-text">
              Чтобы подобрать подходящего волонтёра и сделать встречу безопасной
              и комфортной для всех, расскажите об условиях дома. У волонтёров
              могут быть аллергии, страх животных и другие ограничения. Эти
              сведения не публикуются и используются только для организации помощи.
            </p>

            <label>
              Кто живёт или может находиться дома во время визита
              <textarea name="visit_household_members" required minLength={2} maxLength={1000} rows={3}
                placeholder="Например: живу одна; днём может быть дочь" />
            </label>

            <div className="compact-choice-grid">
              <label className="compact-choice"><input name="dogs_present" type="checkbox" />Есть собака</label>
              <label className="compact-choice"><input name="cats_present" type="checkbox" />Есть кошка</label>
              <label className="compact-choice"><input name="smoking_present" type="checkbox" />В помещении курят</label>
            </div>

            <label>
              Животные и что о них важно знать
              <textarea name="visit_animals_notes" required minLength={2} maxLength={1000} rows={3}
                placeholder="Если животных нет — так и напишите. Если есть, укажите особенности и можно ли изолировать их на время визита." />
            </label>

            <label>
              Аллергены, дым и другие особенности воздуха
              <textarea name="visit_allergen_notes" required minLength={2} maxLength={1000} rows={3}
                placeholder="Напишите «нет», если особенностей нет." />
            </label>

            <label>
              Что учесть при входе и передвижении по дому
              <textarea name="visit_access_notes" required minLength={2} maxLength={1000} rows={3}
                placeholder="Например: нет лифта, высокий этаж, узкая лестница. Точный адрес здесь не указывайте." />
            </label>

            <label>
              Родственник или доверенный контакт (необязательно)
              <input name="visit_trusted_contact" maxLength={240} placeholder="Имя и удобный способ связи" />
            </label>

            <label className="compact-choice compact-choice-single">
              <input name="video_call_possible" type="checkbox" />
              <span>Могу провести короткий видеозвонок перед первым домашним визитом</span>
            </label>

            <label>
              Что ещё важно знать волонтёру (необязательно)
              <textarea name="visit_other_notes" maxLength={1500} rows={3} />
            </label>

            <label className="consent-row">
              <input name="visit_safety_acknowledged" type="checkbox" required />
              <span>
                Я указал(а) важные условия домашнего визита и понимаю, что эти
                сведения нужны для безопасного и уважительного подбора волонтёра.
              </span>
            </label>
          </>
        )}
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
