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
        Это приватное обращение. Вы сами отмечаете срочность — это помогает
        сортировке, но не является медицинской оценкой. По умолчанию ответ будет
        в кабинете.
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