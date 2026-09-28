"use client";

import { useEffect, useRef, useState } from "react";
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
  longitude: number | null;
  latitude: number | null;
};

type LngLat = [number, number];

type YMapInstance = {
  addChild(child: unknown): YMapInstance;
  destroy(): void;
};

type YMaps3Api = {
  ready: Promise<void>;
  YMap: new (
    root: HTMLElement,
    props: { location: { center: LngLat; zoom: number } }
  ) => YMapInstance;
  YMapDefaultSchemeLayer: new () => unknown;
  YMapDefaultFeaturesLayer: new (props?: { zIndex?: number }) => unknown;
  YMapMarker: new (
    props: { coordinates: LngLat },
    element?: HTMLElement
  ) => unknown;
};

declare global {
  interface Window {
    ymaps3?: YMaps3Api;
  }
}

let yandexMapsLoader: Promise<YMaps3Api> | null = null;

function loadYandexMaps(apiKey: string) {
  if (window.ymaps3) {
    return window.ymaps3.ready.then(() => window.ymaps3 as YMaps3Api);
  }

  if (yandexMapsLoader) return yandexMapsLoader;

  yandexMapsLoader = new Promise<YMaps3Api>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-mercy-yandex-maps="true"]'
    );
    const script = existing ?? document.createElement("script");

    const finish = async () => {
      try {
        if (!window.ymaps3) throw new Error("Yandex Maps API did not initialize");
        await window.ymaps3.ready;
        resolve(window.ymaps3);
      } catch (error) {
        yandexMapsLoader = null;
        reject(error);
      }
    };

    if (existing) {
      if (window.ymaps3) {
        void finish();
      } else {
        existing.addEventListener("load", () => void finish(), { once: true });
        existing.addEventListener(
          "error",
          () => {
            yandexMapsLoader = null;
            reject(new Error("Yandex Maps API failed to load"));
          },
          { once: true }
        );
      }
      return;
    }

    script.dataset.mercyYandexMaps = "true";
    script.async = true;
    script.src =
      "https://api-maps.yandex.ru/v3/?apikey=" +
      encodeURIComponent(apiKey) +
      "&lang=ru_RU";
    script.addEventListener("load", () => void finish(), { once: true });
    script.addEventListener(
      "error",
      () => {
        yandexMapsLoader = null;
        reject(new Error("Yandex Maps API failed to load"));
      },
      { once: true }
    );
    document.head.appendChild(script);
  });

  return yandexMapsLoader;
}

function publicMapPoints(places: Place[]) {
  return places.flatMap((place) =>
    Number.isFinite(place.longitude) && Number.isFinite(place.latitude)
      ? [
          {
            place,
            coordinates: [place.longitude as number, place.latitude as number] as LngLat,
          },
        ]
      : []
  );
}

function mapLocation(points: Array<{ coordinates: LngLat }>) {
  const longitudes = points.map((point) => point.coordinates[0]);
  const latitudes = points.map((point) => point.coordinates[1]);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const spread = Math.max(maxLon - minLon, maxLat - minLat);

  let zoom = 12;
  if (spread > 50) zoom = 2;
  else if (spread > 20) zoom = 3;
  else if (spread > 10) zoom = 4;
  else if (spread > 5) zoom = 5;
  else if (spread > 2) zoom = 6;
  else if (spread > 1) zoom = 7;
  else if (spread > 0.5) zoom = 8;
  else if (spread > 0.2) zoom = 9;
  else if (spread > 0.1) zoom = 10;
  else if (spread > 0.05) zoom = 11;

  return {
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2] as LngLat,
    zoom,
  };
}

