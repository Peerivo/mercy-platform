import { createOffer } from "./actions";

export default async function Volunteer({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;

  return (
    <section className="page-shell section">
      <h1>Хочу помочь</h1>
      <p className="page-lead">
        Расскажите, чем вы готовы помочь. Предложение увидят только вы и администратор;
        контактные данные публично не показываются.
      </p>

      {q.error && (
        <p role="alert">
          {q.error === "validation"
            ? "Проверьте поля и подтвердите согласие."
            : "Не удалось сохранить предложение. Повторите позже."}
        </p>
      )}

      <form action={createOffer} className="card grid">
        <label>
          Категория
          <select name="category" required defaultValue="">
            <option value="" disabled>Выберите категорию</option>
            <option value="THINGS">Вещи</option>
            <option value="TRANSPORT">Транспорт</option>
            <option value="FOOD">Продукты</option>
            <option value="CHILDCARE">Краткая помощь с детьми</option>
            <option value="EDUCATION_WORK">Учёба и работа</option>
            <option value="OTHER">Другое</option>
          </select>
        </label>

        <div className="grid cols2">
          <label>
            Страна
            <input name="country" required maxLength={80} />
          </label>
          <label>
            Город
            <input name="city" maxLength={120} placeholder="Можно оставить пустым при помощи онлайн" />
          </label>
        </div>

        <label>
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

        <label className="consent-row">
          <input type="checkbox" name="consent" required />
          <span>
            Согласен(на) на обработку предложения и контактных данных для модерации и связи по этому предложению.
          </span>
        </label>

        <div className="form-actions">
          <button className="btn">Предложить помощь</button>
        </div>
      </form>
    </section>
  );
}
