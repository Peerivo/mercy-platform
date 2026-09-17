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
    <div className="nearby-results-block">
      <div className="request-section-heading nearby-results-heading">
        <div>
          <span className="request-section-kicker">Точки помощи</span>
          <h2>Доступные варианты</h2>
        </div>
        <p>Можно использовать город или определить расстояние от текущего местоположения.</p>
      </div>

      <div className="nav nearby-actions">
        <button className="btn" onClick={locate}>
          Найти рядом со мной
        </button>
        <button className="btn secondary" onClick={() => setMap(true)}>
          Загрузить внешнюю карту
        </button>
      </div>

      {status && (
        <p className="nearby-status" aria-live="polite">
          {status}
        </p>
      )}

      {map && (
        <div className="notice nearby-map-notice">
          Карта использует провайдера, указанного в настройках. В MVP точки
          доступны списком даже при ошибке тайлов. Координаты посетителя не
          сохраняются и не добавляются в URL.
        </div>
      )}

      <div className="grid cols2 nearby-list">
        {places.length ? (
          places.map((place) => (
            <article className="card nearby-card" key={place.id}>
              <h2>
                {place.organization_name}: {place.name}
              </h2>

              <p className="nearby-card-location">
                {place.city}
                {place.address_public ? `, ${place.address_public}` : ""}
              </p>

              <p className="nearby-card-meta">
                {place.formats.join(", ")} · {place.cost_type} ·{" "}
                {place.languages.join(", ")}
              </p>

              {place.distance_meters != null && (
                <p className="nearby-card-distance">
                  {(place.distance_meters / 1000).toFixed(1)} км по прямой
                </p>
              )}

              <p className="nearby-card-hours">
                {place.opening_hours || "Часы работы не уточнены"}
              </p>

              {place.contact_public && (
                <p className="nearby-card-contact">{place.contact_public}</p>
              )}
            </article>
          ))
        ) : (
          <div className="empty-state nearby-empty">
            <h2>Проверенных точек пока нет</h2>
            <p>
              Мы не показываем непроверенные контакты. Попробуйте другой город
              или вернитесь позже.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
