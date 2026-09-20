import { RussianCityInput } from "@/components/russian-city-input";
import { createOffer } from "./actions";

export default async function Volunteer({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;

  return (
    <section className="page-shell section public-form-page volunteer-page">
      <div className="public-page-intro">
        <span className="request-section-kicker">Предложение помощи</span>
        <h1>Хочу помочь</h1>
        <p className="page-lead public-page-lead">
          Расскажите, чем вы готовы помочь. Предложение увидят только вы и
          администратор; контактные данные публично не показываются.
        </p>
      </div>

      {q.error && (
        <p className="form-alert" role="alert">
          {q.error === "validation"
            ? "Проверьте поля и подтвердите согласие."
            : q.error === "locality"
              ? "Не удалось подтвердить населённый пункт по ГАР/ФИАС. Проверьте название."
              : q.error === "locality-service"
                ? "Сервис проверки населённого пункта временно недоступен. Выберите населённый пункт из подсказок или повторите позже."
                : "Не удалось сохранить предложение. Повторите позже."}
        </p>
      )}

      <form action={createOffer} className="card grid public-form-card volunteer-form-card">
        <div className="form-section">
          <div className="form-section-heading">
            <span className="request-section-kicker">Предложение</span>
            <h2>Что и где вы можете сделать</h2>
          </div>

          <label>
            Категория
            <select name="category" required defaultValue="">
              <option value="" disabled>
                Выберите категорию
              </option>
              <option value="THINGS">Вещи</option>
              <option value="TRANSPORT">Транспорт</option>
              <option value="FOOD">Продукты</option>
              <option value="CHILDCARE">Краткая помощь с детьми</option>
              <option value="EDUCATION_WORK">Учёба и работа</option>
              <option value="OTHER">Другое</option>
            </select>
          </label>

          <div className="grid cols2 compact-form-grid">
            <label>
              Страна
              <input name="country" required maxLength={80} defaultValue="Россия" />
            </label>
            <label>
              Населённый пункт
              <RussianCityInput
                name="city"
                maxLength={120}
                placeholder="Например, Псебай или Москва"
              />
              <small className="muted">
                Можно ввести свой населённый пункт; при отправке проверим его по ГАР/ФИАС.
              </small>
            </label>
          </div>

          <label className="compact-choice compact-choice-single">
            <input type="checkbox" name="online" />
            <span>Могу помогать онлайн</span>
          </label>

          <label>
            Что вы предлагаете
            <textarea
              name="description"
              minLength={20}
              maxLength={3000}
              required
              placeholder="Коротко опишите, чем можете помочь и в каком объёме"
            />
          </label>
        </div>

        <div className="form-section">
          <div className="form-section-heading">
            <span className="request-section-kicker">Связь</span>
            <h2>Как с вами связаться</h2>
          </div>

          <label>
            Предпочтительный способ связи
            <input
              name="contact_method"
              minLength={2}
              maxLength={200}
              required
              placeholder="Например, чат в кабинете"
            />
          </label>
        </div>

        <div className="form-section form-section-consent">
          <label className="consent-row">
            <input type="checkbox" name="consent" required />
            <span>
              Согласен(на) на обработку предложения и контактных данных для
              модерации и связи по этому предложению.
            </span>
          </label>
        </div>

        <div className="form-submit-row">
          <button className="btn">Предложить помощь</button>
        </div>
      </form>
    </section>
  );
}
