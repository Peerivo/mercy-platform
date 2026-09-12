# Проверка MVP

## Наборы

`npm run check` запускает lint, строгую TypeScript-проверку, unit-тесты и production build. `supabase test db supabase/tests/access.sql` проверяет наличие схемы, RLS, grants, publication и отсутствие `REPLICA IDENTITY FULL` у сообщений. `npm run test:integration` работает через настоящие Auth-сессии и Supabase API. `npm run test:e2e` запускает Chromium против настоящего Next.js и локального Supabase.

Integration harness создаёт только вымышленные `U1`, `U2`, изолированного для квоты `U3`, `C1`, `C2`, `A1` с адресами домена `.invalid`. Service-role локального проекта используется исключительно для создания Auth fixtures, исходных ролей и подсчёта строк после конкурентной проверки. Все утверждения о доступе выполняются клиентами с JWT соответствующего пользователя; приложение service-role key не получает.

## Полностью локальный запуск

Нужны Node 22+, Docker и Supabase CLI **2.39.2**:

```bash
npm ci
npx supabase start
npx supabase db reset --no-seed
npx supabase test db supabase/tests/access.sql
eval "$(npx supabase status -o env | sed -n \
  -e 's/^API_URL=/SUPABASE_TEST_URL=/p' \
  -e 's/^ANON_KEY=/SUPABASE_TEST_ANON_KEY=/p' \
  -e 's/^SERVICE_ROLE_KEY=/SUPABASE_TEST_SERVICE_ROLE_KEY=/p')"
export SUPABASE_TEST_URL SUPABASE_TEST_ANON_KEY SUPABASE_TEST_SERVICE_ROLE_KEY
MERCY_DISPOSABLE_SUPABASE=true npm run test:integration
npx playwright install --with-deps chromium
eval "$(npx supabase status -o env | sed -n \
  -e 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/p' \
  -e 's/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/p')"
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 npm run test:e2e
npx supabase stop --no-backup
```

Не копируйте вывод `supabase status -o env` в лог или artifact. Integration suite прекращает работу, если отсутствует `MERCY_DISPOSABLE_SUPABASE=true`, URL не равен loopback HTTP на порту 54321 либо отсутствуют разные anon/service keys. Это отдельная защита от reset/fixtures на удалённой БД; `NODE_ENV=test` намеренно недостаточен. Seed выключен: fixtures готовятся только после успешного reset.

## Что проверяется

- анонимный каталог, двойная публикация, конфиденциальные точки, PostGIS-радиус, порядок, единицы и limit;
- изоляция владельцев, назначенного координатора и минимальной очереди администратора;
- прямые попытки подмены owner/author/assignment, metadata-role, audit и административных RPC;
- допустимые/недопустимые переходы, неизменяемость сообщений, nonce-idempotency только для того же обращения и тела, отказ retry после потери доступа и уникальное конкурентное назначение;
- атомарная минутная квота сообщений: изолированный автор заполняет 19 мест, две отправки с разными nonce конкурируют за последнее, а retry принятого nonce не расходует квоту повторно;
- настоящие `postgres_changes` подписки без client-side фильтра: подтверждённая доставка разрешённым клиентам и отсутствие доставки после переназначения или отзыва staff-role при сохранённом сокете; отдельное переподключение также не восстанавливает доступ;
- два независимых browser context, регистрация/вход, обращение, чат, refresh, чужой UUID, ширина 360 px, Quick Exit/Back/BFCache и безопасный callback.

Realtime отрицательные утверждения выполняются только после статуса `SUBSCRIBED`; окно отсутствия события следует за доставкой уникального контрольного сообщения разрешённому получателю. Reconnect приложения догружает строки из БД и сливает их по UUID, поэтому разрыв не создаёт пропуски/дубли. Publication содержит только INSERT/UPDATE/DELETE протокол таблицы `messages`, но таблица не использует FULL replica identity: приватное тело не попадает в старый DELETE row. Публичные Broadcast-каналы не используются.

pgTAP проверяет включение RLS через `pg_catalog.pg_class.relrowsecurity`, а не через зависящую от текущей роли `row_security_active`. План содержит 13 фактических assertions. Поведенческие границы RLS проверяет отдельный Auth/API/Realtime набор с пользовательскими JWT.

## Диагностика

- `Docker daemon is unavailable`: локально integration/e2e не запускались; GitHub-hosted runner обязан их выполнить, без skip.
- timeout readiness/subscription: смотрите `supabase status` и health контейнеров; не увеличивайте окно вместо исправления сервиса.
- migration failure: запускайте reset только у disposable stack и исправляйте схему новой append-only migration.
- RLS часто возвращает `data: []` без ошибки. Поэтому denied-тесты проверяют и пустые данные, и неизменность строк/число записей.
- Inbucket доступен локально для проверки recovery-писем без реальных адресатов; callback отклоняет отсутствующий код и внешний `next`, а отдельная форма обновляет пароль только при действующей recovery-сессии. Никакие реальные адресаты и облачные credentials не используются.

CI не сохраняет `.env`, auth `storageState`, токены, координаты или сетевые traces. Отдельный облачный staging потребуется позднее для проверки production Auth/SMTP/configuration и операционной приёмки, но не для воспроизводимой интеграционной проверки этого набора.
