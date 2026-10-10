
import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { getDonationProvider } from "@/lib/donations";
import styles from "./donate.module.css";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Поддержать проект — Язык милосердия"),
  description:
    t("Добровольная поддержка работы и развития проекта «Язык милосердия»."),
};
}

export default async function DonatePage() {
  const { t } = await getTranslations();

  const provider = getDonationProvider();

  return (
    <section className="page-shell section">
      <div className="public-page-intro">
        <span className="status-pill">{t("Поддержка проекта")}</span>
        <h1>{t("Поддержать «Язык милосердия»")}</h1>
        <p className="public-page-lead">{t("Если проект вам полезен, вы можете добровольно поддержать его работу и развитие. Пожертвование не является оплатой товара или услуги и не даёт преимуществ при получении помощи.")}</p>
      </div>

      <div className={styles.layout}>
        <article className="card">
          <h2>{t("На что идёт поддержка")}</h2>
          <ul className={styles.list}>
            <li>{t("работа и развитие сайта;")}</li>
            <li>{t("модерация и проверка новых просьб;")}</li>
            <li>{t("инфраструктура и технические расходы;")}</li>
            <li>{t("развитие механизмов безопасной помощи людям.")}</li>
          </ul>

          <div className={styles.actions}>
            {provider.isConfigured && provider.href ? (
              <a
                className="btn"
                href={provider.href}
                target="_blank"
                rel="noopener noreferrer"
              >{t("Перейти к пожертвованию")}</a>
            ) : (
              <Link className="btn secondary" href="/feedback?topic=support">{t("Написать о поддержке")}</Link>
            )}
          </div>

          {provider.isConfigured ? (
            <p className={styles.providerNote}>{t("Перевод оформляется на стороне")}{" "}{provider.name}{t(". Mercy не получает и не хранит данные вашей банковской карты.")}</p>
          ) : (
            <div className="notice">{t("Онлайн-пожертвования временно недоступны. Вы можете написать проекту через форму связи.")}</div>
          )}
        </article>

        <aside className="card">
          <h2>{t("Важно")}</h2>
          <p>{t("Эта страница предназначена только для поддержки самого проекта. Деньги на конкретные просьбы о помощи через неё не собираются.")}</p>
          <p>{t("Если вы хотите помочь конкретному человеку, используйте механизм отклика на его просьбу. Mercy не смешивает средства проекта и адресную помощь.")}</p>
          <p className="muted">{t("Поддержка добровольна. Отправитель не получает товар, услугу или особый доступ к платформе взамен.")}</p>
          {provider.kind === "individual" && (
            <p className="muted">{t("При переводе физическому лицу мы не обещаем благотворительный налоговый вычет.")}</p>
          )}
        </aside>
      </div>

      <div className={styles.secondary}>
        <h2>{t("Другой способ поддержки")}</h2>
        <p>{t("Если вы хотите предложить партнёрство, регулярную поддержку или помощь проекту как организация, напишите нам через форму обратной связи.")}</p>
        <Link href="/feedback?topic=support">{t("Связаться с проектом")}</Link>
      </div>
    </section>
  );
}
