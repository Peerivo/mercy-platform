
import { getTranslations } from "@/lib/i18n/server";
import { serverSupabase } from "@/lib/supabase/server";
import { Nearby } from "@/components/nearby";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Помощь рядом"),
  description: t("Опубликованные и проверенные точки помощи."),
  alternates: { canonical: "/nearby" },
};
}

export default async function NearbyPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { t } = await getTranslations();

  const { city } = await searchParams;
  const s = await serverSupabase();

  let q = s
    .from("published_service_locations")
    .select(
      "id,organization_name,name,city,address_public,languages,formats,cost_type,contact_public,opening_hours"
    )
    .limit(50);

  if (city) {
    q = q.ilike("city", city);
  }

  const { data } = await q;

  return (
    <section className="page-shell section nearby-page">
      <div className="public-page-intro">
        <span className="request-section-kicker">{t("Проверенные точки")}</span>
        <h1>{t("Помощь рядом")}</h1>
        <p className="page-lead public-page-lead">{t("Здесь показываются только опубликованные и проверенные точки помощи. Конфиденциальные адреса и непроверенные контакты не публикуются.")}</p>
      </div>

      <form className="card nearby-search-card">
        <div className="form-section-heading">
          <span className="request-section-kicker">{t("Фильтр")}</span>
          <h2>{t("Выберите город")}</h2>
        </div>

        <div className="nearby-search-row">
          <label>{t("Город")}<input
              name="city"
              defaultValue={city}
              placeholder={t("Например, Москва")}
            />
          </label>
          <button className="btn secondary">{t("Показать список")}</button>
        </div>
      </form>

      <Nearby initial={(data || []).map((x) => ({ ...x, distance_meters: null }))} />
    </section>
  );
}
