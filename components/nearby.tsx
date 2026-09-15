"use client";

import { useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";

type Place = {
  id: string;
  organization_name: string;
  name: string;
  city: string;
  address_public: string | null;
  languages: string[];
  formats: string[];
  cost_type: string;
  distance_meters: number | null;
  contact_public: string | null;
  opening_hours: string | null;
};

export function Nearby({ initial }: { initial: Place[] }) {
  const [places, setPlaces] = useState(initial);
  const [status, setStatus] = useState("");
  const [map, setMap] = useState(false);

  async function locate() {
    if (!navigator.geolocation) {
      setStatus("Геолокация недоступна. Используйте фильтр города.");
      return;
    }

    setStatus("Запрашиваем местоположение…");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { data, error } = await browserSupabase().rpc("nearby_service_locations", {
          user_lat: position.coords.latitude,
          user_lon: position.coords.longitude,
          radius_m: 50000,
          result_limit: 50,
          result_offset: 0,
        });

        if (error) {
          setStatus("Не удалось выполнить поиск. Список остаётся доступен.");
        } else {
          setPlaces(data || []);
          setStatus("Расстояние указано по прямой.");
        }
      },
      () =>
        setStatus(
          "Доступ к геолокации не дан. Выберите город — каталог продолжает работать."
        ),
      { timeout: 8000 }
    );
  }

  return (
    <>
      <div className="nav nearby-actions">
        <button className="btn" onClick={locate}>
          Найти рядом со мной
        </button>
        <button className="btn secondary" onClick={() => setMap(true)}>
          Загрузить внешнюю карту
        </button>
      </div>

      <p aria-live="polite">{status}</p>

      {map && (
        <div className="notice">
          Карта использует провайдера, указанного в настройках. В MVP точки доступны списком даже при ошибке тайлов.
          Координаты посетителя не сохраняются и не добавляются в URL.
        </div>
      )}

      <div className="grid cols2">
        {places.length ? (
          places.map((place) => (
            <article className="card" key={place.id}>
              <h2>
                {place.organization_name}: {place.name}
              </h2>
              <p>
                {place.city}
                {place.address_public ? `, ${place.address_public}` : ""}
              </p>
              <p>
                {place.formats.join(", ")} · {place.cost_type} · {place.languages.join(", ")}
              </p>
              {place.distance_meters != null && (
                <p>{(place.distance_meters / 1000).toFixed(1)} км по прямой</p>
              )}
              <p>{place.opening_hours || "Часы работы не уточнены"}</p>
              <p>{place.contact_public}</p>
            </article>
          ))
        ) : (
          <div className="empty-state nearby-empty">
            <h2>Проверенных точек пока нет</h2>
            <p>
              Мы не показываем непроверенные контакты. Попробуйте другой город или вернитесь позже.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
