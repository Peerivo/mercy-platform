import Link from "next/link";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { moderateHelpRequest } from "./actions";

type PendingRequest = {
  id: string;
  case_number: number;
  category: string;
  country: string;
  city: string;
  description: string;
  urgency: string;
  beneficiary_scope: "SELF" | "OTHER";
  beneficiary_consent_attested: boolean;
  interaction_mode: "REMOTE_OR_PUBLIC" | "HOME_VISIT";
  can_message: boolean;
  can_call: boolean;
  contact_window: string;
  external_contact: string;
  created_at: string;
};

export default async function RequestModeration({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth");

  const { data: role } = await s.rpc("current_staff_role");
  if (role !== "ADMIN") redirect("/cabinet");

  const { data, error } = await s.rpc("admin_pending_help_requests", {
    request_limit: 50,
    request_offset: 0,
  });

  if (error) redirect("/staff/cases");

  const rows = (data ?? []) as PendingRequest[];

  return (
    <section className="page-shell section">
      <nav className="nav" aria-label="Рабочее место">
        <Link href="/staff/cases">Обращения</Link>
        <strong>Проверка просьб</strong>
        <Link href="/staff/reports">Жалобы</Link>
        <Link href="/staff/volunteers">Предложения помощи</Link>
      </nav>

      <h1>Проверка новых просьб</h1>
      <p className="muted">
        До одобрения просьба закрыта от публичного каталога и прямых откликов.
        Проверяйте только факт, необходимый для допуска; документы и их копии
        в Mercy не загружайте.
      </p>

      {q.error === "validation" && (
        <p className="form-alert" role="alert">
          Проверьте решение, основание и обязательные подтверждения.
        </p>
      )}
      {q.error === "review" && (
        <p className="form-alert" role="alert">
          Решение не сохранено. Возможно, просьба уже рассмотрена или не
          выполнено обязательное подтверждение.
        </p>
      )}
      {q.reviewed && <p>Решение сохранено в журнале аудита.</p>}

      <div className="grid">
        {rows.length ? (
          rows.map((request) => {
            const otherPerson = request.beneficiary_scope === "OTHER";
            const homeVisit = request.interaction_mode === "HOME_VISIT";

            return (
              <article
                className="card"
                id={`request-${request.id}`}
                key={request.id}
              >
                <h2>Просьба № {request.case_number}</h2>
                <p>
                  <strong>{request.category}</strong>
                  {" · "}
                  {request.country}, {request.city}
                  {" · "}
                  {request.urgency}
                </p>
                <p>{request.description}</p>

                <div className="grid cols2">
                  <p>
                    <strong>Благополучатель:</strong>{" "}
                    {otherPerson ? "другой человек" : "автор просьбы"}
                  </p>
                  <p>
                    <strong>Формат:</strong>{" "}
                    {homeVisit ? "визит домой" : "без домашнего визита"}
                  </p>
                </div>

                {otherPerson && (
                  <p>
                    Автор подтвердил, что благополучатель знает о просьбе:{" "}
                    <strong>
                      {request.beneficiary_consent_attested ? "да" : "нет"}
                    </strong>
                  </p>
                )}

                <p>
                  <strong>Приватная связь:</strong>{" "}
                  {request.external_contact || "не указана"}
                  {request.contact_window ? ` · ${request.contact_window}` : ""}
                  {request.can_call ? " · звонок разрешён" : ""}
                  {request.can_message ? " · сообщения разрешены" : ""}
                </p>

                <form action={moderateHelpRequest} className="grid">
                  <input type="hidden" name="id" value={request.id} />

                  {otherPerson && (
                    <label className="consent-row">
                      <input
                        type="checkbox"
                        name="beneficiaryConsentConfirmed"
                      />
                      <span>
                        Я отдельно подтвердил(-а), что благополучатель или его
                        законный представитель знает о просьбе и согласен на
                        помощь.
                      </span>
                    </label>
                  )}

                  {homeVisit && (
                    <label className="consent-row">
                      <input
                        type="checkbox"
                        name="requesterIdentityConfirmed"
                      />
                      <span>
                        Личность автора просьбы подтверждена. Копия документа в
                        Mercy не сохранялась.
                      </span>
                    </label>
                  )}

                  <label>
                    Решение
                    <select name="status" defaultValue="VERIFIED" required>
                      <option value="VERIFIED">Одобрить</option>
                      <option value="REJECTED">Отклонить</option>
                    </select>
                  </label>

                  <label>
                    Основание
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={500}
                      required
                      placeholder="Что проверено или почему просьба отклонена"
                    />
                  </label>

                  <button className="btn">Сохранить решение</button>
                </form>
              </article>
            );
          })
        ) : (
          <p className="card">Новых просьб на проверке нет.</p>
        )}
      </div>
    </section>
  );
}
