import Link from "next/link";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { roleDirectorySearchSchema } from "@/lib/validation";
import { PATRON_KIND_LABELS, ROLE_LABELS } from "@/lib/mercy-roles";
import { changeMercyRole } from "./actions";

type Access = {
  is_curator: boolean;
  is_admin: boolean;
};

type UserMatch = {
  id: string;
  email: string;
  display_name: string;
  city: string | null;
  is_email_confirmed: boolean;
  roles: string[];
  patron_kind: keyof typeof PATRON_KIND_LABELS | null;
};

export default async function StaffRoles({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const parsed = roleDirectorySearchSchema.safeParse({
    email: typeof raw.email === "string" ? raw.email : "",
  });
  const email = parsed.success ? parsed.data.email : "";

  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) redirect("/auth");

  const accessResult = await s.rpc("current_mercy_access");
  const access = (accessResult.data?.[0] ?? null) as Access | null;
  if (!access || (!access.is_curator && !access.is_admin)) redirect("/cabinet");

  let found: UserMatch | null = null;
  if (email) {
    const result = await s.rpc("staff_find_user_by_email", { exact_email: email });
    if (!result.error && result.data?.[0]) found = result.data[0] as UserMatch;
  }

  const allowedRoles = access.is_admin
    ? (["VOLUNTEER", "PATRON", "CURATOR", "ADMIN"] as const)
    : (["VOLUNTEER", "PATRON"] as const);

  return (
    <section className="page-shell section">
      <nav className="nav" aria-label="Рабочее место">
        <Link href="/cabinet">Кабинет</Link>
        <Link href="/staff/cases">Обращения</Link>
        <Link href="/staff/volunteers">Волонтёры</Link>
        <strong>Роли</strong>
      </nav>

      <h1>Роли и доступ</h1>
      <p className="muted">
        Поиск работает только по точному email зарегистрированного пользователя.
        Все роли назначаются только пользователям с подтверждённым email. Куратор назначает волонтёров и меценатов, администратор управляет всеми ролями.
      </p>

      <form className="card grid" method="get">
        <label>
          Email пользователя
          <input
            name="email"
            type="email"
            required
            maxLength={320}
            defaultValue={email}
            placeholder="user@example.ru"
          />
        </label>
        <button className="btn" type="submit">Найти пользователя</button>
      </form>

      {raw.saved && <p role="status">Роль обновлена.</p>}
      {raw.error && <p role="alert">Не удалось изменить роль. Проверьте подтверждение email, основание и свои права.</p>}

      {email && !found && (
        <div className="card">
          Пользователь с таким email не найден или поиск недоступен.
        </div>
      )}

      {found && (
        <article className="card">
          <h2>{found.display_name}</h2>
          <p><strong>Email:</strong> {found.email}</p>
          <p><strong>Город:</strong> {found.city || "не указан"}</p>
          <p>
            <strong>Email:</strong>{" "}
            {found.is_email_confirmed ? "подтверждён" : "не подтверждён"}
          </p>
          <p>
            <strong>Роли:</strong>{" "}
            {found.roles.length
              ? found.roles.map((role) => role === "USER" ? "Пользователь" : role === "VISITOR" ? "Посетитель" : ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role).join(", ")
              : "Пользователь"}
          </p>
          {found.patron_kind && (
            <p><strong>Тип мецената:</strong> {PATRON_KIND_LABELS[found.patron_kind]}</p>
          )}

          {!found.is_email_confirmed && (
            <p className="muted">
              Email не подтверждён: сначала необходимо подтвердить почту, затем можно назначать роль.
            </p>
          )}

          <div className="grid">
            {allowedRoles.map((role) => {
              const enabled = found.roles.includes(role);
              return (
                <form action={changeMercyRole} className="card" key={role}>
                  <input type="hidden" name="targetUser" value={found.id} />
                  <input type="hidden" name="role" value={role} />
                  <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
                  <input type="hidden" name="email" value={found.email} />

                  <h3>{ROLE_LABELS[role]}</h3>
                  <p>{enabled ? "Роль назначена." : "Роль не назначена."}</p>

                  {role === "PATRON" && !enabled && (
                    <label>
                      Тип мецената
                      <select name="patronKind" required defaultValue="PERSON">
                        {Object.entries(PATRON_KIND_LABELS).map(([value, label]) => (
                          <option value={value} key={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label>
                    Основание
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={500}
                      required
                      placeholder={enabled ? "Причина снятия роли" : "Основание назначения"}
                    />
                  </label>

                  <button
                    className="btn secondary"
                    type="submit"
                    disabled={!enabled && !found.is_email_confirmed}
                  >
                    {enabled ? "Снять роль" : "Назначить роль"}
                  </button>
                </form>
              );
            })}
          </div>
        </article>
      )}
    </section>
  );
}
