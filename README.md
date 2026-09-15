# Язык милосердия

MVP приватной координации помощи. Требования: Node 22+, npm, внешний Supabase; Docker/Supabase CLI для integration.


## Запуск с нуля
```bash
cp .env.example .env.local
npm ci
npm run dev
```
Откройте `/`, `/nearby`, `/specialists`, `/specialist/profile`, `/auth`, `/help`, `/cabinet`, `/volunteer`. Рабочее место находится в `/staff/cases`; ADMIN-модерация предложений — `/staff/volunteers`, специалистов — `/staff/specialists`. Проверки: `npm run check`; миграции локально: `npx supabase start && npx supabase db reset`. Seed намеренно требует `app.mercy_allow_test_seed=true` и предназначен только для disposable DB.

`NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` обязательны и безопасны для клиента в сочетании с RLS. Legacy anon key — только fallback. `NEXT_PUBLIC_SITE_URL` обязателен и задаёт Auth redirects; production значение должно быть canonical HTTPS URL. Все `NEXT_PUBLIC_*` встраиваются во время build: передавайте их как Docker build args, не ожидайте runtime-подмены. Privileged keys приложению не нужны. Полная локальная и CI-процедура, роли и защита от удалённой БД описаны в [`docs/TESTING.md`](docs/TESTING.md).

## Supabase/Auth/Realtime
Добавьте Site URL и `/auth/callback` в allowed redirect URLs, настройте SMTP/email confirmation по политике среды. Миграция добавляет только `messages` в Realtime publication; подписка ограничена кейсом, а RLS остаётся авторизацией. Не включайте DELETE payload. Bootstrap описан в deployment docs.

## Карта
Внешние тайлы загружаются только после действия (MVP показывает устойчивый список; визуальный Leaflet слой — следующий UI increment). Укажите tile URL и обязательную attribution согласно условиям выбранного провайдера. Геолокация не сохраняется и не попадает в URL/логи.

## Тестовые сценарии
Job `supabase-integration` сам поднимает полный disposable Supabase (PostgreSQL/PostGIS, Auth, PostgREST, Realtime и Inbucket), применяет миграции с нуля и только затем создаёт двух USER, двух COORDINATOR и ADMIN через Auth API. Облачный проект и repository secrets не нужны. Вымышленные организации имеют название «Тестовая…», аккаунты — домен `.invalid`.
