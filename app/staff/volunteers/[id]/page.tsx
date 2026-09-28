import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { serverSupabase } from "@/lib/supabase/server";
import {
  ASSIGNMENT_MODE_LABELS,
  BENEFICIARY_CONSENT_LABELS,
  HOME_CLEARANCE_LABELS,
  VOLUNTEER_CATEGORY_LABELS,
  VOLUNTEER_STATUS_LABELS,
} from "@/lib/mercy-roles";
import {
  addVolunteerContact,
  assignVolunteer,
  finishVolunteerAssignment,
  openVolunteerIncident,
  resolveVolunteerIncident,
  revokeVolunteerContact,
  saveRequestSafety,
  updateVolunteerProfile,
} from "./actions";

type Access = { is_curator: boolean; is_admin: boolean };
type Volunteer = {
  user_id: string;
  display_name: string;
  email: string;
  city: string | null;
  service_status: keyof typeof VOLUNTEER_STATUS_LABELS;
  service_categories: Array<keyof typeof VOLUNTEER_CATEGORY_LABELS>;
  available_online: boolean;
  home_visit_clearance: keyof typeof HOME_CLEARANCE_LABELS;
  supervision_required: boolean;
  active_assignments: number;
  completed_assignments: number;
  open_incidents: number;
};
type Contact = {
  id: string;
  display_name: string;
  relationship: string;
  contact_method: string;
  linked_user_id: string | null;
  created_at: string;
};
type Assignment = {
  id: string;
  help_request_id: string;
  case_number: number;
  category: string;
  city: string;
  request_status: string;
  assignment_mode: keyof typeof ASSIGNMENT_MODE_LABELS;
  task_summary: string;
  companion_user_id: string | null;
  assigned_at: string;
  completed_at: string | null;
};
type Incident = {
  id: string;
  help_request_id: string | null;
  category: string;
  summary: string;
  status: "OPEN" | "REVIEWING" | "RESOLVED";
  created_at: string;
  resolution_note: string | null;
};
type AssignableCase = {
  id: string;
  case_number: number;
  category: string;
  city: string;
  urgency: string;
  status: string;
  beneficiary_is_requester: boolean | null;
  beneficiary_consent_status: keyof typeof BENEFICIARY_CONSENT_LABELS;
  home_visit_approved: boolean;
};

