import { serverSupabase } from "@/lib/supabase/server";
import { Nearby } from "@/components/nearby";
import { RussianCityInput } from "@/components/russian-city-input";

export default async function NearbyPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
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
        <span className="request-section-kicker">Проверенные точки</span>
        <h1>Помощь рядом</h1>
        <p className="page-lead public-page-lead">
          Здесь показываются только опубликованные и проверенные точки помощи.
          Конфиденциальные адреса и непроверенные контакты не публикуются.
        </p>
      </div>

      <form className="card nearby-search-card">
        <div className="form-section-heading">
          <span className="request-section-kicker">Фильтр</span>
          <h2>Выберите населённый пункт</h2>
        </div>

        <div className="nearby-search-row">
          <label>
            Населённый пункт
            <RussianCityInput
              name="city"
              defaultValue={city}
              placeholder="Например, Псебай или Москва"
            />
          </label>
          <button className="btn secondary">Показать список</button>
        </div>
      </form>

      <Nearby initial={(data || []).map((x) => ({ ...x, distance_meters: null }))} />
    </section>
  );
}
