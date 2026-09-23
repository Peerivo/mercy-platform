import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { getPublicRequestStatus } from "@/lib/request-status";
import { serverSupabase } from "@/lib/supabase/server";

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

export default async function Cabinet() {
  const s = await serverSupabase();
  const {
    data: { user },
  } = await s.auth.getUser();

  if (!user) redirect("/auth");

  const [{ data: requests }, { data: offers }, { data: staffRole }] =
    await Promise.all([
      s
        .from("help_requests")
        .select("id,case_number,category,city,urgency,status,created_at")
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
    ]);

  return (
    <section className="page-shell section cabinet-page">
      <header className="cabinet-top">
        <div className="cabinet-heading">
          <span className="request-section-kicker">Кабинет</span>
          <h1>Личный кабинет</h1>
          <p className="cabinet-intro">
            Ответы доступны внутри кабинета. Во внешних уведомлениях содержание
            обращений не отправляется.
          </p>
        </div>

        <div className="cabinet-top-actions">
          {staffRole && (
            <Link className="btn secondary" href="/staff/cases">
              Рабочее место
            </Link>
          )}
          <form action={signOut}>
            <button className="btn secondary">Выйти из аккаунта</button>
          </form>
        </div>
      </header>

      <section className="cabinet-section" aria-labelledby="cabinet-requests-title">
        <div className="cabinet-section-heading">
          <div>
            <span className="request-section-kicker">Обращения</span>
            <h2 id="cabinet-requests-title">Мои обращения</h2>
          </div>
          <Link className="btn" href="/help">
            Новое обращение
          </Link>
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
                  № {request.case_number} · {request.category}
                </strong>
                <p>
                  {request.city} · {request.urgency} ·{" "}
                  {getPublicRequestStatus(request.status)}
                </p>
              </Link>
            ))
          ) : (
            <div className="card cabinet-empty">Обращений пока нет.</div>
          )}
        </div>
      </section>

      <section className="cabinet-section" aria-labelledby="cabinet-offers-title">
        <div className="cabinet-section-heading">
          <div>
            <span className="request-section-kicker">Помощь</span>
            <h2 id="cabinet-offers-title">Мои предложения помощи</h2>
          </div>
          <Link className="btn secondary" href="/volunteer">
            Новое предложение
          </Link>
        </div>

        <div className="cabinet-list">
          {offers?.length ? (
            (offers as Offer[]).map((offer) => (
              <article className="card cabinet-list-card" key={offer.id}>
                <strong>
                  {offer.category} · {offer.review_status}
                </strong>
                <p>{offer.online ? "Онлайн" : `${offer.country}, ${offer.city}`}</p>
                <p>{offer.description}</p>
              </article>
            ))
          ) : (
            <div className="card cabinet-empty">Предложений пока нет.</div>
          )}
        </div>
      </section>

      <section
        className="cabinet-section cabinet-support"
        aria-labelledby="cabinet-support-title"
      >
        <div className="cabinet-section-heading cabinet-support-heading">
          <div>
            <span className="request-section-kicker">Поддержка проекта</span>
            <h2 id="cabinet-support-title">Поддержать Mercy</h2>
          </div>
        </div>

        <p>
          Если вы хотите обсудить поддержку развития Mercy, напишите нам. Мы
          ответим по email и расскажем, какие варианты сейчас доступны.
        </p>
        <p className="muted cabinet-support-note">
          На сайте платежи не принимаются. Поддержка добровольна, не влияет на
          получение помощи и не означает обещание налогового вычета или наличие
          специального благотворительного статуса.
        </p>
        <Link
          className="btn secondary cabinet-support-action"
          href="/feedback?topic=support&from=%2Fcabinet"
        >
          Написать о поддержке
        </Link>
      </section>

      <section className="cabinet-section" aria-labelledby="cabinet-privacy-title">
        <div className="cabinet-section-heading">
          <div>
            <span className="request-section-kicker">Данные</span>
            <h2 id="cabinet-privacy-title">Приватность</h2>
          </div>
        </div>

        <div className="card cabinet-privacy-card">
          <p>
            Можно подать запрос на удаление аккаунта и данных. Администратор
            проверит объём и сроки хранения; резервные копии не очищаются
            мгновенно.
          </p>
          <button className="btn secondary" disabled>
            Запрос удаления — в подготовке
          </button>
        </div>
      </section>
    </section>
  );
}
