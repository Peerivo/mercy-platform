import { enumLabel } from "@/lib/i18n";

import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { getPublicRequestStatus } from "@/lib/request-status";
import { serverSupabase } from "@/lib/supabase/server";
import { ASSIGNMENT_MODE_LABELS, PATRON_KIND_LABELS, ROLE_LABELS } from "@/lib/mercy-roles";

type Offer = {
  id: string;
  category: string;
  country: string;
  city: string;
  online: boolean;
  description: string;
  review_status: string;
  created_at: string;
};

type Access = {
  base_role: "USER";
  identity_role: "USER" | "VISITOR";
  is_visitor: boolean;
  is_volunteer: boolean;
  is_curator: boolean;
  is_patron: boolean;
  is_admin: boolean;
  volunteer_status: string | null;
  patron_kind: keyof typeof PATRON_KIND_LABELS | null;
};

type VolunteerAssignment = {
  id: string;
  help_request_id: string;
  case_number: number;
  category: string;
  city: string;
  assignment_mode: keyof typeof ASSIGNMENT_MODE_LABELS;
  task_summary: string;
  assigned_at: string;
  access_active: boolean;
};

export default async function Cabinet() {
  const { t } = await getTranslations();

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth");

  const [
    { data: requests },
    { data: offers },
    { data: staffRole },
    accessResult,
    volunteerAssignmentsResult,
  ] = await Promise.all([
    s
      .from("help_requests")
      .select("id,case_number,category,city,urgency,status,created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    s
      .from("volunteer_offers")
      .select(
        "id,category,country,city,online,description,review_status,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(50),
    s.rpc("current_staff_role"),
    s.rpc("current_mercy_access"),
    s.rpc("my_volunteer_assignments", { result_limit: 50 }),
  ]);

  const access = (accessResult.data?.[0] ?? null) as Access | null;
  const volunteerAssignments = (volunteerAssignmentsResult.data ?? []) as VolunteerAssignment[];
  const hasCuratorWorkspace = Boolean(staffRole || access?.is_curator || access?.is_admin);

  const roleLabels = [
    access?.is_volunteer ? ROLE_LABELS.VOLUNTEER : null,
    access?.is_curator ? ROLE_LABELS.CURATOR : null,
    access?.is_patron ? ROLE_LABELS.PATRON : null,
    access?.is_admin ? ROLE_LABELS.ADMIN : null,
  ].filter(Boolean);

  return (
    <section className="page-shell section cabinet-page">
      <header className="cabinet-top">
        <div className="cabinet-heading">
          <span className="request-section-kicker">{t("Кабинет")}</span>
          <h1>{t("Личный кабинет")}</h1>
          <p className="cabinet-intro">{t("Ответы доступны внутри кабинета. Во внешних уведомлениях содержание обращений не отправляется.")}</p>
          <p className="muted">
            {t("Статус:")}{" "}
            {access?.is_visitor
              ? t("Посетитель — обращение о помощи создано")
              : t("Пользователь — выполнен вход по email")}
            {roleLabels.length ? ` · ${roleLabels.map(label => t(label!)).join(", ")}` : ""}
          </p>
          {access?.is_patron && access.patron_kind && (
            <p className="muted">
              {t("Меценат:")} {t(PATRON_KIND_LABELS[access.patron_kind])}
            </p>
          )}
        </div>

        <div className="cabinet-top-actions">
          {hasCuratorWorkspace && (
            <>
              <Link className="btn secondary" href="/staff/cases">
                {t("Рабочее место")}
              </Link>
              <Link className="btn secondary" href="/staff/volunteers">
                {t("Волонтёрская служба")}
              </Link>
              <Link className="btn secondary" href="/staff/roles">
                {t("Роли")}
              </Link>
            </>
          )}
          <form action={signOut}>
            <button className="btn secondary">{t("Выйти из аккаунта")}</button>
          </form>
        </div>
      </header>

      {access?.is_volunteer && (
        <section className="cabinet-section" aria-labelledby="cabinet-volunteer-title">
          <div className="cabinet-section-heading">
            <div>
              <span className="request-section-kicker">{t("Волонтёр")}</span>
              <h2 id="cabinet-volunteer-title">{t("Мои назначения")}</h2>
            </div>
          </div>
          {access.volunteer_status && (
            <p className="muted">{t("Статус службы:")} {access.volunteer_status}</p>
          )}
          <div className="cabinet-list">
            {volunteerAssignments.length ? volunteerAssignments.map((assignment) => (
              assignment.access_active ? (
                <Link
                  className="card cabinet-list-card"
                  href={`/cabinet/requests/${assignment.help_request_id}`}
                  key={assignment.id}
                >
                  <strong>{t("Просьба №")} {assignment.case_number}</strong>
                  <p>{assignment.city} · {assignment.category}</p>
                  <p>{ASSIGNMENT_MODE_LABELS[assignment.assignment_mode]} · {assignment.task_summary}</p>
                </Link>
              ) : (
                <article className="card cabinet-list-card" key={assignment.id}>
                  <strong>{t("Просьба №")} {assignment.case_number}</strong>
                  <p>{assignment.city} · {assignment.category}</p>
                  <p>{t("Доступ временно приостановлен. Свяжитесь с куратором.")}</p>
                </article>
              )
            )) : (
              <div className="card cabinet-empty">Активных назначений пока нет.</div>
            )}
          </div>
        </section>
      )}

      <section className="cabinet-section" aria-labelledby="cabinet-requests-title">
        <div className="cabinet-section-heading">
          <div>
            <span className="request-section-kicker">{t("Обращения")}</span>
            <h2 id="cabinet-requests-title">{t("Мои обращения")}</h2>
          </div>
          <Link className="btn" href="/help">{t("Новое обращение")}</Link>
        </div>

        <div className="cabinet-list">
          {requests?.length ? (
            requests.map((request) => (
              <Link
                className="card cabinet-list-card"
                href={`/cabinet/requests/${request.id}`}
                key={request.id}
              >
                <strong>
                  № {request.case_number} · {enumLabel(t, request.category)}
                </strong>
                <p>
                  {request.city} · {enumLabel(t, request.urgency)} ·{" "}
                  {t(getPublicRequestStatus(request.status))}
                </p>
              </Link>
            ))
          ) : (
            <div className="card cabinet-empty">{t("Обращений пока нет.")}</div>
          )}
        </div>
      </section>

      <section className="cabinet-section" aria-labelledby="cabinet-offers-title">
        <div className="cabinet-section-heading">
          <div>
            <span className="request-section-kicker">{t("Помощь")}</span>
            <h2 id="cabinet-offers-title">{t("Мои предложения помощи")}</h2>
          </div>
          <Link className="btn secondary" href="/volunteer">{t("Новое предложение")}</Link>
        </div>

        <div className="cabinet-list">
          {offers?.length ? (
            (offers as Offer[]).map((offer) => (
              <article className="card cabinet-list-card" key={offer.id}>
                <strong>
                  {enumLabel(t, offer.category)} · {enumLabel(t, offer.review_status)}
                </strong>
                <p>{offer.online ? t("Онлайн") : `${offer.country}, ${offer.city}`}</p>
                <p>{offer.description}</p>
              </article>
            ))
          ) : (
            <div className="card cabinet-empty">{t("Предложений пока нет.")}</div>
          )}
        </div>
      </section>

      <section
        className="cabinet-section cabinet-support"
        aria-labelledby="cabinet-support-title"
      >
        <div className="cabinet-section-heading cabinet-support-heading">
          <div>
            <span className="request-section-kicker">{t("Поддержка проекта")}</span>
            <h2 id="cabinet-support-title">{t("Поддержать Mercy")}</h2>
          </div>
        </div>

        <p>{t("Если вы хотите обсудить поддержку развития Mercy, напишите нам. Мы ответим по email и расскажем, какие варианты сейчас доступны.")}</p>
        <p className="muted cabinet-support-note">{t("На сайте платежи не принимаются. Поддержка добровольна, не влияет на получение помощи и не означает обещание налогового вычета или наличие специального благотворительного статуса.")}</p>
        <Link
          className="btn secondary cabinet-support-action"
          href="/feedback?topic=support&from=%2Fcabinet"
        >{t("Написать о поддержке")}</Link>
      </section>

      <section className="cabinet-section" aria-labelledby="cabinet-privacy-title">
        <div className="cabinet-section-heading">
          <div>
            <span className="request-section-kicker">{t("Данные")}</span>
            <h2 id="cabinet-privacy-title">{t("Приватность")}</h2>
          </div>
        </div>

        <div className="card cabinet-privacy-card">
          <p>{t("Можно подать запрос на удаление аккаунта и данных. Администратор проверит объём и сроки хранения; резервные копии не очищаются мгновенно.")}</p>
          <button className="btn secondary" disabled>{t("Запрос удаления — в подготовке")}</button>
        </div>
      </section>
    </section>
  );
}
