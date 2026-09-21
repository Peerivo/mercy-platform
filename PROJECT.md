# mercy-platform — CURRENT

## Назначение и границы
«Язык милосердия» — русскоязычная платформа добровольной помощи и координации поддержки людям в сложной жизненной ситуации. MVP включает публичные просьбы о помощи с приватными контактами и действиями владельца, приватное предложение добровольной помощи, staff workspace и каталог проверенных организаций. Помощник не становится сотрудником и не получает доступ к обращениям автоматически.

Mercy не является медицинской организацией или 24/7 экстренной службой. Медицинские услуги, профессиональные медицинские исполнители, qualification/licence verification, booking, payments, commissions, ratings и medical marketplace не входят в Mercy и не должны возвращаться в его модель данных или UI.

## Инфраструктура
Mercy связан с каноническим Peerivo Global Contract через `.peerivo/global-contract.json`: `Peerivo/global`, contract `peerivo-global` v1.3.0, digest `sha256:2b8406ae4542f58306099e4ec4930bb531ab31969c5739cb31da47ad08cf7b05`, commit `e3b581229ab6e21d6116ca2387fa5b604352e05e`. Перед effectful work действует иерархия `Global -> Project -> Agent -> Task/Run`; локальные правила могут только усиливать ограничения.

Модульный монолит Next.js 16 / React 19, Supabase Auth/PostgreSQL/PostGIS/Realtime, append-only SQL migrations и non-root Docker runtime. Текущий production Supabase остаётся внешним до отдельного подтверждённого cutover. Российский self-hosted Supabase поднят на Beget. Read-only preflight уже реализован и пройден. Для фактического переноса добавлен отдельный guarded GitHub Actions cutover workflow: он перед dump блокирует записи в старом Mercy через временные DB triggers, делает safety backup Beget, применяет canonical migrations из репозитория, переносит только совместимые email Auth users/identities и public data, сверяет детерминированные fingerprints/RLS/Realtime и проверяет сервисы. При любой ошибке старый source автоматически размораживается; при успехе он остаётся write-frozen до проверки российского приложения. Public smoke cutover использует канонический API URL `https://api.xn----htbcggcjkhwxk7j6bn.xn--p1ai` напрямую, без хранения URL в Secrets. Секретов в репозитории нет. Все новые remote migrations применяются только через защищённый GitHub Actions workflow.

## IMPLEMENTED
- Auth: регистрация с подтверждением email, вход/выход, recovery и проверяемый callback на обязательный `NEXT_PUBLIC_SITE_URL`.
- «Нужна помощь»: публичная карточка и список просьб без приватных контактов; личный кабинет владельца, ADMIN queue, назначение/переназначение, COORDINATOR workspace, приватный Realtime-чат, план и переходы до RESOLVED/CLOSED. Доступ к приватной части определяется user JWT, RLS и активным назначением.
- «Хочу помочь»: категоризированное предложение с страной/городом или online, описанием, контактом и атомарно сохранённым consent; собственный список в кабинете; ограниченная ADMIN-модерация с audit. Предложение не меняет staff role.
- Публичные просьбы: фильтры, безопасный share, жалобы и ADMIN-модерация жалоб.
- Quick Exit/History/BFCache guards, приватные no-store/noindex routes, каталог проверенных организаций, CI с clean disposable Supabase/pgTAP/integration/Chromium и Docker.
- Общий адаптивный `page-shell`, единые формы/карточки/навигация и favicon/знак Peerivo.
- `/health` выдаёт только status, environment и безопасно нормализованную ревизию; Docker принимает `GIT_SHA` и обязательные публичные Auth/Supabase build variables. Mock/data fallback отсутствует.
- Migration preflight для перехода Mercy на Beget запускается вручную через GitHub Actions и fail-closed проверяет production configuration (host/user могут храниться как Environment Variables, чувствительные значения — только Secrets), pinned SSH host key, source/target DB versions, пустой target Mercy contour и доступность требуемых Postgres extensions. Расширение PostGIS может быть ещё не установлено в свежей Beget-БД: preflight требует, чтобы оно было доступно в `pg_available_extensions`, а начальная Mercy migration устанавливает его. Source DB password не передаётся в process argv; preflight не выгружает пользовательские данные и не изменяет Beget.
- Cutover workflow `Cut over Mercy Supabase to Beget` требует явный выбор `MIGRATE`, повторяет compatibility gates, запрещает Storage/MFA/SSO/non-email migration profile, делает backup цели, freeze source с проверкой покрытия по конкретным relations, переносит Auth/public data, автоматически unfreeze-ит source при failure и оставляет source frozen только после полной target verification.

## OPERATIONAL READINESS
До обработки реальных данных оператор должен применять migrations защищённым workflow, поддерживать production Auth/SMTP/redirect, Realtime, backup/restore, мониторинг и incident response, безопасный ADMIN bootstrap и smoke-сценарии. Для российского cutover дополнительно обязателен runbook `docs/RU_SUPABASE_MIGRATION.md`: подтверждённый preflight, write-freeze старого production, safety backup Beget, транзакционный restore, сверка данных/RLS/сервисов, переключение приложения и проверенный rollback.

## PLANNED / POST-MVP
Организационные кабинеты, deletion operations, abuse controls, безопасные вложения/уведомления, локализации, улучшения каталога организаций, volunteer assignment, Peerivo integration и AI assistance по versioned consent contract и с coordinator approval.
