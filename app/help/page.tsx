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
    <section className="page-shell section">
      <h1>Расскажите, какая помощь нужна</h1>

      <p>
        Текст просьбы о помощи будет опубликован и доступен без регистрации.
        Не указывайте в описании телефон, email, точный адрес, паспортные данные
        и другие сведения, которые не должны быть публичными. Контактные данные,
        указанные в отдельных полях ниже, публично не показываются.
      </p>

      {q.error && (
        <p role="alert">
          Не удалось сохранить. Проверьте поля или повторите позже.
        </p>
      )}

      <HelpForm />
    </section>
  );
}