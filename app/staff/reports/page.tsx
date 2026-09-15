import Link from "next/link";
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
  const query = await searchParams;

  const s = await serverSupabase();

  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: isAdmin } =
    await s.rpc("is_admin");

  if (!isAdmin) {
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
        aria-label="Рабочее место"
      >
        <Link href="/staff/cases">
          Обращения
        </Link>

        <strong>Жалобы</strong>

        <Link href="/staff/volunteers">
          Предложения помощи
        </Link>
      </nav>

      <h1>Жалобы на просьбы</h1>

      <p className="muted">
        Здесь показываются только
        публичные данные просьбы.
        Данные автора и приватная
        переписка не раскрываются.
      </p>

      {query.error && (
        <p role="alert">
          Решение не сохранено.
        </p>
      )}

      {query.reviewed && (
        <p role="status">
          Жалоба обработана.
        </p>
      )}

      <div className="grid">
        {reports.length ? (
          reports.map((report) => (
            <article
              className="card"
              key={report.report_id}
            >
              <h2>
                Просьба №{" "}
                {report.case_number}
              </h2>

              <p>
                {report.category}
                {" · "}
                {report.city}
                {" · "}
                {report.request_status}
              </p>

              <p>
                <strong>
                  Причина жалобы:
                </strong>{" "}
                {reasonLabels[
                  report.reason
                ] ?? report.reason}
              </p>

              {report.details && (
                <p>
                  <strong>
                    Комментарий:
                  </strong>{" "}
                  {report.details}
                </p>
              )}

              <p>
                <strong>
                  Публичный текст
                  просьбы:
                </strong>
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
                    "ru-RU"
                  )}
                </time>
              </p>

              <p>
                <Link
                  href={`/cabinet/requests/${report.help_request_id}`}
                  target="_blank"
                >
                  Открыть публичную
                  карточку
                </Link>
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

                <label>
                  Решение
                  <select
                    name="status"
                    required
                    defaultValue=""
                  >
                    <option
                      value=""
                      disabled
                    >
                      Выберите
                    </option>

                    <option value="RESOLVED">
                      Жалоба обоснована /
                      обработана
                    </option>

                    <option value="DISMISSED">
                      Отклонить жалобу
                    </option>
                  </select>
                </label>

                <label>
                  Комментарий администратора

                  <textarea
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
                >
                  Сохранить решение
                </button>
              </form>
            </article>
          ))
        ) : (
          <div className="card">
            Новых жалоб нет.
          </div>
        )}
      </div>
    </section>
  );
}