import Link from "next/link";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { staffPageSchema } from "@/lib/validation";

type DeletionRequestRow = {
  user_id: string;
  alias: string | null;
  requested_at: string;
};

export default async function AccountDeletionRequests({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const pageResult = staffPageSchema.safeParse(raw.page);
  const page = pageResult.success ? pageResult.data : 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) redirect("/auth");

  const { data: staffRole } = await s.rpc("current_staff_role");
  if (staffRole !== "ADMIN") redirect("/cabinet");

  const { data, error } = await s.rpc("admin_account_deletion_requests", {
    result_limit: limit + 1,
    result_offset: offset,
  });
  if (error) redirect("/staff/cases");

  let rows = (data ?? []) as DeletionRequestRow[];
  const hasNext = rows.length > limit;
  rows = rows.slice(0, limit);

  return (
    <section className="container section">
      <nav className="nav" aria-label="Рабочее место">
        <Link href="/cabinet">Кабинет</Link>
        <Link href="/staff/cases">Очередь обращений</Link>
        <Link href="/staff/reports">Жалобы</Link>
        <Link href="/staff/volunteers">Предложения помощи</Link>
        <strong>Удаление данных</strong>
      </nav>

      <h1>Запросы на удаление данных</h1>
      <p className="muted">
        Здесь фиксируется только запрос пользователя. Перед фактическим удалением
        администратор проверяет обязательные сроки хранения и связанные данные;
        резервные копии не очищаются мгновенно.
      </p>

      <div className="grid">
        {rows.length ? (
          rows.map((row) => (
            <article className="card" key={row.user_id}>
              <h2>{row.alias?.trim() || "Пользователь без имени"}</h2>
              <p>
                ID: <code>{row.user_id}</code>
              </p>
              <p>
                Запрос отправлен{" "}
                <time dateTime={row.requested_at}>
                  {new Date(row.requested_at).toLocaleString("ru-RU")}
                </time>
              </p>
            </article>
          ))
        ) : (
          <div className="card">Активных запросов на удаление нет.</div>
        )}
      </div>

      <nav className="pagination" aria-label="Страницы">
        {page > 1 && (
          <Link className="btn secondary" href={`/staff/deletions?page=${page - 1}`}>
            Назад
          </Link>
        )}
        <span>Страница {page}</span>
        {hasNext && (
          <Link className="btn secondary" href={`/staff/deletions?page=${page + 1}`}>
            Далее
          </Link>
        )}
      </nav>
    </section>
  );
}
