"use client";
import { useLocale } from "@/components/locale-provider";


import { useActionState, useState } from "react";
import { createRequest, type RequestActionState } from "./actions";
import { getRequestJurisdiction } from "@/lib/request-consent";

export function HelpForm() {
  const { t, locale } = useLocale();

  const [fields, setFields] = useState(() => ({
    category: "PREGNANCY", country: locale === "ka" ? "საქართველო" : "Россия",
    city: "", description: "", urgency: "NORMAL", contact_window: "", external_contact: "",
  }));
  const [choices, setChoices] = useState({ can_message: true, can_call: false, consent: false });
  const [state, action, pending] = useActionState(createRequest, {} as RequestActionState);
  const country = fields.country;
  function textField(name: keyof typeof fields) {
    return {
      value: fields[name],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setFields(previous => ({ ...previous, [name]: event.target.value })),
      "aria-invalid": Boolean(state.fieldErrors?.[name]),
      "aria-describedby": state.fieldErrors?.[name] ? `error-${name}` : undefined,
    };
  }
  function checkbox(name: keyof typeof choices) {
    return {
      checked: choices[name],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setChoices(previous => ({ ...previous, [name]: event.target.checked })),
      "aria-invalid": Boolean(state.fieldErrors?.[name]),
      "aria-describedby": state.fieldErrors?.[name] ? `error-${name}` : undefined,
    };
  }
  function fieldError(name: string) {
    const message = state.fieldErrors?.[name];
    return message ? <span id={`error-${name}`} className="field-error">{t(message)}</span> : null;
  }

  const jurisdiction = getRequestJurisdiction(country);

  return (
    // Failed actions keep this draft. React's native reset would revert select/checkbox DOM defaults.
    <form action={action} onReset={event => event.preventDefault()} noValidate aria-busy={pending} className="card grid public-form-card help-form-card">
      {state.error && <div className="form-alert" role="alert">
        {t(state.error === "validation"
          ? "Проверьте отмеченные поля. Введённые данные сохранены в этой форме."
          : state.error === "auth"
            ? "Для публикации войдите в аккаунт. Не закрывайте эту форму: введённые данные останутся здесь."
            : "Не удалось сохранить просьбу. Ваш текст остался в форме. Попробуйте ещё раз.")}
        {state.error === "auth" && <p><a href="/auth?next=%2Fhelp" target="_blank" rel="noopener noreferrer">{t("Войти в новой вкладке")}</a></p>}
      </div>}
      <fieldset disabled={pending} className="help-form-fields">
      <div className="form-section">
        <div className="form-section-heading">
          <span className="request-section-kicker">{t("Просьба")}</span>
          <h2>{t("Что и где нужно")}</h2>
        </div>

        <label>{t("Категория")}<select name="category" {...textField("category")} required>
            <option value="PREGNANCY">{t("Беременность и материнство")}</option>
            <option value="FAMILY">{t("Семья")}</option>
            <option value="HOUSING">{t("Жильё")}</option>
            <option value="FOOD_GOODS">{t("Продукты и вещи")}</option>
            <option value="LEGAL_DOCUMENTS">{t("Документы и право")}</option>
            <option value="WORK_EDUCATION">{t("Работа и обучение")}</option>
            <option value="OTHER">{t("Другое")}</option>
          </select>{fieldError("category")}
        </label>

        <div className="grid cols2 compact-form-grid">
          <label>{t("Страна")}<input
              name="country" {...textField("country")}
              required
              maxLength={80}
            />{fieldError("country")}
          </label>

          <label>{t("Город")}<input
              name="city" {...textField("city")}
              required
              maxLength={120}
              placeholder={t("Например, Москва")}
            />{fieldError("city")}
          </label>
        </div>

        <label>{t("Описание")}<textarea
            name="description" {...textField("description")}
            required
            minLength={20}
            maxLength={5000}
            rows={7}
          />{fieldError("description")}
        </label>

        <p className="muted form-help-text">{t("Не публикуйте телефон, email, точный адрес, документы, диагнозы, результаты анализов и другие чувствительные персональные данные. Медицинские услуги не оказываются через Mercy.")}</p>

        <label>{t("Срочность")}<select name="urgency" {...textField("urgency")}>
            <option value="NORMAL">{t("Обычная")}</option>
            <option value="SOON">{t("Желательно скоро")}</option>
            <option value="URGENT">{t("Срочно")}</option>
          </select>{fieldError("urgency")}
        </label>
      </div>

      <div className="form-section">
        <div className="form-section-heading">
          <span className="request-section-kicker">{t("Связь")}</span>
          <h2>{t("Как с вами связаться")}</h2>
        </div>

        <div className="compact-choice-grid">
          <label className="compact-choice">
            <input name="can_message" {...checkbox("can_message")} type="checkbox" />{t("Можно писать")}</label>

          <label className="compact-choice">
            <input name="can_call" {...checkbox("can_call")} type="checkbox" />{t("Можно звонить")}</label>
        </div>

        <div className="grid cols2 compact-form-grid">
          <label>{t("Подходящее время")}<input name="contact_window" {...textField("contact_window")} maxLength={120} />{fieldError("contact_window")}
          </label>

          <label>{t("Внешний контакт (необязательно)")}<input name="external_contact" {...textField("external_contact")} maxLength={200} />{fieldError("external_contact")}
          </label>
        </div>
      </div>

      <div className="form-section form-section-consent">
        <label className="consent-row">
          <input name="consent" {...checkbox("consent")} type="checkbox" required />

          <span>{t("Я согласен(-на) на обработку данных обращения в соответствии с")}{" "}
            <a
              href={`/consent/request?country=${jurisdiction}`}
              target="_blank"
              rel="noreferrer"
            >{t("условиями обработки персональных данных")}</a>
            .
          </span>
          {fieldError("consent")}
        </label>
      </div>

      </fieldset>
      <div className="form-submit-row">
        <button className="btn" disabled={pending}>{t(pending ? "Публикуем…" : "Опубликовать просьбу")}</button>
      </div>
    </form>
  );
}
