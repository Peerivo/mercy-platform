
import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";

export async function generateMetadata() {
  const { t } = await getTranslations();
  return {
  title: t("Язык милосердия"),
  description: t("Добровольная и практическая помощь людей людям."),
  alternates: { canonical: "/" },
};
}
const areas = [
  {
    t: "Беременность и после рождения",
    d: "Помогаем найти бытовую, социальную, психологическую, информационную или юридическую поддержку.",
  },
  {
    t: "Семья и отношения",
    d: "Помогаем искать безопасные практические решения и поддержку в сложной жизненной ситуации.",
  },
  {
    t: "Быт и самостоятельность",
    d: "Помощь с жильём, продуктами, вещами, транспортом, документами, работой, обучением и другими повседневными задачами.",
  },
];
export default async function Home(){
  const { t } = await getTranslations();
return <><section className="hero"><div className="page-shell"><p>{t("Люди помогают людям")}</p><h1>{t("Вы не обязаны справляться в одиночку")}</h1><p className="muted">{t("Расскажите, какая помощь нужна, или найдите просьбу, на которую можете откликнуться. Mercy помогает людям находить друг друга для добровольной и практической помощи.")}</p><div className="nav">
    <Link className="btn" href="/help">{t("Нужна помощь")}</Link>
    <Link
        className="btn secondary"
        href="/requests">{t("Кому нужна помощь")}</Link>
    <Link className="btn secondary" href="/nearby">{t("Помощь рядом")}</Link>
    <Link className="btn secondary" href="/volunteer">{t("Хочу помочь")}</Link>
    </div></div></section><section className="page-shell section"><div className="grid cols3">{areas.map(x=><article className="card" key={x.t}><h2>{t(x.t)}</h2><p>{t(x.d)}</p></article>)}</div></section><section className="page-shell section"><div className="notice"><strong>{t("Если сейчас небезопасно.")}</strong>{" "}{t("Свяжитесь индивидуально с координатором или используйте проверенные службы своей страны в каталоге. Контакты показываются только после проверки; если их нет, мы не придумываем номера. При непосредственной угрозе обратитесь в местную экстренную службу.")}</div><p>{t("Религиозная поддержка доступна только по вашему желанию и никогда не является условием помощи. Партнёр не получает доступ к обращению автоматически.")}</p></section></>}