export function Nearby({ initial }: { initial: Place[] }) {
  const [places, setPlaces] = useState(initial);
  const [status, setStatus] = useState("");
  const [mapRequested, setMapRequested] = useState(false);
  const [mapStatus, setMapStatus] = useState("");
  const mapRoot = useRef<HTMLDivElement | null>(null);
  const yandexApiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? "";

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
          return;
        }

        const nearby = (data || []) as Omit<Place, "longitude" | "latitude">[];
        const ids = nearby.map((place) => place.id);
        let coordinates = new Map<
          string,
          { longitude: number | null; latitude: number | null }
        >();

        if (ids.length) {
          const result = await browserSupabase()
            .from("published_service_locations")
            .select("id,longitude,latitude")
            .in("id", ids);

          if (!result.error) {
            coordinates = new Map(
              (result.data || []).map((row) => [
                row.id,
                {
                  longitude: row.longitude,
                  latitude: row.latitude,
                },
              ])
            );
          }
        }

        setPlaces(
          nearby.map((place) => ({
            ...place,
            longitude: coordinates.get(place.id)?.longitude ?? null,
            latitude: coordinates.get(place.id)?.latitude ?? null,
          }))
        );
        setStatus("Расстояние указано по прямой.");
      },
      () =>
        setStatus(
          "Доступ к геолокации не дан. Выберите город — каталог продолжает работать."
        ),
      { timeout: 8000 }
    );
  }

  function showMap() {
    const points = publicMapPoints(places);
    if (!points.length) {
      setMapStatus("Для текущего списка нет опубликованных координат.");
      return;
    }
    if (!yandexApiKey) {
      setMapStatus(
        "Карта Яндекса подготовлена, но для неё ещё не задан публичный API-ключ."
      );
      return;
    }
    setMapStatus("Загружаем карту Яндекса…");
    setMapRequested(true);
  }

  useEffect(() => {
    if (!mapRequested || !mapRoot.current || !yandexApiKey) return;

    let active = true;
    let map: YMapInstance | null = null;
    const root = mapRoot.current;
    const points = publicMapPoints(places);

    if (!points.length) {
      setMapStatus("Для текущего списка нет опубликованных координат.");
      return;
    }

    void loadYandexMaps(yandexApiKey)
      .then((ymaps3) => {
        if (!active) return;

        root.replaceChildren();
        map = new ymaps3.YMap(root, {
          location: mapLocation(points),
        });
        map
          .addChild(new ymaps3.YMapDefaultSchemeLayer())
          .addChild(new ymaps3.YMapDefaultFeaturesLayer({ zIndex: 1800 }));

        points.forEach(({ place, coordinates }, index) => {
          const marker = document.createElement("button");
          marker.type = "button";
          marker.className = "nearby-map-marker";
          marker.textContent = String(index + 1);
          marker.title = `${place.organization_name}: ${place.name}`;
          marker.setAttribute(
            "aria-label",
            `Точка ${index + 1}: ${place.organization_name}, ${place.name}`
          );
          marker.addEventListener("click", () => {
            document
              .getElementById(`nearby-place-${place.id}`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
          map?.addChild(
            new ymaps3.YMapMarker(
              {
                coordinates,
              },
              marker
            )
          );
        });

        setMapStatus(
          `На карте показано точек: ${points.length}. Координаты посетителя Яндексу не передаются.`
        );
      })
      .catch(() => {
        if (active) {
          setMapStatus(
            "Карта Яндекса не загрузилась. Список точек остаётся доступен."
          );
        }
      });

    return () => {
      active = false;
      map?.destroy();
      root.replaceChildren();
    };
  }, [mapRequested, places, yandexApiKey]);

  const mapNumbers = new Map(
    publicMapPoints(places).map(({ place }, index) => [place.id, index + 1])
  );

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
        <button className="btn secondary" onClick={showMap}>
          Показать карту Яндекса
        </button>
      </div>

      {status && (
        <p className="nearby-status" aria-live="polite">
          {status}
        </p>
      )}

      {(mapRequested || mapStatus) && (
        <div className="nearby-map-wrap">
          {mapRequested && (
            <div
              className="nearby-map"
              ref={mapRoot}
              aria-label="Карта опубликованных точек помощи"
            />
          )}
          {mapStatus && (
            <p className="nearby-map-caption" aria-live="polite">
              {mapStatus}
            </p>
          )}
        </div>
      )}

      <div className="grid cols2 nearby-list">
        {places.length ? (
          places.map((place) => (
            <article
              className="card nearby-card"
              id={`nearby-place-${place.id}`}
              key={place.id}
            >
              <h2>
                {mapNumbers.has(place.id) && (
                  <span className="nearby-card-map-number">
                    {mapNumbers.get(place.id)}.{" "}
                  </span>
                )}
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
