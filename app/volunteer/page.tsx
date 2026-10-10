
import { getTranslations } from "@/lib/i18n/server";
import { createOffer } from "./actions";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Хочу помочь"),
  description: t("Предложите добровольную помощь людям, которым она нужна."),
  alternates: { canonical: "/volunteer" },
};
}

export default async function Volunteer({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { t } = await getTranslations();

  const q = await searchParams;

  return (
    <section className="page-shell section public-form-page volunteer-page">
      <div className="public-page-intro">
        <span className="request-section-kicker">{t("Предложение помощи")}</span>
        <h1>{t("Хочу помочь")}</h1>
        <p className="page-lead public-page-lead">{t("Расскажите, чем вы готовы помочь. Предложение увидят только вы и администратор; контактные данные публично не показываются.")}</p>
      </div>

      {q.error && (
        <p className="form-alert" role="alert">
          {q.error === "validation"
            ? t("Проверьте поля и подтвердите согласие.")
            : t("Не удалось сохранить предложение. Повторите позже.")}
        </p>
      )}

      <form action={createOffer} className="card grid public-form-card volunteer-form-card">
        <div className="form-section">
          <div className="form-section-heading">
            <span className="request-section-kicker">{t("Предложение")}</span>
            <h2>{t("Что и где вы можете сделать")}</h2>
          </div>

          <label>{t("Категория")}<select name="category" required defaultValue="">
              <option value="" disabled>{t("Выберите категорию")}</option>
              <option value="THINGS">{t("Вещи")}</option>
              <option value="TRANSPORT">{t("Транспорт")}</option>
              <option value="FOOD">{t("Продукты")}</option>
              <option value="CHILDCARE">{t("Краткая помощь с детьми")}</option>
              <option value="EDUCATION_WORK">{t("Учёба и работа")}</option>
              <option value="OTHER">{t("Другое")}</option>
            </select>
          </label>

          <div className="grid cols2 compact-form-grid">
            <label>{t("Страна")}<input name="country" required maxLength={80} />
            </label>
            <label>{t("Город")}<input
                name="city"
                maxLength={120}
                placeholder={t("Можно оставить пустым при помощи онлайн")}
              />
            </label>
          </div>

          <label className="compact-choice compact-choice-single">
            <input type="checkbox" name="online" />
            <span>{t("Могу помогать онлайн")}</span>
          </label>

          <label>{t("Что вы предлагаете")}<textarea
              name="description"
              minLength={20}
              maxLength={3000}
              required
              placeholder={t("Коротко опишите, чем можете помочь и в каком объёме")}
            />
          </label>
        </div>

        <div className="form-section">
          <div className="form-section-heading">
            <span className="request-section-kicker">{t("Связь")}</span>
            <h2>{t("Как с вами связаться")}</h2>
          </div>

          <label>{t("Предпочтительный способ связи")}<input
              name="contact_method"
              minLength={2}
              maxLength={200}
              required
              placeholder={t("Например, чат в кабинете")}
            />
          </label>
        </div>

        <div className="form-section form-section-consent">
          <label className="consent-row">
            <input type="checkbox" name="consent" required />
            <span>{t("Согласен(на) на обработку предложения и контактных данных для модерации и связи по этому предложению.")}</span>
          </label>
        </div>

        <div className="form-submit-row">
          <button className="btn">{t("Предложить помощь")}</button>
        </div>
      </form>
    </section>
  );
}
