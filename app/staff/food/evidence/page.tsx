import Link from "next/link";
import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { FOOD_EVIDENCE_BUCKET, foodEvidenceService, type FoodEvidenceRow } from "@/lib/food-donation-evidence";
import { submitFoodDonationEvidence, reviewFoodDonationEvidence, dispatchFoodDonationEvidence } from "./actions";

const notices: Record<string,string> = {
  invalid:"Проверьте идентификаторы, количество и тип документа.",
  upload:"Файл не загружен в закрытое хранилище.",
  duplicate:"Для этого резерва документ уже зарегистрирован.",
  review:"Проверка запрещена: нужен второй уполномоченный сотрудник.",
  document:"Документ отсутствует или контрольная сумма не совпадает.",
  conflict:"Запись уже изменена другим сотрудником.",
  busy:"Подтверждение уже отправляется.",
  dispatch:"Передача в Food не подтверждена; можно безопасно повторить.",
};
const confirmations: Record<string,string> = {
  submitted:"Документ сохранён и ожидает независимой проверки.",
  approved:"Документ одобрен вторым сотрудником.",
  sent:"Результат передачи принят Food Rescue.",
};

export default async function FoodDonationEvidencePage({
  searchParams,
}: { searchParams: Promise<Record<string,string | undefined>> }) {
  const {t} = await getTranslations();
  const session=await serverSupabase();
  const {data:{user}}=await session.auth.getUser();
  if(!user) redirect("/auth");
  const {data:role}=await session.rpc("current_staff_role");
  if(role!=="ADMIN" && role!=="COORDINATOR") redirect("/cabinet");
  const params=await searchParams;
  const error=params.error && Object.hasOwn(notices,params.error) ? notices[params.error] : null;
  const success=params.success && Object.hasOwn(confirmations,params.success) ? confirmations[params.success] : null;

  const client=foodEvidenceService();
  const {data:raw,error:readError}=await client.from("food_donation_evidence")
    .select("*").order("submitted_at",{ascending:false}).limit(40);
  const items=(raw ?? []) as FoodEvidenceRow[];
  const records=await Promise.all(items.map(async record=>{
    const document=await client.storage.from(FOOD_EVIDENCE_BUCKET)
      .createSignedUrl(record.document_path, 120);
    return {record, url:document.error ? null : document.data?.signedUrl ?? null};
  }));
  return <section className="container section">
    <nav className="nav"><Link href="/staff/food">Food Rescue</Link> / <strong>{t("Документы выдачи")}</strong></nav>
    <h1>{t("Подтверждение передачи продуктов")}</h1>
    <p className="muted">{t("Документ хранится только в закрытом хранилище Mercy. Проверяет его другой координатор. Food получает только подтверждённые количества и непрозрачный идентификатор.")}</p>
    {error ? <p className="form-alert" role="alert">{t(error)}</p> : null}
    {success ? <p role="status" className="card">{t(success)}</p> : null}
    <div className="card">
      <h2>{t("1. Загрузить свидетельство выдачи")}</h2>
      <form action={submitFoodDonationEvidence} encType="multipart/form-data">
        <label htmlFor="food-e-offer">{t("ID предложения")}</label>
        <input id="food-e-offer" name="offerId" required placeholder="offer_lot_..." autoComplete="off" maxLength={100}/>
        <label htmlFor="food-e-reservation">{t("ID резерва")}</label>
        <input id="food-e-reservation" name="reservationId" required placeholder="reservation_..." autoComplete="off" maxLength={120}/>
        <label htmlFor="food-e-picked">{t("Забрано")}</label>
        <input id="food-e-picked" name="pickedUp" type="number" min="0" max="200" required defaultValue="1"/>
        <label htmlFor="food-e-delivered">{t("Передано")}</label>
        <input id="food-e-delivered" name="delivered" type="number" min="0" max="200" required defaultValue="1"/>
        <label htmlFor="food-e-document">{t("Фото или PDF подтверждения, до 5 МБ")}</label>
        <input id="food-e-document" name="document" type="file" accept="application/pdf,image/png,image/jpeg" required/>
        <button className="btn" type="submit">{t("Отправить на проверку")}</button>
      </form>
    </div>
    <h2>{t("2. Проверка и передача")}</h2>
    {readError ? <p role="alert">{t("Реестр недоступен. Передача отключена.")}</p> : null}
    {!readError && records.length===0 ? <p className="muted">{t("Пока нет документов на проверке.")}</p> : null}
    <div className="grid">
    {records.map(({record:r,url})=><article className="card" key={r.id}>
      <p><strong>{r.reservation_id}</strong></p>
      <p>{t("Состояние")}: {r.status}</p>
      <p>{t("Количество")}: {r.quantity_delivered} / {r.quantity_picked_up}</p>
      {url ? <p><a href={url} rel="noreferrer" target="_blank">{t("Просмотреть закрытый документ")}</a></p> : null}
      {r.status==="PENDING" && r.submitted_by!==user.id && url ? <form action={reviewFoodDonationEvidence}>
        <input type="hidden" name="id" value={r.id}/>
        <label><input type="checkbox" name="reviewed" value="yes" required/> {t("Документ проверен лично; данные соответствуют фактической выдаче.")}</label>
        <button type="submit" className="btn">{t("Одобрить после проверки")}</button>
      </form> : null}
      {(r.status==="APPROVED" || r.status==="SENDING") && <form action={dispatchFoodDonationEvidence}>
        <input type="hidden" name="id" value={r.id}/>
        <button type="submit" className="btn">{t("Передать подтверждение в Food")}</button>
      </form>}
    </article>)}
    </div>
  </section>;
}
