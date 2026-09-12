# mercy-platform — CURRENT

## Назначение и границы
«Язык милосердия» — русскоязычная платформа добровольной поддержки материнства, семьи и людей в кризисе: приватное обращение, назначенный координатор, чат, совместный план и проверенный каталог. Это не медицинская организация и не 24/7 экстренная служба. Помощь не зависит от решения человека или участия в религиозной поддержке; опасные отношения не предлагается сохранять.

## Инфраструктура
Модульный монолит Next.js 16 / React 19, Supabase Auth/PostgreSQL/PostGIS/Realtime, SQL-only migrations, Docker. Production Supabase внешний; секретов в репозитории нет. Remote migrations intentionally not applied.

## IMPLEMENTED
Публичная главная, каталог/гео-RPC, Auth flows, приватная форма обращения, кабинет, история/Realtime чат с RPC-idempotency, просмотр плана, предложение помощи, быстрый выход с BFCache guard; строгая схема, RLS/grants, assignment/status/staff-role RPC, audit, consent and IdentityLink contract; CI, controlled migration deployment, docs and Docker. `send_message` повторно проверяет доступ при retry, обнаруживает nonce-конфликт и атомарно сериализует минутную квоту по автору. Приватные RPC имеют явные EXECUTE grants, а новые функции по умолчанию не открываются API-ролям. Disposable Supabase harness воспроизводит схему и запускает pgTAP, настоящие Auth/API/Realtime (включая отзыв назначения и staff-role на открытом соединении) и минимальные Chromium-сценарии без облачных credentials.

## IN_PROGRESS
Полный браузерный UI рабочего места администратора/координатора остаётся в работе. Локально пройдены lint (с двумя существующими предупреждениями), typecheck, unit и production build; среда предоставила Node 20 вместо требуемого CI Node 22. Новый pgTAP/Auth/API/Realtime/Chromium integration suite не запускался локально из-за недоступного Docker и должен быть фактически подтверждён GitHub-hosted runner.

## PLANNED
Организационные кабинеты, guest access, модерируемая взаимопомощь, группы, безопасные вложения/видео, уведомления, локализации, пожертвования и отдельно согласованные Peerivo/AI integrations. См. `docs/ROADMAP.md`.

## Следующее действие
Владелец запускает CI последнего SHA и подтверждает зелёный `supabase-integration`; затем реализуется staff UI. Облачный staging и bootstrap первого администратора нужны позднее для операционной приёмки, не для этого disposable набора.
