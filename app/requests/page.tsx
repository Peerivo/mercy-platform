import { enumLabel, dateLocale } from "@/lib/i18n";

import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";

import { serverSupabase } from "@/lib/supabase/server";
import { getPublicRequestStatus } from "@/lib/request-status";
import { publicRequestSearchSchema } from "@/lib/validation";

type RequestRow = {
  id: string;
  case_number: number;
  category: string;
  country: string;
  city: string;
  description: string;
  urgency: string;
  status: string;
  created_at: string;
};

const categoryLabels: Record<string, string> = {
  PREGNANCY: "Беременность и материнство",
  FAMILY: "Семья",
  HOUSING: "Жильё",
  FOOD_GOODS: "Продукты и вещи",
  LEGAL_DOCUMENTS: "Документы и право",
  WORK_EDUCATION: "Работа и обучение",
  OTHER: "Другое",
};


function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

type Filters = {
  category: string;
  city: string;
  urgency: string;
  state: "ACTIVE" | "COMPLETED" | "ALL";
  page: number;
};

function parseFilters(raw: Record<string, string | string[] | undefined>): Filters {
  const parsed = publicRequestSearchSchema.safeParse({
    category: one(raw.category),
    city: one(raw.city),
    urgency: one(raw.urgency),
    state: one(raw.state) || "ACTIVE",
    page: one(raw.page) || "1",
  });

  return parsed.success
    ? parsed.data
    : {
        category: "",
        city: "",
        urgency: "",
        state: "ACTIVE",
        page: 1,
      };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getTranslations();

  const filters = parseFilters(await searchParams);
  const canonical = filters.page > 1 ? `/requests?page=${filters.page}` : "/requests";

  return {
    title: t("Просьбы о помощи"),
    description: t("Опубликованные просьбы о добровольной и практической помощи."),
    alternates: { canonical },
  };
}

function requestsHref(filters: Filters, page: number) {
  const params = new URLSearchParams();

  if (filters.category) {
    params.set("category", filters.category);
  }

  if (filters.city) {
    params.set("city", filters.city);
  }

  if (filters.urgency) {
    params.set("urgency", filters.urgency);
  }

  if (filters.state !== "ACTIVE") {
    params.set("state", filters.state);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();

  return query ? `/requests?${query}` : "/requests";
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getTranslations();

  const raw = await searchParams;

  const filters = parseFilters(raw);

  const pageSize = 20;
  const offset = (filters.page - 1) * pageSize;

  const s = await serverSupabase();

  // Берём на одну запись больше, чтобы понять, нужна ли кнопка "Далее".
  const { data, error } = await s.rpc("list_public_help_requests", {
    category_filter: filters.category || null,
    city_filter: filters.city || null,
    urgency_filter: filters.urgency || null,
    state_filter: filters.state,
    result_limit: pageSize + 1,
    result_offset: offset,
  });

  const allRows = (data ?? []) as RequestRow[];
  const hasNext = allRows.length > pageSize;
  const rows = allRows.slice(0, pageSize);

  return (
    <section className="page-shell section requests-page">
      <div className="nav requests-page-heading">
        <div>
          <h1>{t("Просьбы о помощи")}</h1>
          <p className="muted requests-page-lead">{t("Здесь опубликованы просьбы людей, которым сейчас нужна помощь.")}</p>
        </div>

        <span className="spacer" />

        <Link className="btn requests-primary-action" href="/help">{t("Мне нужна помощь")}</Link>
      </div>

      <form method="get" className="card grid request-filters-card">
        <div className="request-section-heading">
          <div>
            <span className="request-section-kicker">{t("Фильтр")}</span>
            <h2>{t("Найти подходящую просьбу")}</h2>
          </div>
          <p>{t("Выберите только нужные параметры — остальные можно оставить как есть.")}</p>
        </div>

        <div className="grid cols2 request-filter-row">
          <label>{t("Категория")}<select name="category" defaultValue={filters.category}>
              <option value="">{t("Все категории")}</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>

          <label>{t("Город")}<input
              name="city"
              maxLength={120}
              defaultValue={filters.city}
              placeholder={t("Например, Москва")}
            />
          </label>
        </div>

        <div className="grid cols2 request-filter-row">
          <label>{t("Срочность")}<select name="urgency" defaultValue={filters.urgency}>
              <option value="">{t("Любая")}</option>
              <option value="URGENT">{t("Срочно")}</option>
              <option value="SOON">{t("Желательно скоро")}</option>
              <option value="NORMAL">{t("Обычная")}</option>
            </select>
          </label>

          <label>{t("Актуальность")}<select name="state" defaultValue={filters.state}>
              <option value="ACTIVE">{t("Только актуальные")}</option>
              <option value="COMPLETED">{t("Завершённые")}</option>
              <option value="ALL">{t("Все")}</option>
            </select>
          </label>
        </div>

        <div className="nav request-filter-actions">
          <button className="btn" type="submit">{t("Найти")}</button>
          <Link className="btn secondary" href="/requests">{t("Сбросить")}</Link>
        </div>
      </form>

      <div className="requests-results-block">
        <div className="request-section-heading requests-results-heading">
          <div>
            <span className="request-section-kicker">{t("Просьбы")}</span>
            <h2>{t("Запросы людей")}</h2>
          </div>
          <p>{t("Откройте карточку, чтобы увидеть подробности и способы помочь.")}</p>
        </div>

        {error ? (
          <div className="card requests-message-card">
            <p role="alert">{t("Не удалось загрузить просьбы. Попробуйте обновить страницу.")}</p>
          </div>
        ) : rows.length ? (
          <div className="grid request-list">
            {rows.map((request) => {
              const description =
                request.description.length > 350
                  ? `${request.description.slice(0, 350)}…`
                  : request.description;

              return (
                <article className="card request-list-card" key={request.id}>
                  <div className="nav request-card-header">
                    <div>
                      <h2>{t("Просьба №")} {request.case_number}</h2>
                      <p className="request-card-category">
                        <strong>{enumLabel(t, request.category)}</strong>
                      </p>
                    </div>

                    <span className="spacer" />

                    <strong className="request-card-status">
                      {t(getPublicRequestStatus(request.status))}
                    </strong>
                  </div>

                  <p className="request-card-meta">
                    {request.country} · {request.city} · {enumLabel(t, request.urgency)}
                  </p>

                  <p className="request-card-description">{description}</p>

                  <p className="muted request-card-date">{t("Опубликовано")}{" "}
                    <time dateTime={request.created_at}>
                      {new Date(request.created_at).toLocaleDateString(dateLocale(locale))}
                    </time>
                  </p>

                  <Link
                    className="btn secondary request-card-action"
                    href={`/cabinet/requests/${request.id}`}
                  >{t("Открыть просьбу")}</Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card requests-message-card">
            <h2>{t("Просьб не найдено")}</h2>
            <p>{t("Попробуйте изменить фильтры.")}</p>
          </div>
        )}
      </div>

      {!error && (filters.page > 1 || hasNext) && (
        <nav className="pagination" aria-label={t("Страницы просьб")}>
          {filters.page > 1 && (
            <Link className="btn secondary" href={requestsHref(filters, filters.page - 1)}>{t("Назад")}</Link>
          )}

          <span>{t("Страница")} {filters.page}</span>

          {hasNext && (
            <Link className="btn secondary" href={requestsHref(filters, filters.page + 1)}>{t("Далее")}</Link>
          )}
        </nav>
      )}
    </section>
  );
}
