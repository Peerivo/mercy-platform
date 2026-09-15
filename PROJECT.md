# mercy-platform — CURRENT

## Назначение и границы
«Язык милосердия» — русскоязычная платформа добровольной поддержки материнства, семьи и людей в кризисе. MVP v1 включает два раздельных потока: приватное обращение за помощью и приватное предложение добровольной помощи. Помощник не становится сотрудником и не получает доступ к обращениям. Платформа не является медицинской организацией или 24/7 экстренной службой.

## Инфраструктура
Модульный монолит Next.js 16 / React 19, Supabase Auth/PostgreSQL/PostGIS/Realtime, append-only SQL migrations и non-root Docker runtime. Production Supabase внешний; секретов в репозитории нет. Remote migrations и deployment из этой рабочей среды не выполнялись.

## IMPLEMENTED
- Auth: регистрация с подтверждением email, вход/выход, recovery и проверяемый callback на обязательный `NEXT_PUBLIC_SITE_URL`.
- «Нужна помощь»: приватное обращение, кабинет, ADMIN queue, назначение/переназначение, COORDINATOR workspace, карточка, персистентный Realtime-чат, план и переходы до RESOLVED/CLOSED. Доступ определяется user JWT, RLS и активным назначением.
- «Хочу помочь»: категоризированное предложение с страной/городом или online, описанием, контактом и атомарно сохранённым consent; собственный список в кабинете; ограниченная ADMIN-модерация с audit. Предложение не меняет staff role.
- Quick Exit очищает локальную сессию и ведёт на `/auth`; History/BFCache guard также возвращает к `/auth`, а устаревший `/safe` сразу перенаправляет туда. Приватные no-store/noindex routes, каталог проверенных организаций, существующий каталог специалистов, CI с clean disposable Supabase/pgTAP/integration/Chromium и Docker.
- Общий адаптивный `page-shell` выравнивает основные страницы и site header на mobile/tablet/desktop/large desktop; favicon и знак в header используют единую Peerivo SVG-иконку.
- `/health` выдаёт только status, environment и безопасно нормализованную ревизию; Docker принимает `GIT_SHA` и обязательные публичные Auth/Supabase build variables. Mock/data fallback отсутствует.

## OPERATIONAL READINESS (не поведение приложения)
До обработки реальных данных оператор должен применить migrations защищённым workflow, настроить production Auth/SMTP/redirect, Realtime, backup/restore, мониторинг и incident response, один раз безопасно bootstrap ADMIN, затем выполнить оба smoke-сценария. Эти внешние операции требуют production credentials и approvals.

## PLANNED / POST-MVP
Professional providers, медицинские исполнители, qualification/licence verification как условие оказания услуги, matching, availability, booking, payments, commissions, ratings и reviews не входят в MVP v1. Существующий экспериментальный каталог специалистов не является marketplace или обещанием медицинской услуги. См. `docs/ROADMAP.md`.