export default async function VolunteerCard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const query = await searchParams;

  const s = await serverSupabase();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/auth");

  const accessResult = await s.rpc("current_mercy_access");
  const access = (accessResult.data?.[0] ?? null) as Access | null;
  if (!access || (!access.is_curator && !access.is_admin)) redirect("/cabinet");

  const [detailResult, contactsResult, assignmentsResult, incidentsResult, casesResult] =
    await Promise.all([
      s.rpc("staff_volunteer_detail", { target_user: id }),
      s.rpc("staff_volunteer_contacts", { target_user: id }),
      s.rpc("staff_volunteer_assignments", { target_user: id }),
      s.rpc("staff_volunteer_incidents", { target_user: id }),
      s.rpc("staff_assignable_cases", { result_limit: 100 }),
    ]);

  if (detailResult.error || !detailResult.data?.[0]) notFound();
  const volunteer = detailResult.data[0] as Volunteer;
  const contacts = (contactsResult.data ?? []) as Contact[];
  const assignments = (assignmentsResult.data ?? []) as Assignment[];
  const incidents = (incidentsResult.data ?? []) as Incident[];
  const cases = (casesResult.data ?? []) as AssignableCase[];

  return (
    <section className="page-shell section">
      <nav className="nav" aria-label="Рабочее место">
        <Link href="/staff/volunteers">← Волонтёры</Link>
        <Link href="/staff/cases">Обращения</Link>
        <Link href="/staff/roles">Роли</Link>
      </nav>

      <h1>{volunteer.display_name}</h1>
      <p>{volunteer.email} · {volunteer.city || "город не указан"}</p>
      <p>
        {VOLUNTEER_STATUS_LABELS[volunteer.service_status]} ·{" "}
        {HOME_CLEARANCE_LABELS[volunteer.home_visit_clearance]}
      </p>
      <p>
        Активных назначений: {volunteer.active_assignments} · выполнено:{" "}
        {volunteer.completed_assignments} · открытых инцидентов: {volunteer.open_incidents}
      </p>

      {query.saved && <p role="status">Изменения сохранены.</p>}
      {query.error && <p role="alert">Действие не выполнено. Проверьте условия допуска, ЕСИА и заполнение формы.</p>}

      <section className="card">
        <h2>Допуск и направления</h2>
        <form action={updateVolunteerProfile} className="grid">
          <input type="hidden" name="targetUser" value={id} />
          <label>
            Статус службы
            <select name="status" defaultValue={volunteer.service_status}>
              {Object.entries(VOLUNTEER_STATUS_LABELS).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>Направления помощи</legend>
            {Object.entries(VOLUNTEER_CATEGORY_LABELS).map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="categories"
                  value={value}
                  defaultChecked={volunteer.service_categories.includes(value as keyof typeof VOLUNTEER_CATEGORY_LABELS)}
                />{" "}
                {label}
              </label>
            ))}
          </fieldset>

          <label>
            <input type="checkbox" name="availableOnline" defaultChecked={volunteer.available_online} />{" "}
            Доступен дистанционно
          </label>

          <label>
            Домашние визиты
            <select name="homeClearance" defaultValue={volunteer.home_visit_clearance}>
              {Object.entries(HOME_CLEARANCE_LABELS).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            <input type="checkbox" name="supervisionRequired" defaultChecked={volunteer.supervision_required} />{" "}
            Требуется сопровождение куратора
          </label>

          <label>
            Основание изменения
            <textarea name="reason" minLength={3} maxLength={500} required />
          </label>
          <button className="btn" type="submit">Сохранить профиль</button>
        </form>
      </section>

      <section>
        <h2>Контактные лица</h2>
        <p className="muted">
          Контакт добавляется только после подтверждения согласия самого контактного лица.
        </p>
        <div className="grid">
          {contacts.map((contact) => (
            <article className="card" key={contact.id}>
              <strong>{contact.display_name}</strong>
              <p>{contact.relationship}</p>
              <p>{contact.contact_method}</p>
              <form action={revokeVolunteerContact}>
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="targetUser" value={id} />
                <label>
                  Причина отвязки
                  <input name="reason" minLength={3} maxLength={500} required />
                </label>
                <button className="btn secondary" type="submit">Отвязать</button>
              </form>
            </article>
          ))}
        </div>

        <form action={addVolunteerContact} className="card grid">
          <input type="hidden" name="targetUser" value={id} />
          <input type="hidden" name="linkedUser" value="" />
          <h3>Добавить контактное лицо</h3>
          <label>Имя<input name="name" minLength={2} maxLength={160} required /></label>
          <label>Кем приходится<input name="relationship" minLength={2} maxLength={120} required /></label>
          <label>Контакт<input name="contact" minLength={2} maxLength={240} required /></label>
          <label>
            <input type="checkbox" name="consentConfirmed" required />{" "}
            Согласие контактного лица на хранение и использование этого контакта подтверждено
          </label>
          <button className="btn" type="submit">Привязать контакт</button>
        </form>
      </section>

      <section>
        <h2>Просьбы и назначения</h2>
        <p className="muted">
          Куратор видит здесь только обращения, которые вправе сопровождать. Для домашнего визита сначала
          зафиксируйте, кто является подопечным, его согласие и разрешение на визит.
        </p>

        <form action={saveRequestSafety} className="card grid">
          <input type="hidden" name="targetUser" value={id} />
          <h3>Согласие подопечного и домашний визит</h3>
          <label>
            Просьба
            <select name="caseId" required defaultValue="">
              <option value="" disabled>Выберите просьбу</option>
              {cases.map((item) => (
                <option value={item.id} key={item.id}>
                  № {item.case_number} · {item.city} · {item.category}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" name="requesterIsBeneficiary" />{" "}
            Просьбу подал сам подопечный
          </label>
          <label>
            Согласие подопечного
            <select name="consentStatus" defaultValue="PENDING">
              {Object.entries(BENEFICIARY_CONSENT_LABELS).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" name="allowHomeVisit" />{" "}
            Домашний визит разрешён
          </label>
          <label>
            Основание / как подтверждено согласие
            <textarea name="reason" minLength={3} maxLength={500} required />
          </label>
          <button className="btn secondary" type="submit">Сохранить условия безопасности</button>
        </form>

        <form action={assignVolunteer} className="card grid">
          <input type="hidden" name="targetUser" value={id} />
          <input type="hidden" name="companionUser" value="" />
          <h3>Назначить волонтёра на просьбу</h3>
          <label>
            Просьба
            <select name="caseId" required defaultValue="">
              <option value="" disabled>Выберите просьбу</option>
              {cases.map((item) => (
                <option value={item.id} key={item.id}>
                  № {item.case_number} · {item.city} · {item.category}
                </option>
              ))}
            </select>
          </label>
          <label>
            Формат
            <select name="mode" defaultValue="REMOTE">
              {Object.entries(ASSIGNMENT_MODE_LABELS).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <p className="muted">
            Для домашнего визита вторым участником автоматически становится текущий куратор.
          </p>
          <label>
            Конкретная задача
            <textarea name="task" minLength={3} maxLength={500} required />
          </label>
          <button className="btn" type="submit">Назначить</button>
        </form>

        <div className="grid">
          {assignments.length ? assignments.map((assignment) => (
            <article className="card" key={assignment.id}>
              <h3>Просьба № {assignment.case_number}</h3>
              <p>{assignment.city} · {assignment.category}</p>
              <p>{ASSIGNMENT_MODE_LABELS[assignment.assignment_mode]}</p>
              <p>{assignment.task_summary}</p>
              <p>{assignment.completed_at ? "Завершено" : "Активное назначение"}</p>
              {!assignment.completed_at && (
                <form action={finishVolunteerAssignment} className="grid">
                  <input type="hidden" name="assignmentId" value={assignment.id} />
                  <input type="hidden" name="targetUser" value={id} />
                  <label>
                    Результат
                    <select name="outcome" defaultValue="COMPLETED">
                      <option value="COMPLETED">Выполнено</option>
                      <option value="REVOKED">Отозвать назначение</option>
                    </select>
                  </label>
                  <label>Комментарий<input name="reason" minLength={3} maxLength={500} required /></label>
                  <button className="btn secondary" type="submit">Закрыть назначение</button>
                </form>
              )}
            </article>
          )) : <div className="card">Назначений пока нет.</div>}
        </div>
      </section>

      <section>
        <h2>Инциденты</h2>
        <p className="muted">
          Открытие инцидента сразу приостанавливает волонтёра. После закрытия инцидента допуск не
          восстанавливается автоматически — куратор отдельно возвращает статус «Активен».
        </p>

        <form action={openVolunteerIncident} className="card grid">
          <input type="hidden" name="targetUser" value={id} />
          <label>
            Связанная просьба
            <select name="caseId" defaultValue="">
              <option value="">Не привязывать к конкретной просьбе</option>
              {assignments.map((assignment) => (
                <option value={assignment.help_request_id} key={assignment.id}>
                  № {assignment.case_number}
                </option>
              ))}
            </select>
          </label>
          <label>Категория<input name="category" minLength={3} maxLength={80} required /></label>
          <label>Описание<textarea name="summary" minLength={10} maxLength={1000} required /></label>
          <button className="btn" type="submit">Открыть инцидент и приостановить доступ</button>
        </form>

        <div className="grid">
          {incidents.map((incident) => (
            <article className="card" key={incident.id}>
              <strong>{incident.category} · {incident.status}</strong>
              <p>{incident.summary}</p>
              {incident.resolution_note && <p><strong>Решение:</strong> {incident.resolution_note}</p>}
              {incident.status !== "RESOLVED" && (
                <form action={resolveVolunteerIncident}>
                  <input type="hidden" name="incidentId" value={incident.id} />
                  <input type="hidden" name="targetUser" value={id} />
                  <label>
                    Решение
                    <textarea name="resolution" minLength={3} maxLength={1000} required />
                  </label>
                  <button className="btn secondary" type="submit">Закрыть инцидент</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
