import {getTranslations} from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { volunteerDirectorySearchSchema } from "@/lib/validation";
import {
  VOLUNTEER_CATEGORY_LABELS,
  VOLUNTEER_STATUS_LABELS,
} from "@/lib/mercy-roles";

type Access = { is_curator: boolean; is_admin: boolean };

type VolunteerRow = {
  user_id: string;
  display_name: string;
  email: string;
  city: string | null;
  service_status: keyof typeof VOLUNTEER_STATUS_LABELS;
  service_categories: Array<keyof typeof VOLUNTEER_CATEGORY_LABELS>;
  available_online: boolean;
  active_assignments: number;
};

type Stats = {
  total_volunteers: number;
  active_volunteers: number;
  onboarding_volunteers: number;
  paused_volunteers: number;
  suspended_volunteers: number;
  cities: number;
  active_assignments: number;
  completed_assignments_30d: number;
  open_incidents: number;
};

export default async function VolunteerService({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getTranslations();
  const raw = await searchParams;
  const parsed = volunteerDirectorySearchSchema.safeParse({
    city: typeof raw.city === "string" ? raw.city : "",
    status: typeof raw.status === "string" ? raw.status : "",
    category: typeof raw.category === "string" ? raw.category : "",
    page: typeof raw.page === "string" ? raw.page : "1",
  });
  const filters = parsed.success
    ? parsed.data
    : { city: "", status: "", category: "", page: 1 };

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) redirect("/auth");

  const accessResult = await s.rpc("current_mercy_access");
  const access = (accessResult.data?.[0] ?? null) as Access | null;
  if (!access || (!access.is_curator && !access.is_admin)) redirect("/cabinet");

  const limit = 30;
  const offset = (filters.page - 1) * limit;
  const [volunteersResult, statsResult] = await Promise.all([
    s.rpc("staff_volunteers", {
      city_filter: filters.city || null,
      status_filter: filters.status || null,
      category_filter: filters.category || null,
      result_limit: limit + 1,
      result_offset: offset,
    }),
    s.rpc("volunteer_service_stats"),
  ]);

  if (volunteersResult.error || statsResult.error) redirect("/cabinet");

  const rows = (volunteersResult.data ?? []) as VolunteerRow[];
  const hasNext = rows.length > limit;
  const visibleRows = rows.slice(0, limit);
  const stats = (statsResult.data?.[0] ?? null) as Stats | null;

  function pageHref(page: number) {
    const params = new URLSearchParams();
    if (filters.city) params.set("city", filters.city);
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    params.set("page", String(page));
    return `/staff/volunteers?${params.toString()}`;
  }

  return (
    <section className="page-shell section">
      <nav className="nav" aria-label={t("Рабочее место")}>
        <Link href="/cabinet">{t("Кабинет")}</Link>
        <Link href="/staff/cases">{t("Обращения")}</Link>
        <strong>{t("Волонтёры")}</strong>
        <Link href="/staff/roles">{t("Роли")}</Link>
        {access.is_admin && <Link href="/staff/volunteer-offers">{t("Предложения помощи")}</Link>}
      </nav>

      <h1>{t("Волонтёрская служба")}</h1>
      <p className="muted">
        {t("Здесь зарегистрированные волонтёры, назначенные куратором или администратором. Подбор и доступ к обращениям контролируются назначениями, а не публичными профилями.")}
      </p>

      {stats && (
        <div className="grid">
          <div className="card"><strong>{stats.total_volunteers}</strong><p>{t("Всего волонтёров")}</p></div>
          <div className="card"><strong>{stats.active_volunteers}</strong><p>{t("Активны")}</p></div>
          <div className="card"><strong>{stats.onboarding_volunteers}</strong><p>{t("На подготовке")}</p></div>
          <div className="card"><strong>{stats.suspended_volunteers}</strong><p>{t("Приостановлены")}</p></div>
          <div className="card"><strong>{stats.cities}</strong><p>{t("Городов")}</p></div>
          <div className="card"><strong>{stats.active_assignments}</strong><p>{t("Активных назначений")}</p></div>
          <div className="card"><strong>{stats.completed_assignments_30d}</strong><p>{t("Выполнено за 30 дней")}</p></div>
          <div className="card"><strong>{stats.open_incidents}</strong><p>{t("Открытых инцидентов")}</p></div>
        </div>
      )}

      <form className="card grid" method="get">
        <label>
          {t("Город")}
          <input name="city" maxLength={120} defaultValue={filters.city} placeholder="Москва" />
        </label>
        <label>
          {t("Статус")}
          <select name="status" defaultValue={filters.status}>
            <option value="">{t("Все")}</option>
            {Object.entries(VOLUNTEER_STATUS_LABELS).map(([value, label]) => (
              <option value={value} key={value}>{t(label)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Направление помощи")}
          <select name="category" defaultValue={filters.category}>
            <option value="">{t("Все")}</option>
            {Object.entries(VOLUNTEER_CATEGORY_LABELS).map(([value, label]) => (
              <option value={value} key={value}>{t(label)}</option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">{t("Применить фильтры")}</button>
      </form>

      <div className="grid">
        {visibleRows.length ? visibleRows.map((row) => (
          <article className="card" key={row.user_id}>
            <h2>{row.display_name}</h2>
            <p>{row.city || t("Город не указан")} · {t(VOLUNTEER_STATUS_LABELS[row.service_status])}</p>
            <p>{row.email}</p>
            <p>
              {row.service_categories.length
                ? row.service_categories.map((category) => t(VOLUNTEER_CATEGORY_LABELS[category])).join(", ")
                : t("Направления помощи ещё не настроены")}
            </p>
            <p>{t("Активных назначений:")} {row.active_assignments}</p>
            {row.available_online && <p>{t("Доступен для дистанционной помощи")}</p>}
            <Link className="btn secondary" href={`/staff/volunteers/${row.user_id}`}>
              {t("Открыть карточку")}
            </Link>
          </article>
        )) : <div className="card">{t("По выбранным фильтрам волонтёров нет.")}</div>}
      </div>

      <nav className="pagination" aria-label={t("Страницы")}>
        {filters.page > 1 && <Link className="btn secondary" href={pageHref(filters.page - 1)}> {t("Назад")}</Link>}
        <span>{t("Страница")} {filters.page}</span>
        {hasNext && <Link className="btn secondary" href={pageHref(filters.page + 1)}> {t("Далее")}</Link>}
      </nav>
    </section>
  );
}
