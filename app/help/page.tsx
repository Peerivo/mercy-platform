import { HelpForm } from "./help-form";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function Help({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const q = await searchParams;

  return (
    <section className="page-shell section public-form-page help-page">
      <div className="public-page-intro">
        <span className="request-section-kicker">Нужна помощь</span>
        <h1>Расскажите, какая помощь нужна</h1>

        <p className="page-lead public-page-lead">
          Текст просьбы будет опубликован и доступен без регистрации. Не
          указывайте в описании телефон, email, точный адрес, паспортные данные
          и другие сведения, которые не должны быть публичными. Контактные
          данные из отдельных полей ниже публично не показываются.
        </p>
      </div>

      {q.error && (
        <p className="form-alert" role="alert">
          Не удалось сохранить. Проверьте поля или повторите позже.
        </p>
      )}

      <HelpForm />
    </section>
  );
}