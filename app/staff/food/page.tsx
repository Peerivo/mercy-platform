import Link from "next/link";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { happyFoodRescueConfig } from "@/lib/happy-food-rescue";
import { reserveFoodDonation, attestFoodDonation } from "./actions";

const messages: Record<string, string> = {
  invalid: "Проверьте идентификатор и количество.",
  reserve: "Food не подтвердил резерв. Проверьте доступный остаток и срок выдачи.",
  attest: "Подтверждение передачи отклонено. Проверьте исходный резерв и количество.",
};

export default async function FoodRescueStaff({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { t } = await getTranslations();
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  const { data: role } = await supabase.rpc("current_staff_role");
  if (role !== "ADMIN" && role !== "COORDINATOR") redirect("/cabinet");
  const params = await searchParams;
  const error = typeof params.error === "string" && Object.hasOwn(messages, params.error) ? t(messages[params.error]) : null;
  const reservation = typeof params.reservation === "string" &&
    /^reservation_mercy_staff_[a-f0-9]{32}$/.test(params.reservation)
    ? params.reservation : null;
  const enabled = happyFoodRescueConfig().enabled;

  return (
    <section className="container section">
      <nav className="nav" aria-label={t("Навигация по рабочему месту")}>
        <Link href="/staff/cases">{t("Обращения")}</Link>
        <span> / </span>
        <strong>Food Rescue</strong>
      </nav>
      <h1>{t("Передача продуктов через Food Rescue")}</h1>
      <p className="muted">{t("Операции доступны только администратору и координатору Mercy. Пилотный регион: GE-AJ. Данные получателей и дела Mercy в Food не отправляются.")}</p>
      {error ? <p role="alert" className="form-alert">{error}</p> : null}
      {reservation ? (
        <div className="card">
          <h2>{t("Резерв подтверждён")}</h2>
          <p>{t("Сохраните непрозрачный номер резерва для подтверждения передачи:")}</p>
          <code style={{ overflowWrap: "anywhere" }}>{reservation}</code>
        </div>
      ) : null}
      {params.success === "attested" ? (
        <p role="status" className="card">{t("Результат передачи принят Food Rescue и учтён по количеству.")}</p>
      ) : null}
      {!enabled ? (
        <div className="card">
          <h2>{t("Интеграция пока выключена")}</h2>
          <p>{t("Для проведения операций необходимо включить отдельный токен Mercy → Food в защищённом контуре развёртывания.")}</p>
        </div>
      ) : (
        <div className="grid">
          <div className="card">
            <h2>{t("1. Зарезервировать помощь")}</h2>
            <p className="muted">{t("Скопируйте идентификатор предложения Food. Срок резерва — 20 минут или меньше, если заканчивается безопасное окно выдачи.")}</p>
            <form action={reserveFoodDonation}>
              <label htmlFor="reserve-offer">{t("ID предложения Food")}</label>
              <input id="reserve-offer" type="text" name="offerId" required maxLength={128} placeholder="offer_lot_..." autoComplete="off" />
              <label htmlFor="reserve-qty">{t("Количество")}</label>
              <input id="reserve-qty" type="number" name="quantity" required min="1" max="200" defaultValue="1" />
              <button type="submit" className="btn">{t("Зарезервировать")}</button>
            </form>
          </div>
          <div className="card">
            <h2>{t("2. Подтвердить результат")}</h2>
            <p className="muted">{t("Подтверждайте только фактическую передачу. Переданное и остающееся на ответственном хранении учитываются отдельно.")}</p>
            <form action={attestFoodDonation}>
              <label htmlFor="attest-offer">{t("ID предложения Food")}</label>
              <input id="attest-offer" type="text" name="offerId" required maxLength={128} placeholder="offer_lot_..." autoComplete="off" />
              <label htmlFor="attest-reservation">{t("ID резерва")}</label>
              <input id="attest-reservation" type="text" name="reservationId" required maxLength={128} defaultValue={reservation ?? ""} autoComplete="off" />
              <label htmlFor="picked-up">{t("Фактически забрали")}</label>
              <input id="picked-up" type="number" name="pickedUp" required min="0" max="200" defaultValue="1" />
              <label htmlFor="delivered">{t("Фактически передали")}</label>
              <input id="delivered" type="number" name="delivered" required min="0" max="200" defaultValue="1" />
              <button type="submit" className="btn">{t("Подтвердить передачу")}</button>
            </form>
          </div>
        </div>
      )}
      <p className="muted">{t("Данные Food:")}<a href="https://food.peerivo.net" target="_blank" rel="noreferrer">food.peerivo.net ↗</a>{t(". Реальные платежи и публичный подбор получателя здесь не выполняются.")}</p>
    </section>
  );
}
