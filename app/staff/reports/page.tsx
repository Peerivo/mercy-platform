import Link from "next/link";
import {getTranslations} from "@/lib/i18n/server";
import {dateLocale,enumLabel} from "@/lib/i18n";
import { redirect } from "next/navigation";

import { serverSupabase } from "@/lib/supabase/server";
import { reviewReport } from "./actions";

type ReportRow = {
  report_id: string;
  help_request_id: string;
  case_number: number;
  category: string;
  city: string;
  description: string;
  request_status: string;
  reason: string;
  details: string;
  created_at: string;
};

const reasonLabels: Record<string, string> = {
  FRAUD: "Возможное мошенничество",
  DANGEROUS: "Опасный контент",
  PERSONAL_DATA:
    "Опубликованы персональные данные",
  OUTDATED: "Просьба неактуальна",
  OTHER: "Другая причина",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<
    Record<string, string | undefined>
  >;
}) {
  const {t,locale}=await getTranslations();
  const query = await searchParams;

  const s = await serverSupabase();

  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: staffRole } =
    await s.rpc("current_staff_role");

  if (staffRole !== "ADMIN") {
    redirect("/cabinet");
  }

  const { data, error } = await s.rpc(
    "admin_help_request_reports",
    {
      report_limit: 100,
      report_offset: 0,
    }
  );

  if (error) {
    redirect("/staff/cases");
  }

  const reports =
    (data ?? []) as ReportRow[];

  return (
    <section className="container section">
      <nav
        className="nav"
        aria-label={t("Рабочее место")}
      >
        <Link href="/staff/cases">{t("Обращения")}</Link>

        <strong>{t("Жалобы")}</strong>

        <Link href="/staff/volunteers">{t("Предложения помощи")}</Link>
      </nav>

      <h1>{t("Жалобы на просьбы")}</h1>

      <p className="muted">{t("Здесь показываются только публичные данные просьбы. Данные автора и приватная переписка не раскрываются.")}</p>

      {query.error && (
        <p role="alert">{t("Решение не сохранено.")}</p>
      )}

      {query.reviewed && (
        <p role="status">{t("Жалоба обработана.")}</p>
      )}

      <div className="grid">
        {reports.length ? (
          reports.map((report) => (
            <article
              className="card"
              key={report.report_id}
            >
              <h2>
                {t("Просьба №")}{" "}
                {report.case_number}
              </h2>

              <p>
                {enumLabel(t,report.category)}
                {" · "}
                {report.city}
                {" · "}
                {enumLabel(t,report.request_status)}
              </p>

              <p>
                <strong>{t("Причина жалобы:")}</strong>{" "}
                {t(reasonLabels[
                  report.reason
                ] ?? report.reason)}
              </p>

              {report.details && (
                <p>
                  <strong>{t("Комментарий:")}</strong>{" "}
                  {report.details}
                </p>
              )}

              <p>
                <strong>{t("Публичный текст просьбы:")}</strong>
              </p>

              <p>
                {report.description}
              </p>

              <p>
                <time
                  dateTime={
                    report.created_at
                  }
                >
                  {new Date(
                    report.created_at
                  ).toLocaleString(
                    dateLocale(locale)
                  )}
                </time>
              </p>

              <p>
                <Link
                  href={`/cabinet/requests/${report.help_request_id}`}
                  target="_blank"
                >{t("Открыть публичную карточку")}</Link>
              </p>

              <form
                action={reviewReport}
                className="grid"
              >
                <input
                  type="hidden"
                  name="id"
                  value={
                    report.report_id
                  }
                />

                <label>{t("Решение")}<select
                    name="status"
                    required
                    defaultValue=""
                  >
                    <option
                      value=""
                      disabled
                    >{t("Выберите")}</option>

                    <option value="RESOLVED">{t("Жалоба обоснована / обработана")}</option>

                    <option value="DISMISSED">{t("Отклонить жалобу")}</option>
                  </select>
                </label>

                <label>{t("Комментарий администратора")}<textarea
                    name="note"
                    minLength={3}
                    maxLength={500}
                    required
                    rows={3}
                  />
                </label>

                <button
                  className="btn"
                  type="submit"
                >{t("Сохранить решение")}</button>
              </form>
            </article>
          ))
        ) : (
          <div className="card">{t("Новых жалоб нет.")}</div>
        )}
      </div>
    </section>
  );
}