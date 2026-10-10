import {getTranslations} from "@/lib/i18n/server";
import {enumLabel} from "@/lib/i18n";
import Link from "next/link";import {redirect} from "next/navigation";import {serverSupabase} from "@/lib/supabase/server";import {moderateOffer} from "./actions";
type Offer={id:string;category:string;country:string;city:string;online:boolean;description:string;contact_method:string;review_status:string;created_at:string};
export default async function VolunteerModeration({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const {t}=await getTranslations();const q=await searchParams,s=await serverSupabase(),{data:{user}}=await s.auth.getUser();if(!user)redirect("/auth");const {data:staffRole}=await s.rpc("current_staff_role");if(staffRole!=="ADMIN")redirect("/cabinet");const {data,error}=await s.from("volunteer_offers").select("id,category,country,city,online,description,contact_method,review_status,created_at").eq("review_status","PENDING").order("created_at").limit(50);if(error)redirect("/staff/cases");return <section className="container section">
<nav className="nav">
  <Link href="/staff/cases">
    {t("Обращения")}
  </Link>

  <Link href="/staff/reports">
    {t("Жалобы")}
  </Link>

  <strong>
    {t("Предложения помощи")}
  </strong>
</nav>
<h1>{t("Модерация предложений помощи")}</h1><p className="muted">{t("Контакты приватны. Решение записывается в аудит; модерация не назначает пользователю staff-роль.")}</p>{q.error&&<p role="alert">{t("Решение не сохранено.")}</p>}{q.reviewed&&<p>{t("Решение сохранено.")}</p>}{data?.length?(data as Offer[]).map(o=><article className="card" key={o.id}><h2>{enumLabel(t,o.category)}</h2><p>{o.online?t("Онлайн"):`${o.country}, ${o.city}`}</p><p>{o.description}</p><p><strong>{t("Способ связи:")}</strong> {o.contact_method}</p><form action={moderateOffer} className="grid"><input type="hidden" name="id" value={o.id}/><label>{t("Решение")}<select name="status" required defaultValue="VERIFIED"><option value="VERIFIED">{t("Одобрить")}</option><option value="REJECTED">{t("Отклонить")}</option></select></label><label>{t("Основание")}<textarea name="reason" minLength={3} maxLength={500} required/></label><button className="btn">{t("Сохранить решение")}</button></form></article>):<p className="card">{t("Предложений на проверке нет.")}</p>}</section>}
