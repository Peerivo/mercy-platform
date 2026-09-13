# mercy-platform — CURRENT

## Назначение и границы
«Язык милосердия» — русскоязычная платформа добровольной поддержки материнства, семьи и людей в кризисе: приватное обращение, назначенный координатор, чат, совместный план и проверенный каталог. Это не медицинская организация и не 24/7 экстренная служба. Помощь не зависит от решения человека или участия в религиозной поддержке; опасные отношения не предлагается сохранять.

## Инфраструктура
Модульный монолит Next.js 16 / React 19, Supabase Auth/PostgreSQL/PostGIS/Realtime, SQL-only migrations, Docker. Production Supabase внешний; секретов в репозитории нет. Remote migrations intentionally not applied.

## IMPLEMENTED
Публичная главная, каталог/гео-RPC, Auth flows, приватная форма обращения, кабинет, история/Realtime чат с RPC-idempotency, просмотр плана, предложение помощи, быстрый выход с BFCache guard; строгая схема, RLS/grants, assignment/status/staff-role RPC, audit, consent and IdentityLink contract; CI, controlled migration deployment, docs and Docker. `send_message` повторно проверяет доступ при retry, обнаруживает nonce-конфликт и атомарно сериализует минутную квоту по автору. Приватные RPC имеют явные EXECUTE grants, а новые функции по умолчанию не открываются API-ролям. Disposable Supabase harness воспроизводит схему и запускает pgTAP, настоящие Auth/API/Realtime (включая независимые сценарии переназначения и отзыва staff-role на открытом соединении) и минимальные Chromium-сценарии без облачных credentials. Integration Auth-клиенты изолированы, явно передают пользовательский JWT в Realtime и работают в Node environment; каталог использует однородные NOT NULL fixtures.

## IN_PROGRESS
Полный браузерный UI рабочего места администратора/координатора остаётся отдельным следующим этапом; карта и новые продуктовые возможности также не входят в это объединение. После исправлений локально пройдены lint (с двумя существующими предупреждениями), typecheck, unit и production build; среда предоставила Node 20 вместо требуемого CI Node 22. Docker отсутствует, поэтому новый head ещё должен быть фактически подтверждён обязательным GitHub CI: clean Supabase, 20 pgTAP, 9 Auth/API/Realtime, Chromium и Docker build.

## PLANNED
Организационные кабинеты, guest access, модерируемая взаимопомощь, группы, безопасные вложения/видео, уведомления, локализации, пожертвования и отдельно согласованные Peerivo/AI integrations. См. `docs/ROADMAP.md`.

## Следующее действие
Опубликовать единый PR непосредственно в `main`, дождаться зелёного обязательного CI последнего head и слить без обхода branch protection. Только после обновления `main` начинается отдельный этап staff UI. Облачный staging и bootstrap первого администратора нужны позднее для операционной приёмки, не для disposable набора.
