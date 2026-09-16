import { serverSupabase } from "@/lib/supabase/server";
import { Nearby } from "@/components/nearby";

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
    <section className="page-shell section">
      <h1>Помощь рядом</h1>
      <p className="page-lead">
        Здесь показываются только опубликованные и проверенные точки помощи.
        Конфиденциальные адреса и непроверенные контакты не публикуются.
      </p>

      <form className="search-form">
        <label>
          Город
          <input
            name="city"
            defaultValue={city}
            placeholder="Например, Батуми"
          />
        </label>
        <button className="btn secondary">Показать список</button>
      </form>

      <Nearby initial={(data || []).map((x) => ({ ...x, distance_meters: null }))} />
    </section>
  );
}
