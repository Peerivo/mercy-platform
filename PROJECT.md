# mercy-platform — CURRENT

## Назначение и границы
«Язык милосердия» — русскоязычная платформа добровольной помощи и координации поддержки людям в сложной жизненной ситуации. MVP включает публичные просьбы о помощи с приватными контактами и действиями владельца, приватное предложение добровольной помощи, staff workspace и каталог проверенных организаций. Помощник не становится сотрудником и не получает доступ к обращениям автоматически.

Mercy не является медицинской организацией или 24/7 экстренной службой. Медицинские услуги, профессиональные медицинские исполнители, qualification/licence verification, booking, payments, commissions, ratings и medical marketplace не входят в Mercy и не должны возвращаться в его модель данных или UI.

## Инфраструктура
Модульный монолит Next.js 16 / React 19, Supabase Auth/PostgreSQL/PostGIS/Realtime, append-only SQL migrations и non-root Docker runtime. Текущий production Supabase остаётся внешним до отдельного подтверждённого cutover. Российский self-hosted Supabase поднят на Beget; для него реализован только безопасный GitHub Actions preflight: проверка source/target PostgreSQL, свежести целевой Mercy-БД и обязательных расширений без dump/restore и без изменения целевой БД. Сам перенос данных и переключение production — отдельный reviewed increment с обязательным write-freeze, backup, restore, verification и rollback. Секретов в репозитории нет. Все новые remote migrations применяются только через защищённый GitHub Actions workflow.

## IMPLEMENTED
- Auth: регистрация с подтверждением email, вход/выход, recovery и проверяемый callback на обязательный `NEXT_PUBLIC_SITE_URL`.
- «Нужна помощь»: публичная карточка и список просьб без приватных контактов; личный кабинет владельца, ADMIN queue, назначение/переназначение, COORDINATOR workspace, приватный Realtime-чат, план и переходы до RESOLVED/CLOSED. Доступ к приватной части определяется user JWT, RLS и активным назначением.
- «Хочу помочь»: категоризированное предложение с страной/городом или online, описанием, контактом и атомарно сохранённым consent; собственный список в кабинете; ограниченная ADMIN-модерация с audit. Предложение не меняет staff role.
- Публичные просьбы: фильтры, безопасный share, жалобы и ADMIN-модерация жалоб.
- Quick Exit/History/BFCache guards, приватные no-store/noindex routes, каталог проверенных организаций, CI с clean disposable Supabase/pgTAP/integration/Chromium и Docker.
- Общий адаптивный `page-shell`, единые формы/карточки/навигация и favicon/знак Peerivo.
- `/health` выдаёт только status, environment и безопасно нормализованную ревизию; Docker принимает `GIT_SHA` и обязательные публичные Auth/Supabase build variables. Mock/data fallback отсутствует.
- Migration preflight для перехода Mercy на Beget запускается вручную через GitHub Actions и fail-closed проверяет production configuration (host/user могут храниться как Environment Variables, чувствительные значения — только Secrets), pinned SSH host key, source/target DB versions, пустой target Mercy contour и требуемые Postgres extensions. Source DB password не передаётся в process argv; preflight не выгружает пользовательские данные и не изменяет Beget.

## OPERATIONAL READINESS
До обработки реальных данных оператор должен применять migrations защищённым workflow, поддерживать production Auth/SMTP/redirect, Realtime, backup/restore, мониторинг и incident response, безопасный ADMIN bootstrap и smoke-сценарии. Для российского cutover дополнительно обязателен runbook `docs/RU_SUPABASE_MIGRATION.md`: подтверждённый preflight, write-freeze старого production, safety backup Beget, транзакционный restore, сверка данных/RLS/сервисов, переключение приложения и проверенный rollback.

## PLANNED / POST-MVP
Организационные кабинеты, deletion operations, abuse controls, безопасные вложения/уведомления, локализации, улучшения каталога организаций, volunteer assignment, Peerivo integration и AI assistance по versioned consent contract и с coordinator approval.
